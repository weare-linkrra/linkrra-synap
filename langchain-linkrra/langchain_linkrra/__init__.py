"""LangChain integration for Linkrra Synap."""

from importlib import metadata

from langchain_linkrra.chat_models import ChatLinkrra

try:
    __version__ = metadata.version(__package__ or "langchain-linkrra")
except metadata.PackageNotFoundError:
    __version__ = ""

__all__ = ["ChatLinkrra", "__version__"]
