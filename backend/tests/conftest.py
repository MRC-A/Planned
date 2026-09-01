"""Shared test fixtures. `client` runs the app against a throwaway SQLite
file per test instead of the real ~/.planned/planned.db — task endpoints
look up `engine` from planned.api.tasks's module namespace at call time, so
monkeypatching that name redirects every request without touching the
user's actual data."""
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine

import planned.api.tasks as tasks_module
from planned.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(tasks_module, "engine", engine)
    return TestClient(app)
