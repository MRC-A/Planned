"""Unit tests for the F5 tool-call sanitization in api/chat.py —
_build_proposed_updates is a pure function (no DB, no LLM), so these don't
need the `client` fixture or a running model. Covers the security-relevant
boundary: an update targeting an id outside the currently-open set must be
dropped, since that id came from the model rather than from something the
backend fully controls."""
from planned.api.chat import _build_proposed_updates


def test_builds_a_camelcase_patch_from_only_the_given_fields():
    raw = [{"task_id": 1, "status": "done", "due_date": "2026-09-30"}]

    result = _build_proposed_updates(raw, open_task_ids={1})

    assert result == [{"taskId": 1, "status": "done", "dueDate": "2026-09-30"}]


def test_drops_an_update_for_a_task_id_outside_the_open_set():
    """The model can only have seen ids from the open-tasks summary — a
    hallucinated, already-done, or already-deleted id must not slip through
    just because the model asserted it."""
    raw = [{"task_id": 999, "status": "done"}]

    result = _build_proposed_updates(raw, open_task_ids={1, 2, 3})

    assert result == []


def test_drops_an_update_with_no_recognized_fields():
    """task_id alone, with nothing actually changing, isn't a real update."""
    raw = [{"task_id": 1}]

    result = _build_proposed_updates(raw, open_task_ids={1})

    assert result == []


def test_ignores_unknown_keys_rather_than_passing_them_through():
    raw = [{"task_id": 1, "priority": "high", "made_up_field": "whatever"}]

    result = _build_proposed_updates(raw, open_task_ids={1})

    assert result == [{"taskId": 1, "priority": "high"}]


def test_a_null_date_is_kept_not_treated_as_absent():
    """Explicitly clearing a date (null) must survive — it's a real,
    intentional change, different from the field being omitted entirely."""
    raw = [{"task_id": 1, "due_date": None}]

    result = _build_proposed_updates(raw, open_task_ids={1})

    assert result == [{"taskId": 1, "dueDate": None}]


def test_drops_an_out_of_enum_status_but_keeps_the_rest_of_the_update():
    """A bad enum value would otherwise reach PATCH /api/tasks/{id} and come
    back as a raw 422 about a request the user never knowingly made."""
    raw = [{"task_id": 1, "status": "finished", "priority": "high"}]

    result = _build_proposed_updates(raw, open_task_ids={1})

    assert result == [{"taskId": 1, "priority": "high"}]


def test_drops_the_whole_update_when_its_only_field_is_an_invalid_enum():
    raw = [{"task_id": 1, "priority": "critical"}]

    result = _build_proposed_updates(raw, open_task_ids={1})

    assert result == []


def test_processes_a_mixed_batch_keeping_only_the_valid_entries():
    raw = [
        {"task_id": 1, "status": "done"},
        {"task_id": 999, "status": "done"},  # not open — dropped
        "not even a dict",  # malformed — dropped
        {"task_id": 2, "priority": "urgent"},
        {"task_id": 3},  # no real change — dropped
    ]

    result = _build_proposed_updates(raw, open_task_ids={1, 2, 3})

    assert result == [
        {"taskId": 1, "status": "done"},
        {"taskId": 2, "priority": "urgent"},
    ]
