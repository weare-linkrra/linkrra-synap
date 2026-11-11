"""Offline unit tests for ChatLinkrra."""

import pytest
from langchain_core.language_models import BaseChatModel

from langchain_linkrra import ChatLinkrra
from langchain_linkrra.chat_models import DEFAULT_API_BASE


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("LINKRRA_API_KEY", "LINKRRA_API_BASE", "OPENAI_API_KEY",
                "OPENAI_API_BASE", "OPENAI_BASE_URL"):
        monkeypatch.delenv(var, raising=False)


def test_is_chat_model() -> None:
    assert issubclass(ChatLinkrra, BaseChatModel)


def test_defaults_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LINKRRA_API_KEY", "sk-test")
    llm = ChatLinkrra()
    assert llm.model_name == "synap-v1"
    assert llm.openai_api_base == DEFAULT_API_BASE
    assert llm.openai_api_key.get_secret_value() == "sk-test"
    assert str(llm.root_client.base_url).rstrip("/") == DEFAULT_API_BASE
    assert llm._llm_type == "chat-linkrra"
    assert llm.use_responses_api is False


def test_explicit_args_win(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LINKRRA_API_KEY", "sk-env")
    llm = ChatLinkrra(model="gpt-oss-20b", api_key="sk-arg",
                      base_url="http://localhost:9/v1")
    assert llm.model_name == "gpt-oss-20b"
    assert llm.openai_api_key.get_secret_value() == "sk-arg"
    assert llm.openai_api_base == "http://localhost:9/v1"


def test_base_url_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LINKRRA_API_KEY", "sk-test")
    monkeypatch.setenv("LINKRRA_API_BASE", "http://example.test/v1")
    assert ChatLinkrra().openai_api_base == "http://example.test/v1"


def test_missing_key_raises() -> None:
    with pytest.raises(ValueError, match="LINKRRA_API_KEY"):
        ChatLinkrra()


def test_does_not_read_openai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    with pytest.raises(ValueError):
        ChatLinkrra()


def test_secrets_and_ls_params(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LINKRRA_API_KEY", "sk-test")
    llm = ChatLinkrra(model="gpt-oss-20b", temperature=0.2)
    assert llm.lc_secrets == {"openai_api_key": "LINKRRA_API_KEY"}
    ls = llm._get_ls_params()
    assert ls["ls_provider"] == "linkrra"
    assert ls["ls_model_name"] == "gpt-oss-20b"
    assert "sk-test" not in repr(llm)


def test_request_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LINKRRA_API_KEY", "sk-test")
    llm = ChatLinkrra(model="qwen3-coder-30b", max_tokens=16)
    payload = llm._get_request_payload("hi")
    assert payload["model"] == "qwen3-coder-30b"
    assert payload["messages"] == [{"role": "user", "content": "hi"}]


def test_bind_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LINKRRA_API_KEY", "sk-test")

    def get_weather(city: str) -> str:
        """Get the weather for a city."""
        return "sunny"

    bound = ChatLinkrra().bind_tools([get_weather])
    assert bound.kwargs["tools"][0]["function"]["name"] == "get_weather"
