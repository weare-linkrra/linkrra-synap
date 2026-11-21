# Synap402 custom provider for goose

A [goose](https://github.com/aaif-goose/goose) custom-provider file for **Synap402** (by Linkrra):
open-weight models served on Linkrra's own GPUs behind an OpenAI-compatible API, billed per token.

This replaces the earlier `linkrra.json` previously published at
[jimmyplup/synap-mcp/goose](https://github.com/jimmyplup/synap-mcp/tree/main/goose) (see
[aaif-goose/goose#12948](https://github.com/aaif-goose/goose/issues/12948), where a maintainer
pointed us at this custom-provider route: built-in provider requests are "only occasionally
accepted by exception"). The product has since been rebranded **Synap402** and moved to
`synap402.com`; this file brings the registration current under that name and under the
`weare-linkrra` GitHub account.

## 1. Get an API key

Sign in at [https://synap402.com/login.html](https://synap402.com/login.html) and create a key
(`sk-pool-...`). `qwen3-coder-30b` has a free tier — 100,000 tokens/day for the first 7 days of an
account, then 50,000/day — so you can try it before adding credits.

## 2. Download the provider file into goose's custom_providers directory

macOS / Linux:

```bash
mkdir -p ~/.config/goose/custom_providers
curl -fsSL https://raw.githubusercontent.com/weare-linkrra/linkrra-synap/main/goose/synap402.json \
  -o ~/.config/goose/custom_providers/synap402.json
```

Windows (PowerShell):

```powershell
$dir = "$env:APPDATA\Block\goose\config\custom_providers"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://raw.githubusercontent.com/weare-linkrra/linkrra-synap/main/goose/synap402.json -OutFile "$dir\synap402.json"
```

## 3. Add your key

Either:

- goose Desktop: Settings → Models → Configure providers → Synap402 → paste the key (stored in
  your keychain), or
- CLI / environment:

```bash
export LINKRRA_API_KEY="your-key"
goose session --provider synap402 --model qwen3-coder-30b
```

The file contains no credentials. goose reads the key from `LINKRRA_API_KEY` or the keychain.

## Models (live-checked 2026-11-21 against `https://synap402.com/v1/models`)

| Model id | Context | Input $/1M | Output $/1M | Good for |
|---|---|---|---|---|
| `qwen3-coder-30b` | 98,304 | 0.0675 | 0.27 | Coding sessions (recommended default, free-tier model) |
| `qwen/qwen3-30b-a3b-instruct-2507` | 98,304 | 0.0813 | 0.2438 | General chat and agent work |
| `qwen/qwen3-vl-30b-a3b-instruct` | 65,536 | 0.14 | 0.55 | Vision-language input |
| `gemma-4-26b-a4b-it` | 32,768 | 0.04 | 0.21 | Long files and documents |
| `gpt-oss-20b` | 65,536 | 0.017 | 0.085 | Cheapest per token; reasoning model (see note below) |
| `meta/muse-glimmer-30b` | 131,072 | 0.28 | 1.1 | Larger general-purpose model |

Prices are also declared per token in the JSON, so goose's cost tracking shows real numbers.
Live prices: [https://synap402.com/v1/models](https://synap402.com/v1/models).

- **API:** OpenAI-compatible chat completions at `https://synap402.com/v1/chat/completions`.
- **Tool calling:** yes, on every listed model.
- **Streaming:** yes, including `stream_options.include_usage`.
- **Custom headers:** none required.
- **Model list:** static (`dynamic_models: false`). The plain `/v1/models` endpoint also lists
  models Synap402 routes to other providers (`owned_by` other than `pearlpool-fleet`); this file
  only lists the ones running on Linkrra's own GPUs.
- **Quantization:** models are served 4-bit quantized (`gpt-oss-20b` in its native MXFP4). Quality
  and speed differ from full-precision hosts.
- **Reasoning (`gpt-oss-20b`):** it spends output tokens thinking before it answers, and those
  tokens are billed. A turn capped too low can return `content: null` with the budget consumed as
  `reasoning_tokens` — give it headroom if you set `max_tokens` by hand.

## x402: an alternative payment rail (not used by this goose provider file)

Separately from the `LINKRRA_API_KEY` route above, the exact same endpoint —
`https://synap402.com/v1/chat/completions` (alias:
`https://synap402.com/api/billing/x402/chat/completions`) — also accepts
[x402](https://www.x402.org/) payments: an agent holding USDC on **Base** (`eip155:8453`) or
**Solana** (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) can pay per call in the same round trip, with
no Synap402 account and no API key. Send the request with no `Authorization` header and you get an
HTTP 402 with the exact price quote in the `PAYMENT-REQUIRED` header (per x402 v2); retry the same
request with a `PAYMENT-SIGNATURE` header to get billed and answered in one round trip. Pricing
starts at $0.001 per call (the per-call minimum), and a new wallet's first call is free (cheap
models, up to 512 output tokens, non-streaming, daily cap). Machine-readable terms:
`GET https://synap402.com/api/billing/x402/info`.

This is informational for agent builders working directly against the Synap402 API — **goose's
custom-provider mechanism itself speaks only the API-key route** declared in `synap402.json`
above; there is no x402 field in goose's custom-provider schema today.

## Troubleshooting

- **402 "Please check your account with your provider to add more credits":** before streaming,
  Synap402 checks your balance against the full request (goose's prompt plus the expected output).
  Top up at [https://synap402.com/account.html](https://synap402.com/account.html), or switch to
  `qwen3-coder-30b`, which has the free tier.
- **401:** the key isn't reaching goose. Check `echo $LINKRRA_API_KEY`, or re-enter it in Desktop.
- **Support:** [weare@linkrra.com](mailto:weare@linkrra.com)
