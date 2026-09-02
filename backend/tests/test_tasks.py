"""Regression tests for the subtask-integrity bugs found in the 2026-09-01
review (see CLAUDE.md subtasks section): a task becoming its own parent
(C3), a 3-level subtask chain forming (C2), and deleting a task leaving
dangling parent_id/depends_on references behind (C1) — plus the
progress/status sync (see CLAUDE.md's "Completed tasks" section)."""


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


def test_reaching_100_percent_progress_marks_the_task_done(client):
    task = create(client, title="Almost there", status="in_progress", progress=60)

    response = client.patch(f"/api/tasks/{task['id']}", json={"progress": 100})

    assert response.status_code == 200
    assert response.json()["status"] == "done"


def test_marking_a_task_done_fills_progress_to_100(client):
    task = create(client, title="Quick win", status="todo", progress=0)

    response = client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})

    assert response.status_code == 200
    assert response.json()["progress"] == 100


def test_status_cycle_style_update_still_syncs_progress(client):
    """Table's status badge and To-Do's checkbox only ever PATCH `status`
    (never `progress`) — make sure the sync still applies to that shape of
    request, not just a full form submit."""
    task = create(client, title="Cycled", status="in_progress", progress=25)

    response = client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})

    assert response.status_code == 200
    assert response.json()["progress"] == 100


def test_creating_a_task_already_at_100_percent_is_created_done(client):
    task = create(client, title="Already finished", status="todo", progress=100)

    assert task["status"] == "done"


def test_partial_progress_does_not_force_done(client):
    """Sanity check: the sync only fires at the boundary, not on every edit."""
    task = create(client, title="In progress", status="todo", progress=0)

    response = client.patch(f"/api/tasks/{task['id']}", json={"progress": 50})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "todo"
    assert body["progress"] == 50
