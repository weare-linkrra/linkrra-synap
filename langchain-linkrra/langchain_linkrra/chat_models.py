"""Linkrra Synap chat model for LangChain."""

from __future__ import annotations

import os
from typing import Any

from langchain_core.language_models.chat_models import LangSmithParams
from langchain_openai.chat_models.base import BaseChatOpenAI
from pydantic import Field, model_validator

DEFAULT_API_BASE = "https://synap402.com/v1"
DEFAULT_MODEL = "synap-v1"
API_KEY_ENV = "LINKRRA_API_KEY"
API_BASE_ENV = "LINKRRA_API_BASE"


class ChatLinkrra(BaseChatOpenAI):
    """Chat model for Linkrra Synap, an OpenAI-compatible inference API.

    Setup:
        Install `langchain-linkrra` and set the `LINKRRA_API_KEY` environment
        variable (get a key at https://synap402.com).

        ```bash
        pip install -U langchain-linkrra
        export LINKRRA_API_KEY="your-api-key"
        ```

    Key init args:
        model: Model id. `synap-v1` (default) lets Synap pick the cheapest model
            that can do the job. The full live list, with prices, is at
            https://synap402.com/v1/models.
        temperature: Sampling temperature.
        max_tokens: Max number of tokens to generate.
        api_key: Linkrra API key. Defaults to `LINKRRA_API_KEY`.
        base_url: API base URL. Defaults to `LINKRRA_API_BASE`, then
            `https://synap402.com/v1`.

    Instantiate:
        ```python
        from langchain_linkrra import ChatLinkrra

        model = ChatLinkrra(model="gpt-oss-20b", temperature=0)
        ```

    Invoke:
        ```python
        model.invoke("Say hello in one word.")
        ```

    Tool calling and structured output work the same way as with
    `ChatOpenAI` (`bind_tools`, `with_structured_output`).
    """

    model_name: str = Field(default=DEFAULT_MODEL, alias="model")
    """Model id, e.g. `synap-v1`, `gpt-oss-20b`, `qwen3-coder-30b`."""

    stream_usage: bool | None = True
    """Report token usage on streamed responses (Synap supports it)."""

    use_responses_api: bool | None = False
    """Synap speaks the Chat Completions API; the Responses API is not used."""

    @model_validator(mode="before")
    @classmethod
    def _linkrra_defaults(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        values = dict(values)
        if not any(values.get(k) for k in ("api_key", "openai_api_key")):
            env_key = os.environ.get(API_KEY_ENV)
            if not env_key:
                msg = (
                    f"No Linkrra API key found. Pass `api_key=` or set the "
                    f"{API_KEY_ENV} environment variable."
                )
                raise ValueError(msg)
            values["api_key"] = env_key
        if not any(values.get(k) for k in ("base_url", "openai_api_base")):
            values["base_url"] = os.environ.get(API_BASE_ENV, DEFAULT_API_BASE)
        return values

    @property
    def _llm_type(self) -> str:
        """Return type of chat model."""
        return "chat-linkrra"

    @property
    def lc_secrets(self) -> dict[str, str]:
        """Map secret fields to environment variables."""
        return {"openai_api_key": API_KEY_ENV}

    @classmethod
    def get_lc_namespace(cls) -> list[str]:
        """Get the namespace of the LangChain object."""
        return ["langchain_linkrra", "chat_models"]

    @classmethod
    def is_lc_serializable(cls) -> bool:
        """Return whether this model can be serialized by LangChain."""
        return True

    def _get_ls_params(
        self, stop: list[str] | None = None, **kwargs: Any
    ) -> LangSmithParams:
        params = super()._get_ls_params(stop=stop, **kwargs)
        params["ls_provider"] = "linkrra"
        return params
