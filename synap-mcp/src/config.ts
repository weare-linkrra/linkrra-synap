// Runtime configuration for synap-mcp, read from the environment the MCP
// client launches the server with. Secrets are never logged or echoed.
import { DEFAULT_ORIGIN, normalizeOrigin } from "./core/models.ts";
import {
  hasWallet,
  parseMaxPerCallUsd,
  parsePreferredNetwork,
  resolveWalletKeys,
  type PayNetwork,
  type WalletKeys,
} from "./core/x402.ts";

export type PaymentMode = "api-key" | "x402" | "none";

export interface SynapMcpConfig {
  origin: string;
  apiKey?: string;
  /** Where the key came from (env var name), for diagnostics only. */
  apiKeySource?: string;
  wallet: WalletKeys;
  mode: PaymentMode;
  defaultModel?: string;
  visionModel?: string;
  maxPerCallUsd: number;
  preferNetwork?: PayNetwork;
  allowPrivateUrls: boolean;
  maxInputChars: number;
}

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SynapMcpConfig {
  const origin = normalizeOrigin(env.SYNAP_ORIGIN || env.SYNAP_BASE_URL || DEFAULT_ORIGIN);
  let apiKey: string | undefined;
  let apiKeySource: string | undefined;
  for (const name of ["SYNAP_API_KEY", "LINKRRA_API_KEY"]) {
    const v = (env[name] ?? "").trim();
    if (v) {
      apiKey = v;
      apiKeySource = name;
      break;
    }
  }
  const wallet = resolveWalletKeys({ env });
  const requested = (env.SYNAP_PAYMENT ?? "auto").trim().toLowerCase();
  let mode: PaymentMode;
  if (requested === "x402" || requested === "wallet") {
    if (!hasWallet(wallet)) {
      throw new Error("SYNAP_PAYMENT=x402 needs a wallet: set SYNAP_WALLET_KEY (Base) or SYNAP_SOLANA_KEY, or run `npx synap-mcp wallet new`");
    }
    mode = "x402";
  } else if (requested === "api-key" || requested === "key") {
    if (!apiKey) throw new Error("SYNAP_PAYMENT=api-key needs SYNAP_API_KEY (get one at https://synap402.com)");
    mode = "api-key";
  } else {
    mode = apiKey ? "api-key" : hasWallet(wallet) ? "x402" : "none";
  }
  const maxChars = Number(env.SYNAP_MCP_MAX_INPUT_CHARS);
  const cfg: SynapMcpConfig = {
    origin,
    wallet,
    mode,
    maxPerCallUsd: parseMaxPerCallUsd(env.SYNAP_MAX_PER_CALL_USD),
    allowPrivateUrls: truthy(env.SYNAP_MCP_ALLOW_PRIVATE_URLS),
    maxInputChars: Number.isFinite(maxChars) && maxChars >= 1000 ? Math.floor(maxChars) : 80_000,
  };
  if (apiKey) cfg.apiKey = apiKey;
  if (apiKeySource) cfg.apiKeySource = apiKeySource;
  const model = (env.SYNAP_MODEL ?? "").trim();
  if (model) cfg.defaultModel = model;
  const vision = (env.SYNAP_VISION_MODEL ?? "").trim();
  if (vision) cfg.visionModel = vision;
  const net = parsePreferredNetwork(env.SYNAP_X402_NETWORK);
  if (net) cfg.preferNetwork = net;
  return cfg;
}
