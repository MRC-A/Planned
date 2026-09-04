"""Regression tests for the subtask-integrity bugs found in the 2026-09-01
review (see CLAUDE.md subtasks section): a task becoming its own parent
(C3), a 3-level subtask chain forming (C2), and deleting a task leaving
dangling parent_id/depends_on references behind (C1).

Extended for C5: value validation the server previously skipped entirely —
negative durations, depends_on pointing at nothing, a due date before the
start date, and SQLite foreign keys that were declared but never enforced."""
import pytest
from sqlmodel import Session

from planned.models import Task


def create(client, **fields):
    payload = {"title": "Untitled", **fields}
    response = client.post("/api/tasks/", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_delete_orphans_children_instead_of_leaving_a_dangling_reference(client):
    parent = create(client, title="Parent")
    child = create(client, title="Child", parent_id=parent["id"])

    response = client.delete(f"/api/tasks/{parent['id']}")
    assert response.status_code == 204

    refreshed = client.get("/api/tasks/").json()
    child_after = next(t for t in refreshed if t["id"] == child["id"])
    assert child_after["parent_id"] is None


def test_delete_clears_depends_on_of_dependents(client):
    upstream = create(client, title="Upstream")
    downstream = create(client, title="Downstream", depends_on=upstream["id"])

    response = client.delete(f"/api/tasks/{upstream['id']}")
    assert response.status_code == 204

    refreshed = client.get("/api/tasks/").json()
    downstream_after = next(t for t in refreshed if t["id"] == downstream["id"])
    assert downstream_after["depends_on"] is None


def test_task_cannot_become_its_own_parent(client):
    task = create(client, title="Solo")

    response = client.patch(f"/api/tasks/{task['id']}", json={"parent_id": task["id"]})

    assert response.status_code == 400


def test_a_task_with_children_cannot_be_given_a_parent(client):
    parent = create(client, title="Parent")
    child = create(client, title="Child", parent_id=parent["id"])
    other = create(client, title="Other top-level")

    # `parent` already has a child (`child`) — giving it a parent of its own
    # would form a 3-level chain (other -> parent -> child), which is what
    # silently orphaned a real user's subtask before this was fixed.
    response = client.patch(f"/api/tasks/{parent['id']}", json={"parent_id": other["id"]})

    assert response.status_code == 400


def test_a_subtask_still_cannot_be_chosen_as_another_tasks_parent(client):
    """Pre-existing rule (not part of this fix) — kept here as a regression
    guard alongside the new checks above."""
    parent = create(client, title="Parent")
    child = create(client, title="Child", parent_id=parent["id"])
    other = create(client, title="Other")

    response = client.patch(f"/api/tasks/{other['id']}", json={"parent_id": child["id"]})

    assert response.status_code == 400


def test_a_childless_top_level_task_can_still_be_given_a_parent(client):
    """Make sure the new has-children check doesn't over-block the normal case."""
    parent = create(client, title="Parent")
    plain = create(client, title="Plain top-level task")

    response = client.patch(f"/api/tasks/{plain['id']}", json={"parent_id": parent["id"]})

    assert response.status_code == 200
    assert response.json()["parent_id"] == parent["id"]


def test_bulk_delete_removes_every_requested_task(client):
    a = create(client, title="A")
    b = create(client, title="B")
    c = create(client, title="C")

    response = client.post("/api/tasks/bulk-delete", json={"ids": [a["id"], b["id"]]})

    assert response.status_code == 200
    assert sorted(response.json()["deleted"]) == sorted([a["id"], b["id"]])
    remaining_ids = {t["id"] for t in client.get("/api/tasks/").json()}
    assert remaining_ids == {c["id"]}


def test_bulk_delete_promotes_a_child_not_included_in_the_batch(client):
    parent = create(client, title="Parent")
    child = create(client, title="Child", parent_id=parent["id"])

    response = client.post("/api/tasks/bulk-delete", json={"ids": [parent["id"]]})

    assert response.status_code == 200
    child_after = next(t for t in client.get("/api/tasks/").json() if t["id"] == child["id"])
    assert child_after["parent_id"] is None


def test_bulk_delete_of_parent_and_child_together_does_not_error(client):
    """The child doesn't need promoting if it's being deleted in the same
    batch — make sure that shared codepath doesn't choke on it."""
    parent = create(client, title="Parent")
    child = create(client, title="Child", parent_id=parent["id"])

    response = client.post("/api/tasks/bulk-delete", json={"ids": [parent["id"], child["id"]]})

    assert response.status_code == 200
    assert sorted(response.json()["deleted"]) == sorted([parent["id"], child["id"]])
    assert client.get("/api/tasks/").json() == []


def test_bulk_delete_clears_depends_on_of_a_dependent_not_included_in_the_batch(client):
    upstream = create(client, title="Upstream")
    downstream = create(client, title="Downstream", depends_on=upstream["id"])

    response = client.post("/api/tasks/bulk-delete", json={"ids": [upstream["id"]]})

    assert response.status_code == 200
    downstream_after = next(t for t in client.get("/api/tasks/").json() if t["id"] == downstream["id"])
    assert downstream_after["depends_on"] is None


def test_bulk_delete_ignores_ids_that_do_not_exist(client):
    """A stale id (e.g. the task was already deleted elsewhere) shouldn't
    fail the whole batch — same 'degrade, don't reject the batch' spirit
    as the chat assistant's own subtask handling."""
    real = create(client, title="Real task")

    response = client.post("/api/tasks/bulk-delete", json={"ids": [real["id"], 999999]})

    assert response.status_code == 200
    assert response.json()["deleted"] == [real["id"]]
    assert client.get("/api/tasks/").json() == []


# --- C5: server-side value validation ---------------------------------------


def test_rejects_a_negative_duration(client):
    """duration_hours = -5 used to be stored as-is."""
    response = client.post("/api/tasks/", json={"title": "x", "duration_hours": -5})

    assert response.status_code == 422


def test_accepts_a_zero_duration(client):
    assert client.post("/api/tasks/", json={"title": "x", "duration_hours": 0}).status_code == 200


def test_rejects_depends_on_a_task_that_does_not_exist(client):
    """Used to return 200 and store a reference to nothing."""
    response = client.post("/api/tasks/", json={"title": "x", "depends_on": 999999})

    assert response.status_code == 404


def test_rejects_a_task_depending_on_itself(client):
    task = client.post("/api/tasks/", json={"title": "x"}).json()

    response = client.patch(f"/api/tasks/{task['id']}", json={"depends_on": task["id"]})

    assert response.status_code == 400


def test_accepts_depends_on_a_real_task(client):
    target = client.post("/api/tasks/", json={"title": "first"}).json()

    response = client.post("/api/tasks/", json={"title": "second", "depends_on": target["id"]})

    assert response.status_code == 200
    assert response.json()["depends_on"] == target["id"]


def test_rejects_a_due_date_before_the_start_date(client):
    response = client.post(
        "/api/tasks/",
        json={"title": "x", "start_date": "2026-10-10", "due_date": "2026-10-01"},
    )

    assert response.status_code == 400


def test_allows_a_single_day_task(client):
    response = client.post(
        "/api/tasks/",
        json={"title": "x", "start_date": "2026-10-10", "due_date": "2026-10-10"},
    )

    assert response.status_code == 200


def test_patching_only_the_due_date_is_checked_against_the_stored_start_date(client):
    """The dates that matter are the ones the task ends up with, not just the
    ones in this payload."""
    task = client.post(
        "/api/tasks/", json={"title": "x", "start_date": "2026-10-10", "due_date": "2026-10-20"}
    ).json()

    response = client.patch(f"/api/tasks/{task['id']}", json={"due_date": "2026-10-01"})

    assert response.status_code == 400


def test_clearing_the_start_date_leaves_a_lone_due_date_valid(client):
    task = client.post(
        "/api/tasks/", json={"title": "x", "start_date": "2026-10-10", "due_date": "2026-10-20"}
    ).json()

    response = client.patch(f"/api/tasks/{task['id']}", json={"start_date": None})

    assert response.status_code == 200


def test_sqlite_foreign_keys_are_actually_enforced(client):
    """The FKs were declared and never applied — SQLite defaults the pragma
    to OFF, per connection. Bypass the API's own checks and write straight to
    the session, so this fails if only the application-level guards exist."""
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    from planned.api import tasks as tasks_api

    with Session(tasks_api.engine) as session:
        assert session.exec(text("PRAGMA foreign_keys")).one()[0] == 1
        session.add(Task(title="dangling", depends_on=999999))
        with pytest.raises(IntegrityError):
            session.commit()


def test_deleting_a_parent_and_its_child_together_still_works_with_fks_on(client):
    """Enforced FKs make delete order matter, and SQLAlchemy has no declared
    relationship here to order by — references have to be cleared first."""
    parent = client.post("/api/tasks/", json={"title": "parent"}).json()
    child = client.post("/api/tasks/", json={"title": "child", "parent_id": parent["id"]}).json()

    response = client.post("/api/tasks/bulk-delete", json={"ids": [parent["id"], child["id"]]})

    assert response.status_code == 200
    assert sorted(response.json()["deleted"]) == sorted([parent["id"], child["id"]])
    assert client.get("/api/tasks/").json() == []
