"""CRUD endpoints for tasks — the shared data all three views read and write."""
from fastapi import APIRouter
from sqlmodel import Session, select

from planned.db import engine
from planned.models import Task

router = APIRouter()


@router.get("/", response_model=list[Task])
def list_tasks() -> list[Task]:
    with Session(engine) as session:
        return session.exec(select(Task)).all()


@router.post("/", response_model=Task)
def create_task(task: Task) -> Task:
    with Session(engine) as session:
        session.add(task)
        session.commit()
        session.refresh(task)
        return task
