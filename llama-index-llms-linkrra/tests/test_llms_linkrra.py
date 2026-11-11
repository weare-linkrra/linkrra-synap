import os

import pytest
from llama_index.core.base.llms.base import BaseLLM
from llama_index.llms.openai_like import OpenAILike

from llama_index.llms.linkrra import Linkrra
from llama_index.llms.linkrra.base import DEFAULT_API_BASE

LIVE_KEY = os.environ.get("LINKRRA_API_KEY")


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for var in ("LINKRRA_API_KEY", "LINKRRA_API_BASE", "OPENAI_API_KEY", "OPENAI_API_BASE"):
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


def test_inheritance() -> None:
    names = [b.__name__ for b in Linkrra.__mro__]
    assert BaseLLM.__name__ in names
    assert issubclass(Linkrra, OpenAILike)


def test_defaults(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("LINKRRA_API_KEY", "sk-test")
    llm = Linkrra()
    assert llm.model == "synap-v1"
    assert llm.api_base == DEFAULT_API_BASE
    assert llm.api_key == "sk-test"
    assert llm.metadata.is_chat_model is True
    assert llm.metadata.is_function_calling_model is True
    assert llm.metadata.context_window == 32768
    assert Linkrra.class_name() == "Linkrra_LLM"


def test_explicit_args(clean_env: pytest.MonkeyPatch) -> None:
    llm = Linkrra(model="gpt-oss-20b", api_key="sk-arg",
                  api_base="http://localhost:9/v1", context_window=65536)
    assert llm.model == "gpt-oss-20b"
    assert llm.api_key == "sk-arg"
    assert llm.api_base == "http://localhost:9/v1"
    assert llm.metadata.context_window == 65536


def test_api_base_env(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("LINKRRA_API_KEY", "sk-test")
    clean_env.setenv("LINKRRA_API_BASE", "http://example.test/v1")
    assert Linkrra().api_base == "http://example.test/v1"


def test_missing_key(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("OPENAI_API_KEY", "sk-openai")
    with pytest.raises(ValueError, match="LINKRRA_API_KEY"):
        Linkrra()


@pytest.mark.skipif(not LIVE_KEY, reason="LINKRRA_API_KEY not set")
def test_live_complete_and_chat() -> None:
    from llama_index.core.llms import ChatMessage

    llm = Linkrra(model=os.environ.get("LINKRRA_TEST_MODEL", "qwen3-coder-30b"),
                  max_tokens=32, temperature=0)
    assert llm.complete("Reply with the single word: pong").text.strip()
    resp = llm.chat([ChatMessage(role="user", content="Say ok")])
    assert resp.message.content.strip()
