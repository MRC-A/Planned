"""Client for a locally-running LLM (LM Studio or Ollama).

Both expose an OpenAI-compatible chat-completions API, so the same client
works for either — only base_url/model differ.
"""
import json
from typing import Any, Optional

from openai import OpenAI

from planned.config import LLM_BASE_URL, LLM_MODEL


class LocalLLMClient:
    def __init__(self, base_url: str = LLM_BASE_URL, model: str = LLM_MODEL) -> None:
        self._client = OpenAI(base_url=base_url, api_key="not-needed")
        self._model = model

    def chat(self, messages: list[dict], tools: Optional[list[dict]] = None) -> dict[str, Any]:
        """Send a conversation, optionally offering tool(s) the model can call.

        Returns {"content": str, "tool_call": {"name": str, "arguments": dict} | None}.
        Only the first tool call is surfaced. api/chat.py now offers two
        tools (propose_tasks, propose_task_updates) in the same request, but
        still expects the model to pick one per reply and call it at most
        once — confirmed so far against LM Studio's default model (Gemma),
        which has only ever returned a single tool call even with two
        offered. If a model that emits multiple tool calls per turn shows up,
        this drops every call after the first with no error — worth
        revisiting then, not preemptively.

        TODO: streaming.
        """
        response = self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            tools=tools,
        )
        message = response.choices[0].message
        tool_call = None
        if message.tool_calls:
            call = message.tool_calls[0]
            tool_call = {
                "name": call.function.name,
                "arguments": json.loads(call.function.arguments),
            }
        return {"content": message.content or "", "tool_call": tool_call}
