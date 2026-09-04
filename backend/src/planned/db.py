"""SQLite persistence layer (local-first, single file, zero setup)."""
import shutil
import sqlite3
from datetime import datetime, timezone

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlmodel import SQLModel, create_engine

from planned.config import DB_PATH

engine = create_engine(f"sqlite:///{DB_PATH}")


# C5 — SQLite ships with foreign key enforcement OFF, per connection. The
# FKs on task.parent_id and task.depends_on were declared and never applied,
# so a row could point at an id that doesn't exist; one such row was found in
# the real database. Registered on the Engine class rather than on this one
# engine so the test engines get it too — a guard the tests don't exercise is
# a guard you find out about in production.
@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:
    if not isinstance(dbapi_connection, sqlite3.Connection):
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

# A single SQLite file with no backup was flagged as the single biggest risk
# for a personal planner (2026-09-01 review, F2) — there was no way to
# recover from a bad migration, a bug, or an accidental mass-delete. Kept
# simple: copy the file once per backend startup rather than running a
# scheduler, since this is a locally-run single-user app that gets
# restarted reasonably often (see scripts/start-planned.bat).
BACKUP_RETENTION = 10


def _backup_db() -> None:
    if not DB_PATH.exists():
        return  # first run — nothing to back up yet
    backup_dir = DB_PATH.parent / "backups"
    backup_dir.mkdir(exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    shutil.copy2(DB_PATH, backup_dir / f"planned-{timestamp}.db")
    # Prune down to the most recent BACKUP_RETENTION copies — names sort
    # chronologically since the timestamp is zero-padded ISO-ish.
    backups = sorted(backup_dir.glob("planned-*.db"))
    for stale in backups[:-BACKUP_RETENTION]:
        stale.unlink()


# Columns added after the DB was first created. create_all() only creates
# missing tables, not missing columns on existing ones — for a single-user
# local SQLite file, a tiny startup migration is simpler than a real
# migration tool. Add a new (table, column, ddl_type) tuple here whenever a
# field is added to an existing model.
_COLUMN_MIGRATIONS = [
    ("task", "parent_id", "INTEGER REFERENCES task(id)"),
    ("task", "recurrence", "TEXT"),
]

# Columns removed from a model after the DB was first created. Symmetric to
# _COLUMN_MIGRATIONS above, and just as necessary: an existing table's
# column that used to be NOT NULL doesn't stop being NOT NULL just because
# the model no longer mentions it — every INSERT started failing the moment
# `progress` was dropped from Task, since nothing supplied a value for a
# column the live schema still required. Add a new (table, column) tuple
# here whenever a field is removed from an existing model.
_COLUMN_DROPS = [
    ("task", "progress"),
]


def _run_column_migrations() -> None:
    with engine.begin() as conn:
        for table, column, ddl_type in _COLUMN_MIGRATIONS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
        for table, column in _COLUMN_DROPS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column in existing:
                conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))


def init_db() -> None:
    _backup_db()
    SQLModel.metadata.create_all(engine)
    _run_column_migrations()
