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
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TaskCreate(SQLModel):
    """Payload for creating a task — every server-owned field is excluded."""

    title: str
    description: str = ""
    status: TaskStatus = TaskStatus.TODO
    priority: TaskPriority = TaskPriority.MEDIUM
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    duration_hours: Optional[float] = None
    depends_on: Optional[int] = None
    parent_id: Optional[int] = None
    tags: Optional[str] = None


class TaskUpdate(SQLModel):
    """Payload for a partial update — every field optional, unset ones are left untouched."""

    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    duration_hours: Optional[float] = None
    depends_on: Optional[int] = None
    parent_id: Optional[int] = None
    tags: Optional[str] = None
