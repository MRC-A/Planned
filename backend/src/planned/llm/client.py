"""Client for a locally-running LLM (LM Studio or Ollama).

Both expose an OpenAI-compatible chat-completions API, so the same client
works for either — only base_url/model differ.
"""
from openai import OpenAI

from planned.config import LLM_BASE_URL, LLM_MODEL


class LocalLLMClient:
    def __init__(self, base_url: str = LLM_BASE_URL, model: str = LLM_MODEL) -> None:
        self._client = OpenAI(base_url=base_url, api_key="not-needed")
        self._model = model

    def chat(self, messages: list[dict]) -> str:
        """Send a conversation, return the assistant's reply.

        TODO: streaming, function/tool calling to create & schedule tasks.
        """
        response = self._client.chat.completions.create(model=self._model, messages=messages)
        return response.choices[0].message.content or ""
