"""Core data models shared across all views (to-do list, calendar, Gantt)."""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


class TaskStatus(str, Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class Task(SQLModel, table=True):
    """A single task — the shared unit of data behind every view."""

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: str = ""
    status: TaskStatus = TaskStatus.TODO
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    duration_hours: Optional[float] = None
    depends_on: Optional[int] = Field(default=None, foreign_key="task.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
