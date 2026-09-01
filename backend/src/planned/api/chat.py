"""Chat endpoint: forwards the conversation to the local LLM, which replies
and (via tool calls, TODO) creates and schedules tasks.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from planned.llm.client import LocalLLMClient

router = APIRouter()
_llm = LocalLLMClient()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


@router.post("/")
def send_message(request: ChatRequest) -> dict[str, str]:
    reply = _llm.chat([m.model_dump() for m in request.messages])
    return {"role": "assistant", "content": reply}
