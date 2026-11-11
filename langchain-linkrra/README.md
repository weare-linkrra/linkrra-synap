# langchain-linkrra

LangChain chat model for **Linkrra Synap** — an OpenAI-compatible inference API
for open models (Qwen, gpt-oss, Gemma, GLM, DeepSeek and more), billed per token.

> Not to be confused with other products named "Synap". This package talks to
> `https://synap402.com/v1`, operated by Linkrra.

## Install

```bash
pip install -U langchain-linkrra
export LINKRRA_API_KEY="your-api-key"   # get one at https://synap402.com
```

## Use

```python
from langchain_linkrra import ChatLinkrra

model = ChatLinkrra(model="gpt-oss-20b", temperature=0)
print(model.invoke("Write a haiku about open models.").content)
```

`model="synap-v1"` (the default) lets Synap pick the cheapest model that can do
the job. The live model list, with context lengths and per-token prices, is
always at <https://synap402.com/v1/models> — prices are not hard-coded here.

`ChatLinkrra` subclasses LangChain's `BaseChatOpenAI`, so streaming, async,
`bind_tools(...)` and `with_structured_output(...)` work as with `ChatOpenAI`.

```python
from pydantic import BaseModel

class City(BaseModel):
    name: str
    country: str

structured = ChatLinkrra(model="qwen3-coder-30b").with_structured_output(City)
structured.invoke("Which city is the Eiffel Tower in?")
```

## Configuration

| Argument | Env var | Default |
|---|---|---|
| `api_key` | `LINKRRA_API_KEY` | — (required) |
| `base_url` | `LINKRRA_API_BASE` | `https://synap402.com/v1` |
| `model` | — | `synap-v1` |

## Tests

```bash
pip install -e ".[test]"
pytest tests/unit_tests                 # offline
LINKRRA_API_KEY=... pytest tests/integration_tests   # one real call
```

## License

Apache-2.0
