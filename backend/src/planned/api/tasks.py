"""CRUD endpoints for tasks — the shared data all views read and write."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select

from planned.db import engine
from planned.models import Task, TaskCreate, TaskUpdate

router = APIRouter()


def _validate_parent(session: Session, parent_id: Optional[int]) -> None:
    """Subtasks are one level deep: a task that is itself a subtask can
    never be chosen as another task's parent."""
    if parent_id is None:
        return
    parent = session.get(Task, parent_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="Parent task not found")
    if parent.parent_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot set a subtask as another task's parent — subtasks are one level deep.",
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
            _validate_parent(session, updates["parent_id"])
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
        session.delete(task)
        session.commit()
