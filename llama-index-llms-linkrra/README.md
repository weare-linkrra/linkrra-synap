# llama-index-llms-linkrra

LlamaIndex LLM integration for **Linkrra Synap** — an OpenAI-compatible
inference API for open models (Qwen, gpt-oss, Gemma, GLM, DeepSeek and more),
billed per token.

> Not to be confused with other products named "Synap". This package talks to
> `https://synap402.com/v1`, operated by Linkrra.

## Install

```bash
pip install llama-index-llms-linkrra
export LINKRRA_API_KEY="your-api-key"   # get one at https://synap402.com
```

## Use

```python
from llama_index.llms.linkrra import Linkrra
from llama_index.core.llms import ChatMessage

llm = Linkrra(model="qwen3-coder-30b")

print(llm.complete("Write a haiku about open models."))
print(llm.chat([ChatMessage(role="user", content="Say hello.")]))

for chunk in llm.stream_complete("Count from 1 to 5."):
    print(chunk.delta, end="")
```

`model="synap-v1"` (the default) lets Synap pick the cheapest model that can do
the job. The live list of model ids, context lengths and per-token prices is at
<https://synap402.com/v1/models>. Set `context_window=` to match the model you
use (default: a conservative 32768).

Use it as the default LLM:

```python
from llama_index.core import Settings
Settings.llm = Linkrra(model="qwen3-coder-30b")
```

## Configuration

| Argument | Env var | Default |
|---|---|---|
| `api_key` | `LINKRRA_API_KEY` | — (required) |
| `api_base` | `LINKRRA_API_BASE` | `https://synap402.com/v1` |
| `model` | — | `synap-v1` |

## Tests

```bash
pip install -e ".[test]"
pytest tests            # offline; the live test runs only if LINKRRA_API_KEY is set
```

## License

Apache-2.0
