"""Chat endpoint: forwards the conversation to the local LLM, which can call
the `propose_tasks` tool to suggest one or more new tasks.

The backend never creates anything from a tool call itself — it just
returns the proposal to the frontend, which shows it to the user for
confirmation before actually creating the tasks via the normal
POST /api/tasks/ endpoint. This endpoint is otherwise read-only and
stateless: it loads the user's current open tasks to give the model
context for scheduling, but doesn't write anything.
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


class ChatResponse(BaseModel):
    role: str = "assistant"
    content: str
    proposed_tasks: list[ProposedTask] | None = None


def _existing_tasks_summary() -> str:
    with Session(engine) as session:
        tasks = session.exec(select(Task).where(Task.status != TaskStatus.DONE)).all()
    if not tasks:
        return "The user currently has no open tasks."
    lines = [
        f"- {t.title} (priority: {t.priority.value}, "
        f"start: {t.start_date.date().isoformat() if t.start_date else 'none'}, "
        f"due: {t.due_date.date().isoformat() if t.due_date else 'none'})"
        for t in tasks
    ]
    return "The user's current open tasks:\n" + "\n".join(lines)


def _build_system_prompt() -> str:
    return (
        "You are the assistant inside Planned, a task and project planning app. "
        f"Today's date is {date.today().isoformat()}.\n\n"
        f"{_existing_tasks_summary()}\n\n"
        "When the user asks you to create one or more tasks, call the propose_tasks "
        "tool. Try to set sensible start_date/due_date that fit around the user's "
        "existing deadlines and workload listed above; leave a date null rather than "
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
        content = result["content"] or f"I'd suggest creating {len(proposed)} task(s) — review below."
        return ChatResponse(content=content, proposed_tasks=proposed)

    return ChatResponse(content=result["content"])
