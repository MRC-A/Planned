"""Unit tests for the F5 tool-call sanitization in api/chat.py —
_build_proposed_updates is a pure function (no DB, no LLM), so these don't
need the `client` fixture or a running model. Covers the security-relevant
boundary: an update targeting an id outside the currently-open set must be
dropped, since that id came from the model rather than from something the
backend fully controls."""
from planned.api.chat import _build_proposed_updates, _validated_tasks


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


# --- Field coercion at the tool-call boundary -------------------------------
# These cover values the model has emitted (or plausibly emits) that a later
# POST/PATCH would reject. The point is that they're caught here, where the
# rest of the proposal survives, instead of reaching the user as a raw 422.


def test_drops_a_relative_date_instead_of_passing_it_through():
    """The prompt tells the model to use absolute dates precisely because it
    otherwise reaches for phrases like this; "next Friday" would 422 at
    PATCH /api/tasks/{id}."""
    raw = [{"task_id": 1, "due_date": "next Friday", "priority": "high"}]

    result = _build_proposed_updates(raw, open_task_ids={1})

    assert result == [{"taskId": 1, "priority": "high"}]


def test_drops_an_impossible_date():
    raw = [{"task_id": 1, "start_date": "2026-13-45"}]

    assert _build_proposed_updates(raw, open_task_ids={1}) == []


def test_narrows_a_full_datetime_to_its_date_part():
    raw = [{"task_id": 1, "due_date": "2026-09-30T00:00:00"}]

    assert _build_proposed_updates(raw, open_task_ids={1}) == [{"taskId": 1, "dueDate": "2026-09-30"}]


def test_drops_null_tags_which_would_crash_the_diff_renderer():
    """ChatPanel's diffLines does `u.tags.join(', ')` — a null here throws
    while rendering, taking the whole chat panel down, rather than merely
    failing a request."""
    raw = [{"task_id": 1, "tags": None, "status": "done"}]

    assert _build_proposed_updates(raw, open_task_ids={1}) == [{"taskId": 1, "status": "done"}]


def test_drops_a_null_title_which_would_blank_the_stored_task():
    """TaskUpdate.title is Optional[str] and PATCH setattr's whatever it's
    given, so this would actually null out the task's title in the DB."""
    raw = [{"task_id": 1, "title": None, "priority": "low"}]

    assert _build_proposed_updates(raw, open_task_ids={1}) == [{"taskId": 1, "priority": "low"}]


def test_accepts_a_numeric_string_duration():
    raw = [{"task_id": 1, "duration_hours": "3"}]

    assert _build_proposed_updates(raw, open_task_ids={1}) == [{"taskId": 1, "durationHours": 3.0}]


def test_drops_a_prose_duration_from_an_update():
    raw = [{"task_id": 1, "duration_hours": "about 3 hours"}]

    assert _build_proposed_updates(raw, open_task_ids={1}) == []


def test_an_explicitly_cleared_date_still_survives_coercion():
    """Regression guard for the coercion above: null is a real "clear it"
    instruction for a date, unlike for title/tags, and must not be dropped."""
    raw = [{"task_id": 1, "due_date": None}]

    assert _build_proposed_updates(raw, open_task_ids={1}) == [{"taskId": 1, "dueDate": None}]


# --- propose_tasks: validation + parent_ref remapping -----------------------


def test_parent_ref_still_points_at_the_right_task_after_one_is_dropped():
    """parent_ref is an index into the array the model emitted. Dropping the
    untitled entry renumbers everything after it, so without remapping the
    subtask silently attached to "Build" instead of "Design" — no error, just
    a wrong batch."""
    raw = [
        {"description": "no title at all"},        # dropped
        {"title": "Design"},                       # was 1, becomes 0
        {"title": "Build"},                        # was 2, becomes 1
        {"title": "Draw mockups", "parent_ref": 1},  # meant "Design"
    ]

    result = _validated_tasks(raw)

    assert [t.title for t in result] == ["Design", "Build", "Draw mockups"]
    assert result[2].parent_ref == 0
    assert result[0].title == "Design"


def test_a_subtask_whose_parent_was_dropped_becomes_top_level():
    raw = [
        {"description": "no title"},                 # dropped
        {"title": "Orphaned child", "parent_ref": 0},
    ]

    result = _validated_tasks(raw)

    assert len(result) == 1
    assert result[0].parent_ref is None


def test_one_bad_field_costs_that_field_not_the_whole_task():
    """A prose duration used to raise ValidationError and discard the entire
    proposed task, losing a perfectly good title and description with it."""
    raw = [
        {
            "title": "Write the report",
            "description": "Quarterly summary",
            "duration_hours": "about 3 hours",
            "priority": "critical",
            "due_date": "next Friday",
            "tags": None,
        }
    ]

    (task,) = _validated_tasks(raw)

    assert task.title == "Write the report"
    assert task.description == "Quarterly summary"
    assert task.duration_hours is None
    assert task.priority == "medium"  # "critical" isn't a real priority
    assert task.due_date is None
    assert task.tags == []


def test_a_task_with_no_usable_title_is_still_dropped():
    assert _validated_tasks([{"description": "x"}, {"title": None}]) == []


def test_keeps_the_valid_fields_of_an_otherwise_normal_task():
    raw = [
        {
            "title": "Ship it",
            "priority": "urgent",
            "start_date": "2026-09-08",
            "due_date": "2026-09-12",
            "duration_hours": 6,
            "tags": ["release"],
        }
    ]

    (task,) = _validated_tasks(raw)

    assert (task.priority, task.start_date, task.due_date) == ("urgent", "2026-09-08", "2026-09-12")
    assert (task.duration_hours, task.tags) == (6.0, ["release"])
