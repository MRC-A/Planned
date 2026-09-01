"""SQLite persistence layer (local-first, single file, zero setup)."""
from sqlmodel import SQLModel, create_engine

from planned.config import DB_PATH

engine = create_engine(f"sqlite:///{DB_PATH}")


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
