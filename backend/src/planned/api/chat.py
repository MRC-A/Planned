"""Chat endpoint: forwards the conversation to the local LLM, which can call
one of two tools — `propose_tasks` to suggest new tasks (optionally
structured as a top-level task plus subtasks), or `propose_task_updates`
(F5) to suggest changes to the user's existing open tasks: rescheduling,
changing status/priority, or editing any other field.

The backend never creates or writes anything from a tool call itself — it
just returns the proposal to the frontend, which shows it to the user for
confirmation before actually applying it via the normal POST/PATCH
/api/tasks/ endpoints. This is *why* propose_task_updates is safe to add
without first landing S2 (prompt-injection hardening, see CLAUDE.md): the
confirmation step — not the model's own judgment — is the security
boundary, same as it already was for propose_tasks, and that doesn't
change by adding a second tool that follows the identical propose-then-
confirm shape. This endpoint is otherwise read-only and stateless: it
loads the user's current open tasks (with their subtask relationships) to
give the model context for scheduling, but doesn't write anything.
"""
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError
from sqlmodel import Session, select

from planned.db import engine
from planned.llm.client import LocalLLMClient
from planned.models import Task, TaskPriority, TaskStatus

router = APIRouter()
_llm = LocalLLMClient()

PROPOSE_TASKS_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_tasks",
        "description": (
            "Propose one or more new tasks to create for the user. Call this once "
            "you have enough information — don't call it just to ask a clarifying "
            "question, and don't call it more than once per reply."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "priority": {
                                "type": "string",
                                "enum": ["low", "medium", "high", "urgent"],
                            },
                            "start_date": {
                                "type": ["string", "null"],
                                "description": "Absolute date as YYYY-MM-DD, or null.",
                            },
                            "due_date": {
                                "type": ["string", "null"],
                                "description": "Absolute date as YYYY-MM-DD, or null.",
                            },
                            "duration_hours": {"type": ["number", "null"]},
                            "tags": {"type": "array", "items": {"type": "string"}},
                            "parent_ref": {
                                "type": ["integer", "null"],
                                "description": (
                                    "0-based index of this task's parent WITHIN THIS SAME "
                                    "tasks array — use this to propose a top-level task "
                                    "together with its subtasks in one call. Null for a "
                                    "standalone/top-level task. Can't reference an "
                                    "already-existing task, and a subtask can't itself be "
                                    "a parent (one level deep only)."
                                ),
                            },
                        },
                        "required": ["title"],
                    },
                },
            },
            "required": ["tasks"],
        },
    },
}

PROPOSE_TASK_UPDATES_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_task_updates",
        "description": (
            "Propose changes to one or more of the user's EXISTING open tasks — "
            "rescheduling, marking done/in-progress/to-do, changing priority, or "
            "editing any other field. Only for tasks already listed in 'The "
            "user's current open tasks' below, referenced by the [id N] shown "
            "there — never invent an id. To create a brand-new task, use "
            "propose_tasks instead. Call this once you have enough information — "
            "don't call it just to ask a clarifying question, and don't call it "
            "more than once per reply."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "updates": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "description": (
                            "Only include the fields that are actually changing — "
                            "leave every other field out entirely so it stays "
                            "untouched (e.g. rescheduling a task means only "
                            "task_id + start_date/due_date, nothing else)."
                        ),
                        "properties": {
                            "task_id": {
                                "type": "integer",
                                "description": "The id of an existing open task, from the '[id N]' shown in the list below.",
                            },
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": ["todo", "in_progress", "done"],
                            },
                            "priority": {
                                "type": "string",
                                "enum": ["low", "medium", "high", "urgent"],
                            },
                            "start_date": {
                                "type": ["string", "null"],
                                "description": "Absolute date as YYYY-MM-DD, or null to clear it.",
                            },
                            "due_date": {
                                "type": ["string", "null"],
                                "description": "Absolute date as YYYY-MM-DD, or null to clear it.",
                            },
                            "duration_hours": {"type": ["number", "null"]},
                            "tags": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["task_id"],
                    },
                },
            },
            "required": ["updates"],
        },
    },
}


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class ProposedTask(BaseModel):
    title: str
    description: str = ""
    priority: str = "medium"
    start_date: str | None = None
    due_date: str | None = None
    duration_hours: float | None = None
    tags: list[str] = []
    parent_ref: int | None = None


class ChatResponse(BaseModel):
    role: str = "assistant"
    content: str
    proposed_tasks: list[ProposedTask] | None = None
    # Plain dicts rather than a strict Pydantic model — each one carries
    # only the keys the model actually included (see
    # _build_proposed_updates), so a partial PATCH stays partial: an
    # omitted field means "leave it alone", not "clear it". A fixed-field
    # model would force every field to serialize (as null) whether the
    # model meant to touch it or not.
    proposed_updates: list[dict] | None = None


def _existing_tasks_summary(tasks: list[Task]) -> str:
    if not tasks:
        return "The user currently has no open tasks."
    by_id = {t.id: t for t in tasks}
    lines = []
    tag_set: set[str] = set()
    for t in tasks:
        parent_note = ""
        if t.parent_id is not None and t.parent_id in by_id:
            parent_note = f', subtask of "{by_id[t.parent_id].title}"'
        lines.append(
            f"- [id {t.id}] {t.title} (priority: {t.priority.value}, "
            f"start: {t.start_date.date().isoformat() if t.start_date else 'none'}, "
            f"due: {t.due_date.date().isoformat() if t.due_date else 'none'}"
            f"{parent_note})"
        )
        if t.tags:
            tag_set.update(tag.strip() for tag in t.tags.split(",") if tag.strip())
    summary = "The user's current open tasks:\n" + "\n".join(lines)
    # Shown so the model matches the user's existing tag style (short,
    # lowercase) instead of inventing a different casing/format per task —
    # baseline testing produced "Client Feature", "DevOps", "UI/UX" etc.
    # mixed in with lowercase ones.
    if tag_set:
        summary += "\n\nTags already in use, for style reference: " + ", ".join(sorted(tag_set))
    return summary


def _sanitize_parent_refs(tasks: list[ProposedTask]) -> None:
    """Keep the one-level-deep subtask rule (see api/tasks.py::_validate_parent
    for the equivalent, persisted-side rule): drop any parent_ref that's out
    of range, self-referential, or points at another proposed subtask.
    Dropping rather than rejecting the whole reply — the user still reviews
    every proposed task before anything is created."""
    n = len(tasks)
    for i, t in enumerate(tasks):
        if t.parent_ref is None:
            continue
        if not (0 <= t.parent_ref < n) or t.parent_ref == i or tasks[t.parent_ref].parent_ref is not None:
            t.parent_ref = None


# snake_case (the tool schema, matching the rest of this API) -> camelCase
# (what the frontend's TaskPatch expects).
_UPDATE_FIELD_MAP = {
    "title": "title",
    "description": "description",
    "status": "status",
    "priority": "priority",
    "start_date": "startDate",
    "due_date": "dueDate",
    "duration_hours": "durationHours",
    "tags": "tags",
}


# Enum-valued fields, checked here rather than left to blow up later: an
# out-of-enum value (the model writing "finished" instead of "done") would
# otherwise sail through to the frontend and come back as a raw 422 from
# PATCH /api/tasks/{id} — an error about a request the user didn't know they
# were making. Dropping just that field keeps the rest of the update usable.
_UPDATE_ENUMS = {
    "status": {s.value for s in TaskStatus},
    "priority": {p.value for p in TaskPriority},
}


def _build_proposed_updates(raw_updates: list, open_task_ids: set[int]) -> list[dict]:
    """Turn the model's raw tool-call arguments into what the frontend
    expects. An update targeting a task_id that isn't a real, currently-open
    task (hallucinated, already done, or already deleted) is dropped rather
    than failing the whole batch — same "degrade, don't reject the batch"
    spirit as _sanitize_parent_refs, and doubly important here since these
    ids come from the model referencing free-form context rather than an
    index it fully controls."""
    proposed = []
    for raw in raw_updates:
        if not isinstance(raw, dict):
            continue
        task_id = raw.get("task_id")
        if not isinstance(task_id, int) or task_id not in open_task_ids:
            continue
        patch = {}
        for snake, camel in _UPDATE_FIELD_MAP.items():
            if snake not in raw:
                continue
            value = raw[snake]
            if snake in _UPDATE_ENUMS and value not in _UPDATE_ENUMS[snake]:
                continue
            patch[camel] = value
        if not patch:
            continue
        proposed.append({"taskId": task_id, **patch})
    return proposed


def _build_system_prompt(tasks: list[Task]) -> str:
    today = date.today()
    return (
        "You are the assistant inside Planned, a task and project planning app. "
        "The user will often just paste in a raw request — a one-line ask, a "
        "forwarded email, a Slack-style message — and expects you to turn it into "
        "a well-specified task without being asked to elaborate. Extract the real "
        "actionable ask from the noise (greetings, signatures, quoted context). "
        "Planned tracks any kind of task, professional or personal, big or small — "
        "the open tasks shown below happen to be software work, but that's just "
        "this user's current backlog, not a scope limit. Never refuse or "
        "deflect a legitimate request just because it's short, mundane, or "
        "unrelated to software (e.g. 'buy bread' is a perfectly good task with a "
        "small duration_hours estimate) — propose it like any other.\n\n"
        f"Today is {today.strftime('%A')}, {today.isoformat()}.\n\n"
        f"{_existing_tasks_summary(tasks)}\n\n"
        "You have two tools. Use propose_task_updates when the user is talking "
        "about a task that already exists in the list above (rescheduling it, "
        "marking it done/in-progress, changing its priority, editing anything "
        "about it) — reference it by the '[id N]' shown there, and only include "
        "the fields that are actually changing. 'Shift everything by a week' "
        "means one propose_task_updates call with one entry per affected task, "
        "each with new start_date/due_date. If you can't confidently tell which "
        "existing task the user means (an ambiguous or partial title), don't "
        "guess an id — ask a clarifying question in plain text instead of "
        "calling the tool. Use propose_tasks — covered next — only for "
        "something genuinely new.\n\n"
        "When the user asks you to create one or more tasks, call the propose_tasks "
        "tool — don't call it just to ask a clarifying question, and don't call it "
        "more than once per reply. For EVERY proposed task, fill in as much of the "
        "schema as you can reasonably infer, not just the title:\n"
        "- description: required, never leave it empty. A short brief, in the same "
        "language as the user's message, restating what actually needs to be done "
        "plus any concrete detail the user gave (numbers, systems, people, "
        "constraints) that doesn't fit in the title.\n"
        "- duration_hours: required, your best-effort estimate of the realistic "
        "workload in hours, based on the scope and complexity described. Give a "
        "number even under uncertainty — a rough estimate beats null — and reach "
        "for a round figure that reflects real effort (a small chore might be under "
        "an hour; a scoped feature or report a few hours; a step of a larger "
        "project several hours). Only leave it null if the task is so open-ended "
        "there is truly nothing to base a number on. If one task's scope is big or "
        "vague enough that a single estimate would be dishonest, that's a sign to "
        "break it into subtasks (see below) and estimate each one instead.\n"
        "- priority: infer from urgency cues in the message rather than defaulting "
        "to medium — up for an explicit deadline, 'urgent'/'ASAP', a client or "
        "manager waiting, a recurring problem; down (low) for an explicit "
        "de-escalating cue like 'pas urgent', 'no rush', 'when you get a chance'.\n"
        "- tags: short, lowercase, one or two words each — match the style of the "
        "existing tags listed above rather than inventing a different "
        "casing/format per task (e.g. not 'Client Feature' or 'UI/UX').\n\n"
        "If the request is really one project with sub-steps, propose one "
        "top-level task plus subtasks rather than several unrelated top-level tasks: "
        "set parent_ref on each subtask to the 0-based index of its parent within "
        "the same tasks array (see the tool schema — this can't reference an "
        "already-existing task, and only one level of subtasks is allowed).\n\n"
        "Dates must always be absolute (YYYY-MM-DD) — never a relative phrase like "
        "'next Friday'. When the user gives a relative date ('vendredi', 'ce "
        "week-end', 'in two weeks'), work out the absolute date from today's actual "
        "weekday above and double-check the arithmetic before answering — a wrong "
        "day is worse than no date at all. Try to set sensible start_date/due_date "
        "that fit around the user's existing deadlines and workload listed above; "
        "leave a date null rather than inventing one if you truly have no basis for "
        "it. Keep replies concise."
    )


@router.post("/", response_model=ChatResponse)
def send_message(request: ChatRequest) -> ChatResponse:
    with Session(engine) as session:
        open_tasks = session.exec(select(Task).where(Task.status != TaskStatus.DONE)).all()
    open_task_ids = {t.id for t in open_tasks}

    messages = [{"role": "system", "content": _build_system_prompt(open_tasks)}]
    messages += [m.model_dump() for m in request.messages]
    try:
        result = _llm.chat(messages, tools=[PROPOSE_TASKS_TOOL, PROPOSE_TASK_UPDATES_TOOL])
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach the local LLM ({exc}). Is LM Studio or Ollama running?",
        ) from exc

    tool_call = result["tool_call"]

    if tool_call and tool_call["name"] == "propose_tasks":
        raw_tasks = tool_call["arguments"].get("tasks", [])
        # The model occasionally emits a tool call missing a required field
        # (e.g. no "title") — skip just that task rather than 500ing the
        # whole reply, same "degrade, don't reject the batch" spirit as
        # _sanitize_parent_refs above.
        proposed = []
        for t in raw_tasks:
            try:
                proposed.append(ProposedTask.model_validate(t))
            except ValidationError:
                continue
        _sanitize_parent_refs(proposed)
        if not proposed:
            return ChatResponse(
                content=result["content"]
                or "I couldn't put together a valid task from that — could you rephrase?"
            )
        content = result["content"] or f"I'd suggest creating {len(proposed)} task(s) — review below."
        return ChatResponse(content=content, proposed_tasks=proposed)

    if tool_call and tool_call["name"] == "propose_task_updates":
        raw_updates = tool_call["arguments"].get("updates", [])
        proposed_updates = _build_proposed_updates(raw_updates, open_task_ids)
        if not proposed_updates:
            return ChatResponse(
                content=result["content"]
                or "I couldn't match that to one of your open tasks — could you say which one you mean?"
            )
        content = result["content"] or f"I'd suggest updating {len(proposed_updates)} task(s) — review below."
        return ChatResponse(content=content, proposed_updates=proposed_updates)

    return ChatResponse(content=result["content"])
