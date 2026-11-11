"""Live test against Synap. Runs only when LINKRRA_API_KEY is set."""

import os

import pytest

from langchain_linkrra import ChatLinkrra

pytestmark = pytest.mark.skipif(
    not os.environ.get("LINKRRA_API_KEY"), reason="LINKRRA_API_KEY not set"
)

MODEL = os.environ.get("LINKRRA_TEST_MODEL", "qwen3-coder-30b")


def test_invoke() -> None:
    llm = ChatLinkrra(model=MODEL, max_tokens=64, temperature=0)
    msg = llm.invoke("Reply with the single word: pong")
    assert isinstance(msg.content, str) and msg.content.strip()
    assert msg.usage_metadata and msg.usage_metadata["total_tokens"] > 0
