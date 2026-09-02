"""Regression test for the _COLUMN_DROPS migration (db.py) — guards against
the real bug it was added to fix: when `progress` was removed from the
Task model, an *existing* database's `task.progress` column was still
NOT NULL with no default, so every INSERT started failing with
`sqlalchemy.exc.IntegrityError` until this migration ran. A brand-new
database (schema created fresh from the current model) was never affected,
and test_tasks.py's `client` fixture builds its schema straight from the
current model too — so this is the one test that actually exercises the
migration path against a pre-removal schema, the shape that broke in
production. See CLAUDE.md's db.py bullet."""
from sqlalchemy import text
from sqlmodel import create_engine

import planned.db as db_module


def test_column_drop_migration_removes_a_stale_not_null_column(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        # Mirrors the pre-removal schema: `progress` is NOT NULL with no
        # SQL-level default, same as create_all() produced from the old
        # `progress: float = 0` field (a Python-side default only).
        conn.execute(
            text("CREATE TABLE task (id INTEGER PRIMARY KEY, title TEXT NOT NULL, progress REAL NOT NULL)")
        )

    monkeypatch.setattr(db_module, "engine", engine)
    db_module._run_column_migrations()

    with engine.begin() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(task)"))}
        assert "progress" not in columns
        # The actual regression: this INSERT 500'd before the drop ran.
        conn.execute(text("INSERT INTO task (title) VALUES ('smoke test')"))


def test_column_drop_migration_is_a_no_op_on_an_already_current_schema(tmp_path, monkeypatch):
    """A database created fresh from the current model never had `progress`
    at all — make sure the migration doesn't choke when there's nothing to
    drop. Table also lacks `parent_id`, so the existing ADD migration runs
    alongside it in the same call — this is really a test that the two
    don't interfere with each other."""
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE task (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"))

    monkeypatch.setattr(db_module, "engine", engine)
    db_module._run_column_migrations()  # must not raise

    with engine.begin() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(task)"))}
        assert columns == {"id", "title", "parent_id"}
