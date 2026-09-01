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
        Only the first tool call is surfaced — every caller in this app only
        ever offers a single tool, so there's nothing to disambiguate.

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
