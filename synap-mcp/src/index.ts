#!/usr/bin/env node
// synap-mcp entry point.
//   synap-mcp               run the MCP server on stdio (what MCP clients launch)
//   synap-mcp doctor        show configuration and check the live API (no secrets printed)
//   synap-mcp wallet        show wallet address(es) and Base USDC balance
//   synap-mcp wallet new    create a Base wallet in ~/.synap/wallet.key (0600)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { fetchModels } from "./core/models.ts";
import { createEvmWallet, readBaseUsdcBalance, walletDir } from "./core/x402.ts";
import { createSynapMcpServer, USER_AGENT, VERSION } from "./server.ts";

const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

const HELP = `synap-mcp ${VERSION} - MCP server for Synap by Linkrra (https://synap402.com)

Usage:
  synap-mcp               run the MCP server on stdio
  synap-mcp doctor        check configuration and the live API
  synap-mcp wallet        show wallet address(es) and Base USDC balance
  synap-mcp wallet new    create a Base wallet at ~/.synap/wallet.key (0600)

Environment:
  SYNAP_API_KEY           API key (LINKRRA_API_KEY also accepted)
  SYNAP_WALLET_KEY        EVM private key; pays per call in USDC on Base (x402)
  SYNAP_SOLANA_KEY        Solana secret key; pays per call in USDC on Solana (x402)
  SYNAP_MAX_PER_CALL_USD  x402 per-call ceiling, checked before signing (default 0.10)
  SYNAP_X402_NETWORK      base | solana, when both wallets are set (default base)
  SYNAP_PAYMENT           auto | api-key | x402 (default auto: key first, then wallet)
  SYNAP_MODEL             default model for text tools (default: router synap-v1)
  SYNAP_VISION_MODEL      default model for describe_image (default: cheapest vision model)
`;

async function doctor(): Promise<number> {
  const cfg = loadConfig();
  out(`synap-mcp ${VERSION}`);
  out(`origin:   ${cfg.origin}`);
  out(`payment:  ${cfg.mode}${cfg.mode === "api-key" ? ` (key from ${cfg.apiKeySource})` : ""}`);
  out(`api key:  ${cfg.apiKey ? "present" : "none"}`);
  out(`wallet:   ${cfg.wallet.evm ? `Base key (${cfg.wallet.sources.evm})` : "no Base key"}; ${cfg.wallet.solana ? `Solana key (${cfg.wallet.sources.solana})` : "no Solana key"}`);
  if (cfg.mode === "x402") out(`ceiling:  $${cfg.maxPerCallUsd} per call`);
  try {
    const models = await fetchModels({ origin: cfg.origin, userAgent: USER_AGENT });
    out(`models:   ${models.length} live (${models.slice(0, 6).map((m) => m.id).join(", ")}${models.length > 6 ? ", ..." : ""})`);
  } catch (e) {
    out(`models:   UNREACHABLE (${(e as Error).message})`);
    return 1;
  }
  if (cfg.mode === "none") out(`\nNo payment method yet. Set SYNAP_API_KEY (https://synap402.com), or run \`synap-mcp wallet new\` and fund it with USDC on Base.`);
  return 0;
}

async function wallet(sub: string | undefined): Promise<number> {
  if (sub === "new") {
    const w = await createEvmWallet(walletDir());
    out(w.created ? `Created a Base wallet.` : `A wallet already exists; not replacing it.`);
    out(`address: ${w.address}`);
    out(`key:     ${w.path} (0600; back it up, it is the only copy)`);
    out(`Fund it with USDC on Base (any amount; calls start at $0.001). synap-mcp reads this file automatically.`);
    return 0;
  }
  const cfg = loadConfig();
  if (!cfg.wallet.evm && !cfg.wallet.solana) {
    err("No wallet configured. Run `synap-mcp wallet new`, or set SYNAP_WALLET_KEY / SYNAP_SOLANA_KEY.");
    return 2;
  }
  const { createPayFetch } = await import("./core/x402.ts");
  const pf = await createPayFetch({ keys: cfg.wallet, origin: cfg.origin, maxPerCallUsd: cfg.maxPerCallUsd });
  if (pf?.addresses.base) {
    out(`Base:   ${pf.addresses.base}`);
    try {
      out(`        USDC balance $${(await readBaseUsdcBalance(pf.addresses.base)).toFixed(6)}`);
    } catch (e) {
      out(`        balance unreadable (${(e as Error).message.slice(0, 120)})`);
    }
  }
  if (pf?.addresses.solana) out(`Solana: ${pf.addresses.solana}`);
  out(`Per-call ceiling: $${cfg.maxPerCallUsd}`);
  return 0;
}

async function serve(): Promise<void> {
  const { server, config } = createSynapMcpServer();
  if (config.mode === "none") err("[synap-mcp] no API key or wallet configured: list_models works; other tools explain how to set one up.");
  await server.connect(new StdioServerTransport());
}

async function main(argv: string[]): Promise<number | undefined> {
  const [cmd, sub] = argv;
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    out(HELP);
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    out(VERSION);
    return 0;
  }
  if (cmd === "doctor") return doctor();
  if (cmd === "wallet") return wallet(sub);
  if (cmd) {
    err(`unknown command: ${cmd}\n\n${HELP}`);
    return 2;
  }
  await serve();
  return undefined;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== undefined) process.exit(code);
  },
  (e: unknown) => {
    err(`synap-mcp: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  },
);
