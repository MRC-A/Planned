"""Regression tests for the subtask-integrity bugs found in the 2026-09-01
review (see CLAUDE.md subtasks section): a task becoming its own parent
(C3), a 3-level subtask chain forming (C2), and deleting a task leaving
dangling parent_id/depends_on references behind (C1)."""


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
