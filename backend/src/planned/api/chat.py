"""Chat endpoint: forwards the conversation to the local LLM, which replies
and (via tool calls, TODO) creates and schedules tasks.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from planned.llm.client import LocalLLMClient

router = APIRouter()
_llm = LocalLLMClient()

SYSTEM_PROMPT = (
    "You are the assistant inside Planned, a task and project planning app. "
    "Help the user think through, create, and organize their tasks. Keep replies concise."
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


@router.post("/")
def send_message(request: ChatRequest) -> dict[str, str]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += [m.model_dump() for m in request.messages]
    try:
        reply = _llm.chat(messages)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach the local LLM ({exc}). Is LM Studio or Ollama running?",
        ) from exc
    return {"role": "assistant", "content": reply}
