# Installing synap-mcp (notes for Cline and other agents)

`synap-mcp` is published on npm. There is nothing to clone or build: the MCP
client launches it with `npx`.

## Requirements

- Node.js 18 or later (`node --version`), so that `npx` is available.
- Optional: a Synap API key (`sk-...`) from https://synap402.com/account.html.
  Without a key, `list_models` still works; paid tools return a clear error
  and nothing is charged. A wallet can pay per call instead (see README).

## Steps

1. Open the MCP settings file. For Cline it is `cline_mcp_settings.json`
   (MCP Servers → Configure MCP Servers).
2. Add this entry under `mcpServers`, keeping any existing servers:

   ```json
   "synap": {
     "command": "npx",
     "args": ["-y", "synap-mcp"],
     "env": { "SYNAP_API_KEY": "<the user's Synap API key>" },
     "timeout": 60,
     "disabled": false,
     "autoApprove": []
   }
   ```

   If the user has no key yet, omit the `env` block entirely. Keep
   `"timeout": 60`: the first `npx` start downloads the package and can take
   longer than a client's default handshake timeout.
3. Save the file. The client starts the server; it should report 6 tools:
   `chat`, `list_models`, `summarize_url`, `review_diff`, `extract_json`,
   `describe_image`.
4. Verify by calling `list_models`. It returns the live model ids and prices
   from https://synap402.com/v1/models.

## Optional check from a terminal

```bash
npx -y synap-mcp doctor
```

prints the API origin it will use and how many models are live.

## Hosted alternative (no Node needed)

Clients that support Streamable HTTP can connect to `https://synap402.com/mcp`
directly, sending the key as `Authorization: Bearer sk-...`.
