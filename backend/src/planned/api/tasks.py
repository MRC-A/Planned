"""CRUD endpoints for tasks — the shared data all views read and write."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from planned.db import engine
from planned.models import Task, TaskCreate, TaskUpdate

router = APIRouter()


class BulkDeleteRequest(BaseModel):
    ids: list[int]


class BulkDeleteResponse(BaseModel):
    deleted: list[int]


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


def _validate_depends_on(session: Session, depends_on: Optional[int], task_id: Optional[int] = None) -> None:
    """Symmetric to _validate_parent, for the other nullable FK (C5).
    `depends_on = 999999` used to be accepted with a 200, storing a reference
    to nothing — the same shape of dangling row that the delete-time
    detaching exists to prevent, just created directly instead.

    Cycle detection is deliberately not here: a chain A->B->A is a different
    problem (C6) needing a graph walk, and this check has to stay cheap
    enough to run on every write."""
    if depends_on is None:
        return
    if task_id is not None and depends_on == task_id:
        raise HTTPException(status_code=400, detail="A task cannot depend on itself.")
    if session.get(Task, depends_on) is None:
        raise HTTPException(status_code=404, detail="Depends-on task not found")


def _validate_dates(start_date: Optional[datetime], due_date: Optional[datetime]) -> None:
    """A task finishing before it starts is a data-entry slip, not a plan —
    and it renders as a backwards or zero-length bar in Calendar and Timeline
    (both of which quietly re-order the pair to salvage something drawable).
    Either date may still be null on its own."""
    if start_date is not None and due_date is not None and due_date < start_date:
        raise HTTPException(status_code=400, detail="Due date cannot be earlier than the start date.")


@router.get("/", response_model=list[Task])
def list_tasks() -> list[Task]:
    with Session(engine) as session:
        return session.exec(select(Task)).all()


@router.post("/", response_model=Task)
def create_task(payload: TaskCreate) -> Task:
    with Session(engine) as session:
        _validate_parent(session, payload.parent_id)
        _validate_depends_on(session, payload.depends_on)
        _validate_dates(payload.start_date, payload.due_date)
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
        if "depends_on" in updates:
            _validate_depends_on(session, updates["depends_on"], task_id=task_id)
        # Validate the dates the task will *end up* with, not just the ones in
        # this payload: a PATCH that moves only the due date has to be checked
        # against the start date already stored.
        _validate_dates(
            updates.get("start_date", task.start_date),
            updates.get("due_date", task.due_date),
        )
        for field, value in updates.items():
            setattr(task, field, value)
        task.updated_at = datetime.utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
        return task


def _detach_references(session: Session, ids: set[int]) -> None:
    """A deleted task can't leave dangling references behind — orphaned rows
    pointing at a parent_id/depends_on that no longer exists were invisible
    everywhere except To-Do (a bug found in production). Children are
    promoted to top-level rather than cascade-deleted: losing the parent
    shouldn't silently lose the subtasks' own data. Shared by single and
    bulk delete.

    Rows that are themselves being deleted used to be skipped here as a
    pointless update. They aren't skipped any more, and that matters now that
    foreign keys are actually enforced (C5): SQLAlchemy has no declared
    relationship to order these deletes by, so deleting a parent before its
    child in the same batch would trip the constraint. Clearing every
    reference first, then flushing, removes the ordering question entirely."""
    referencing = session.exec(
        select(Task).where((Task.parent_id.in_(ids)) | (Task.depends_on.in_(ids)))
    ).all()
    now = datetime.utcnow()
    for task in referencing:
        if task.parent_id in ids:
            task.parent_id = None
        if task.depends_on in ids:
            task.depends_on = None
        task.updated_at = now
        session.add(task)
    session.flush()


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
def bulk_delete_tasks(payload: BulkDeleteRequest) -> BulkDeleteResponse:
    with Session(engine) as session:
        ids = set(payload.ids)
        tasks = session.exec(select(Task).where(Task.id.in_(ids))).all()
        found_ids = {t.id for t in tasks}

        _detach_references(session, found_ids)
        for task in tasks:
            session.delete(task)
        session.commit()
        return BulkDeleteResponse(deleted=sorted(found_ids))


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int) -> None:
    with Session(engine) as session:
        task = session.get(Task, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")

        _detach_references(session, {task_id})
        session.delete(task)
        session.commit()
