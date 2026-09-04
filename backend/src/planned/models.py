"""Core data models shared across all views (to-do list, calendar, Gantt)."""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


class TaskStatus(str, Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class TaskPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class RecurrenceRule(str, Enum):
    """F6. Deliberately just these three — no custom intervals, no end date
    or occurrence count. A task either repeats on a plain schedule or it
    doesn't; anything fancier than that is scope this app doesn't need (see
    the `progress` field removal for the same call made the other way)."""

    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class Task(SQLModel, table=True):
    """A single task — the shared unit of data behind every view.

    This is the exhaustive record used by the Table view. The To-Do list and
    other views only surface a subset of these fields.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: str = ""
    status: TaskStatus = TaskStatus.TODO
    priority: TaskPriority = TaskPriority.MEDIUM
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    duration_hours: Optional[float] = None
    depends_on: Optional[int] = Field(default=None, foreign_key="task.id")
    parent_id: Optional[int] = Field(default=None, foreign_key="task.id")
    tags: Optional[str] = None  # comma-separated for now; TODO: proper many-to-many
    # F6 — null means "does not repeat". See api/tasks.py::_spawn_next_occurrence
    # for what happens when a recurring task is marked done.
    recurrence: Optional[RecurrenceRule] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# S3 — length caps on the free-text fields, applied at the API boundary
# (TaskCreate/TaskUpdate) rather than on Task itself: a table=True SQLModel
# skips validation, and SQLite ignores VARCHAR lengths anyway, so a constraint
# there would be decorative. Generous enough for a pasted email in a
# description; bounded enough that the column can't be handed megabytes.
MAX_TITLE_LEN = 500
MAX_DESCRIPTION_LEN = 20_000
MAX_TAGS_LEN = 2_000


class TaskCreate(SQLModel):
    """Payload for creating a task — every server-owned field is excluded."""

    title: str = Field(max_length=MAX_TITLE_LEN)
    description: str = Field(default="", max_length=MAX_DESCRIPTION_LEN)
    status: TaskStatus = TaskStatus.TODO
    priority: TaskPriority = TaskPriority.MEDIUM
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    # C5 — a task took duration_hours = -5 without complaint.
    duration_hours: Optional[float] = Field(default=None, ge=0)
    depends_on: Optional[int] = None
    parent_id: Optional[int] = None
    tags: Optional[str] = Field(default=None, max_length=MAX_TAGS_LEN)
    recurrence: Optional[RecurrenceRule] = None


class TaskUpdate(SQLModel):
    """Payload for a partial update — every field optional, unset ones are left untouched."""

    title: Optional[str] = Field(default=None, max_length=MAX_TITLE_LEN)
    description: Optional[str] = Field(default=None, max_length=MAX_DESCRIPTION_LEN)
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    duration_hours: Optional[float] = Field(default=None, ge=0)
    depends_on: Optional[int] = None
    parent_id: Optional[int] = None
    tags: Optional[str] = Field(default=None, max_length=MAX_TAGS_LEN)
    recurrence: Optional[RecurrenceRule] = None
