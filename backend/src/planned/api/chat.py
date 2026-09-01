"""Chat endpoint: forwards the conversation to the local LLM, which can call
the `propose_tasks` tool to suggest one or more new tasks — optionally
structured as a top-level task plus subtasks.

The backend never creates anything from a tool call itself — it just
returns the proposal to the frontend, which shows it to the user for
confirmation before actually creating the tasks via the normal
POST /api/tasks/ endpoint. This endpoint is otherwise read-only and
stateless: it loads the user's current open tasks (with their subtask
relationships) to give the model context for scheduling, but doesn't
write anything.
"""
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from planned.db import engine
from planned.llm.client import LocalLLMClient
from planned.models import Task, TaskStatus

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


def _existing_tasks_summary() -> str:
    with Session(engine) as session:
        tasks = session.exec(select(Task).where(Task.status != TaskStatus.DONE)).all()
    if not tasks:
        return "The user currently has no open tasks."
    by_id = {t.id: t for t in tasks}
    lines = []
    for t in tasks:
        parent_note = ""
        if t.parent_id is not None and t.parent_id in by_id:
            parent_note = f', subtask of "{by_id[t.parent_id].title}"'
        lines.append(
            f"- {t.title} (priority: {t.priority.value}, "
            f"start: {t.start_date.date().isoformat() if t.start_date else 'none'}, "
            f"due: {t.due_date.date().isoformat() if t.due_date else 'none'}"
            f"{parent_note})"
        )
    return "The user's current open tasks:\n" + "\n".join(lines)


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


def _build_system_prompt() -> str:
    return (
        "You are the assistant inside Planned, a task and project planning app. "
        f"Today's date is {date.today().isoformat()}.\n\n"
        f"{_existing_tasks_summary()}\n\n"
        "When the user asks you to create one or more tasks, call the propose_tasks "
        "tool. If the request is really one project with sub-steps, propose one "
        "top-level task plus subtasks rather than several unrelated top-level tasks: "
        "set parent_ref on each subtask to the 0-based index of its parent within "
        "the same tasks array (see the tool schema — this can't reference an "
        "already-existing task, and only one level of subtasks is allowed). Try to "
        "set sensible start_date/due_date that fit around the user's existing "
        "deadlines and workload listed above; leave a date null rather than "
        "inventing one if you truly have no basis for it. Dates must always be "
        "absolute (YYYY-MM-DD), computed from today's date — never a relative phrase "
        "like 'next Friday'. Keep replies concise."
    )


@router.post("/", response_model=ChatResponse)
def send_message(request: ChatRequest) -> ChatResponse:
    messages = [{"role": "system", "content": _build_system_prompt()}]
    messages += [m.model_dump() for m in request.messages]
    try:
        result = _llm.chat(messages, tools=[PROPOSE_TASKS_TOOL])
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach the local LLM ({exc}). Is LM Studio or Ollama running?",
        ) from exc

    tool_call = result["tool_call"]
    if tool_call and tool_call["name"] == "propose_tasks":
        raw_tasks = tool_call["arguments"].get("tasks", [])
        proposed = [ProposedTask.model_validate(t) for t in raw_tasks]
        _sanitize_parent_refs(proposed)
        content = result["content"] or f"I'd suggest creating {len(proposed)} task(s) — review below."
        return ChatResponse(content=content, proposed_tasks=proposed)

    return ChatResponse(content=result["content"])
