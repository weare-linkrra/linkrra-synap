# Linkrra Synap — integrations

Official integrations for **Linkrra Synap** (<https://synap402.com>), an
OpenAI-compatible inference API for open models (Qwen, gpt-oss, Gemma, GLM,
DeepSeek and more), billed per token, payable with an API key or per call in
USDC over x402.

> Linkrra Synap is an inference API. It is unrelated to other products that use
> the name "Synap".

| Directory | Package | What it is |
|---|---|---|
| [`synap-mcp/`](synap-mcp/) | npm [`synap-mcp`](https://www.npmjs.com/package/synap-mcp) | MCP server for Cline, Claude Code, Claude Desktop, Cursor, Windsurf and other MCP clients |
| [`langchain-linkrra/`](langchain-linkrra/) | PyPI [`langchain-linkrra`](https://pypi.org/project/langchain-linkrra/) | LangChain chat model `ChatLinkrra` |
| [`llama-index-llms-linkrra/`](llama-index-llms-linkrra/) | PyPI [`llama-index-llms-linkrra`](https://pypi.org/project/llama-index-llms-linkrra/) | LlamaIndex LLM `Linkrra` |

## Quick start

API base URL: `https://synap402.com/v1` (OpenAI-compatible). Live model ids,
context lengths and prices: <https://synap402.com/v1/models>.

```bash
pip install -U langchain-linkrra            # LangChain
pip install -U llama-index-llms-linkrra     # LlamaIndex
export LINKRRA_API_KEY="sk-..."             # https://synap402.com/account.html
```

```python
from langchain_linkrra import ChatLinkrra
print(ChatLinkrra(model="qwen3-coder-30b").invoke("Hello!").content)

from llama_index.llms.linkrra import Linkrra
print(Linkrra(model="qwen3-coder-30b").complete("Hello!"))
```

MCP (Cline, Cursor, Claude Desktop, ...):

```json
{
  "mcpServers": {
    "synap": {
      "command": "npx",
      "args": ["-y", "synap-mcp"],
      "env": { "SYNAP_API_KEY": "sk-..." }
    }
  }
}
```

Details: [`synap-mcp/README.md`](synap-mcp/README.md) and
[`synap-mcp/llms-install.md`](synap-mcp/llms-install.md).

## License

Apache-2.0
