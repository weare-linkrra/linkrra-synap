"""Linkrra Synap LLM for LlamaIndex."""

import os
from typing import Any, Optional

from llama_index.core.base.llms.generic_utils import get_from_param_or_env
from llama_index.core.bridge.pydantic import Field
from llama_index.llms.openai_like import OpenAILike

DEFAULT_API_BASE = "https://synap402.com/v1"
DEFAULT_MODEL = "synap-v1"
DEFAULT_CONTEXT_WINDOW = 32768


class Linkrra(OpenAILike):
    """Linkrra Synap LLM: OpenAI-compatible inference for open models.

    Set `LINKRRA_API_KEY` (get a key at https://synap402.com), then:

    Examples:
        `pip install llama-index-llms-linkrra`

        ```python
        from llama_index.llms.linkrra import Linkrra

        llm = Linkrra(model="qwen3-coder-30b")
        print(llm.complete("Write a haiku about open models."))
        ```

    `model="synap-v1"` (default) lets Synap pick the cheapest model that can do
    the job. Live model ids, context lengths and prices:
    https://synap402.com/v1/models. Pass `context_window=` to match the model
    you use; the default is a conservative 32768.
    """

    model: str = Field(default=DEFAULT_MODEL, description="Synap model id.")
    context_window: int = Field(
        default=DEFAULT_CONTEXT_WINDOW,
        description="Max input tokens for the chosen model.",
    )
    is_chat_model: bool = Field(default=True)
    is_function_calling_model: bool = Field(default=True)

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        api_key: Optional[str] = None,
        api_base: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        api_key = get_from_param_or_env("api_key", api_key, "LINKRRA_API_KEY", "")
        if not api_key:
            raise ValueError(
                "No Linkrra API key found. Pass `api_key=` or set the "
                "LINKRRA_API_KEY environment variable."
            )
        api_base = api_base or os.environ.get("LINKRRA_API_BASE") or DEFAULT_API_BASE
        kwargs.setdefault("is_chat_model", True)
        kwargs.setdefault("is_function_calling_model", True)
        super().__init__(model=model, api_key=api_key, api_base=api_base, **kwargs)

    @classmethod
    def class_name(cls) -> str:
        """Get class name."""
        return "Linkrra_LLM"
