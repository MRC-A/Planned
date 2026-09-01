"""SQLite persistence layer (local-first, single file, zero setup)."""
from sqlalchemy import text
from sqlmodel import SQLModel, create_engine

from planned.config import DB_PATH

engine = create_engine(f"sqlite:///{DB_PATH}")

# Columns added after the DB was first created. create_all() only creates
# missing tables, not missing columns on existing ones — for a single-user
# local SQLite file, a tiny startup migration is simpler than a real
# migration tool. Add a new (table, column, ddl_type) tuple here whenever a
# field is added to an existing model.
_COLUMN_MIGRATIONS = [
    ("task", "parent_id", "INTEGER REFERENCES task(id)"),
]


def _run_column_migrations() -> None:
    with engine.begin() as conn:
        for table, column, ddl_type in _COLUMN_MIGRATIONS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _run_column_migrations()
