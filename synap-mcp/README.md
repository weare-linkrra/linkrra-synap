# synap-mcp

MCP server for **[Synap by Linkrra](https://synap402.com)**: open models on dedicated GPUs behind an OpenAI-compatible API, for Claude Code, Claude Desktop, Cursor, Windsurf, OpenClaw and any other MCP client.

Pay with an **API key**, or **per call in USDC over [x402](https://x402.org)** (Base or Solana) from your own wallet with no account. Model ids and prices are read live from `https://synap402.com/v1/models`. Nothing is hard-coded.

```bash
claude mcp add synap -e SYNAP_API_KEY=sk-... -- npx -y synap-mcp
```

## 30-second quickstart

1. Get a key at [synap402.com/account.html](https://synap402.com/account.html). Google sign-in includes a [free daily allowance](https://synap402.com/free.html). Or skip the key and [pay per call from a wallet](#pay-per-call-from-a-wallet-no-account).
2. Add the server to your client:

   **Claude Code**

   ```bash
   claude mcp add synap -e SYNAP_API_KEY=sk-... -- npx -y synap-mcp
   ```

   **Claude Desktop, Cursor, Windsurf** (`claude_desktop_config.json`, `.cursor/mcp.json`, ...)

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

   **Cline** (MCP Servers → Configure → `cline_mcp_settings.json`)

   ```json
   {
     "mcpServers": {
       "synap": {
         "command": "npx",
         "args": ["-y", "synap-mcp"],
         "env": { "SYNAP_API_KEY": "sk-..." },
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```

   Step-by-step notes for agents installing this server: [`llms-install.md`](llms-install.md).

3. Ask your agent: *"Use synap to review my staged diff"*, or *"summarize https://example.com with synap"*.

## Tools

| Tool | What it does |
| --- | --- |
| `chat` | Send OpenAI-style `messages` to any Synap model. Omit `model` to use the router, `synap-v1`, which picks the cheapest model that can do the job. |
| `list_models` | Live model ids with capability, context window and per-token price, from `/v1/models`. Optional `filter`, e.g. `vision` or `coder`. |
| `summarize_url` | Fetches a public page locally, strips it to text and summarizes it (`short`, `medium` or `long`, optional `focus`). |
| `review_diff` | Code review of a unified diff: findings with severity, `path:line` and the fix, then a verdict. A critical or high finding always ends in `REQUEST CHANGES`. |
| `extract_json` | Text to JSON that matches your JSON Schema. The result is validated, and one repair round runs automatically if needed. Returned as `structuredContent`. |
| `describe_image` | Describes or answers questions about a local image file, an image URL, or a `data:` URI, using the cheapest vision model listed. |

Every answer ends with a one-line receipt: the model that actually ran, token counts and, in wallet mode, what was paid and the on-chain transaction.

## Pay per call from a wallet (no account)

Synap accepts [x402](https://x402.org) payments: each call is paid in USDC from your wallet, and calls start at $0.001. The key stays on your machine; only signatures are sent.

```bash
npx -y synap-mcp wallet new      # creates ~/.synap/wallet.key (0600) and prints the address
# send a few dollars of USDC on Base to that address
claude mcp add synap -- npx -y synap-mcp     # no key needed: the wallet file is picked up
```

Or pass an existing key in `SYNAP_WALLET_KEY` (Base, `0x...`) or `SYNAP_SOLANA_KEY` (Solana, base58 or a 64-byte JSON array).

Spending guard rails:

- **Per-call ceiling**: `SYNAP_MAX_PER_CALL_USD` (default `0.10`). It is checked by the official x402 client before anything is signed, and a quote above it is refused, not paid.
- Only USDC can be signed. A payment option that asks to stay valid for more than a day is refused.
- The wallet only pays `synap402.com` (or your `SYNAP_ORIGIN`) and never follows redirects.
- A quote covers the call's `max_tokens`, so the task tools set sensible caps (500 to 2,000 tokens).

`npx synap-mcp wallet` shows the address and its USDC balance on Base.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SYNAP_API_KEY` | none | API key. `LINKRRA_API_KEY` is accepted too. |
| `SYNAP_WALLET_KEY` | `~/.synap/wallet.key` | EVM private key that pays on Base over x402. |
| `SYNAP_SOLANA_KEY` | `~/.synap/solana.key` | Solana secret key that pays on Solana over x402. |
| `SYNAP_PAYMENT` | `auto` | `auto` (the key if set, else the wallet), `api-key`, or `x402`. |
| `SYNAP_MAX_PER_CALL_USD` | `0.10` | x402 per-call ceiling, checked before signing. |
| `SYNAP_X402_NETWORK` | `base` | Which chain to pay on when both wallets are set: `base` or `solana`. |
| `SYNAP_MODEL` | `synap-v1` | Default model for the text tools. |
| `SYNAP_VISION_MODEL` | cheapest vision model | Default model for `describe_image`. |
| `SYNAP_MCP_ALLOW_PRIVATE_URLS` | off | Let `summarize_url` / `describe_image` fetch localhost and private-network addresses. |
| `SYNAP_MCP_MAX_INPUT_CHARS` | `80000` | Cap on page, diff or text size sent to a model. It is also bounded by the model's context window. |
| `SYNAP_HOME` | `~/.synap` | Where wallet files live. |

## Safety

- **Untrusted content is data.** Web pages, diffs and texts are fenced with markers they cannot close, and the model is told never to follow instructions inside them.
- **Local fetching is guarded.** Only `http(s)` is fetched. Loopback, private, link-local and metadata addresses are refused unless you allow them, each redirect hop is re-checked, and responses are capped at 5 MB for pages and 10 MB for images.
- **Images are checked by content.** `describe_image` reads only png, jpeg, gif or webp files, verified by their magic bytes, so it cannot be used to read arbitrary local files.
- **Secrets are never printed.** `doctor` says `present` or `none`, and error messages redact the key.

## Commands

```bash
npx synap-mcp               # run the MCP server on stdio (what clients launch)
npx synap-mcp doctor        # payment mode, wallet sources, live model count; no secrets printed
npx synap-mcp wallet        # wallet address(es) and Base USDC balance
npx synap-mcp wallet new    # create a Base wallet at ~/.synap/wallet.key
```

## Troubleshooting

- **"Synap needs a payment method"**: set `SYNAP_API_KEY`, or create and fund a wallet (see above). `list_models` works without either.
- **`HTTP 402` with an API key**: the account is out of credits. Top up at [synap402.com/account.html](https://synap402.com/account.html).
- **"No answer text ... reasoning models think first"**: the router picked a reasoning model and your `max_tokens` ran out before it answered. Raise `max_tokens`.
- **"exceeds the per-call ceiling"**: the quote for this call (model price times `max_tokens`) is above `SYNAP_MAX_PER_CALL_USD`. Lower `max_tokens`, pick a cheaper model, or raise the ceiling.

## Development

```bash
npm install
npm test            # unit tests: fake Synap and a fake x402 seller that verifies real EIP-3009 signatures
npm run build
SYNAP_E2E_KEY_FILE=~/synap.key npm run test:e2e     # live: spawns dist/ over stdio with the MCP client
```

Node 20.3 or later. MIT licensed.

Links: [synap402.com](https://synap402.com) · [Models and prices](https://synap402.com/models.html) · [Docs](https://synap402.com/docs.html) · [x402 guide](https://synap402.com/guides/x402.html)
