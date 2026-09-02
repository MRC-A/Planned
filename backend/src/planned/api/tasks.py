"""CRUD endpoints for tasks — the shared data all views read and write."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select

from planned.db import engine
from planned.models import Task, TaskCreate, TaskUpdate

router = APIRouter()


def _validate_parent(session: Session, parent_id: Optional[int], task_id: Optional[int] = None) -> None:
    """Subtasks are one level deep, enforced from both directions:
    - the chosen parent can't itself be a subtask (existing rule), and
    - the task being edited can't already have subtasks of its own —
      otherwise a 3-level chain forms (a bug found in production: PATCHing
      a task that already has children to give it a parent silently
      orphaned its own children from every view but To-Do).
    A task also can't be set as its own parent, which would make it vanish
    from every view (nothing renders it as top-level, and it can't be its
    own visible child either).
    `task_id` is the id of the task being modified — None on create, since
    a brand-new task can't yet have children or a self-reference."""
    if parent_id is None:
        return
    if task_id is not None and parent_id == task_id:
        raise HTTPException(status_code=400, detail="A task cannot be its own parent.")
    parent = session.get(Task, parent_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="Parent task not found")
    if parent.parent_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot set a subtask as another task's parent — subtasks are one level deep.",
        )
    if task_id is not None:
        has_children = session.exec(select(Task).where(Task.parent_id == task_id)).first()
        if has_children is not None:
            raise HTTPException(
                status_code=400,
                detail="Cannot give a parent to a task that already has subtasks — subtasks are one level deep.",
            )


@router.get("/", response_model=list[Task])
def list_tasks() -> list[Task]:
    with Session(engine) as session:
        return session.exec(select(Task)).all()


@router.post("/", response_model=Task)
def create_task(payload: TaskCreate) -> Task:
    with Session(engine) as session:
        _validate_parent(session, payload.parent_id)
        task = Task.model_validate(payload.model_dump())
        session.add(task)
        session.commit()
        session.refresh(task)
        return task


@router.patch("/{task_id}", response_model=Task)
def update_task(task_id: int, payload: TaskUpdate) -> Task:
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        updates = payload.model_dump(exclude_unset=True)
        if "parent_id" in updates:
            _validate_parent(session, updates["parent_id"], task_id=task_id)
        for field, value in updates.items():
            setattr(task, field, value)
        task.updated_at = datetime.utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
        return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int) -> None:
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")

        # A deleted task can't leave dangling references behind — orphaned
        # rows pointing at a parent_id/depends_on that no longer exists were
        # invisible everywhere except To-Do (a bug found in production).
        # Children are promoted to top-level rather than cascade-deleted:
        # losing the parent shouldn't silently lose the subtasks' own data.
        children = session.exec(select(Task).where(Task.parent_id == task_id)).all()
        dependents = session.exec(select(Task).where(Task.depends_on == task_id)).all()
        now = datetime.utcnow()
        for child in children:
            child.parent_id = None
            child.updated_at = now
            session.add(child)
        for dependent in dependents:
            dependent.depends_on = None
            dependent.updated_at = now
            session.add(dependent)

        session.delete(task)
        session.commit()
