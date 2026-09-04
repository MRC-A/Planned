"""CRUD endpoints for tasks — the shared data all views read and write."""
import calendar
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from planned.db import engine
from planned.models import RecurrenceRule, Task, TaskCreate, TaskStatus, TaskUpdate

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


def _shift_by_recurrence(dt: datetime, rule: RecurrenceRule) -> datetime:
    """One step forward on `rule`'s schedule.

    Monthly keeps the same day-of-month, clamped to whatever the target
    month actually has (Jan 31 -> Feb 28, or Feb 29 in a leap year) rather
    than overflowing into the month after. `min(d, month_length)` is
    monotonic non-decreasing in `d`, and the target month is the same for
    both dates whenever they started in the same month — which is what
    guarantees due >= start still holds on the shifted pair below; see
    _spawn_next_occurrence."""
    if rule == RecurrenceRule.DAILY:
        return dt + timedelta(days=1)
    if rule == RecurrenceRule.WEEKLY:
        return dt + timedelta(days=7)
    year = dt.year + dt.month // 12
    month = dt.month % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def _spawn_next_occurrence(session: Session, task: Task) -> Optional[Task]:
    """Completing a recurring task creates its next occurrence, rather than
    the app tracking a recurrence rule plus a set of generated instances —
    the simplest model that still means "this comes back" (F6). Runs inside
    the same transaction as the completion it's triggered by, so the two
    either both land or neither does.

    A no-op without at least one date: recurrence is a schedule, and an
    undated task has nothing to shift from — spawning an identical undated
    duplicate on every completion would just be clutter, not a schedule.

    depends_on is deliberately NOT carried over: it names a specific task
    instance, almost certainly the one just completed (or another that's
    also done by now), and carrying it forward would create a new task that
    depends on something already finished. parent_id IS carried over — the
    new occurrence is a sibling under the same parent, which is the
    unsurprising reading of "this recurring subtask happens again." Cloning
    subtasks of a recurring parent is out of scope: the new occurrence is a
    top-level clone shell, or a childless sibling if the source was itself a
    subtask — see CLAUDE.md."""
    if task.recurrence is None:
        return None
    if task.start_date is None and task.due_date is None:
        return None

    next_start = _shift_by_recurrence(task.start_date, task.recurrence) if task.start_date else None
    next_due = _shift_by_recurrence(task.due_date, task.recurrence) if task.due_date else None
    # Defense in depth (belt and suspenders, same spirit as C5): the shift
    # above is reasoned to always preserve due >= start, but it costs
    # nothing to actually check rather than trust the reasoning blindly.
    _validate_dates(next_start, next_due)

    clone = Task(
        title=task.title,
        description=task.description,
        status=TaskStatus.TODO,
        priority=task.priority,
        start_date=next_start,
        due_date=next_due,
        duration_hours=task.duration_hours,
        depends_on=None,
        parent_id=task.parent_id,
        tags=task.tags,
        recurrence=task.recurrence,
    )
    session.add(clone)
    return clone


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
        # Captured before any field is applied — this PATCH may itself be
        # what sets status to done, and _spawn_next_occurrence (F6) only
        # fires on that not-done -> done transition, not on staying done.
        was_done = task.status == TaskStatus.DONE
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
        # F6 — the dates/recurrence this checks are the ones the task ends up
        # with after the loop above, so rescheduling and completing in the
        # same PATCH spawns the next occurrence from the new dates, not the
        # ones being replaced.
        if not was_done and task.status == TaskStatus.DONE:
            _spawn_next_occurrence(session, task)
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
