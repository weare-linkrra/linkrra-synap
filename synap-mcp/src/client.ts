// Minimal Synap chat client: API key (Bearer) or x402 wallet payment.
import { normalizeOrigin } from "./core/models.ts";
import { readSettlement, X402_CHAT_PATH, type PayFetch, type Settlement } from "./core/x402.ts";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatPayment {
  usd?: number;
  network?: string;
  transaction?: string;
}

export interface ChatResult {
  text: string;
  /** The model that actually answered (a router id resolves to a concrete model). */
  model: string;
  finishReason?: string;
  usage?: ChatUsage;
  payment?: ChatPayment;
  /** Length of hidden reasoning text, when the model returned some (reasoning models). */
  reasoningChars?: number;
}

/** The answer text, or an explanation when the model produced none. */
export function answerText(r: ChatResult): string {
  if (r.text.trim()) return r.text;
  if (r.finishReason === "length") {
    return "(No answer text: the model spent the whole max_tokens budget before answering; reasoning models think first. Retry with a larger max_tokens, e.g. 1024.)";
  }
  return "(The model returned no text.)";
}

export class SynapError extends Error {
  status: number | undefined;
  code: string | undefined;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "SynapError";
    this.status = status;
    this.code = code;
  }
}

export const SETUP_HINT =
  "Synap needs a payment method: set SYNAP_API_KEY (create one at https://synap402.com), " +
  "or set SYNAP_WALLET_KEY / SYNAP_SOLANA_KEY to pay per call in USDC over x402 (run `npx synap-mcp wallet new` to make a Base wallet).";

export interface SynapClientOptions {
  origin?: string;
  apiKey?: string;
  payFetch?: PayFetch | null;
  fetch?: typeof globalThis.fetch;
  userAgent: string;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The most useful sentence out of a Synap / OpenAI-style error body. */
export function errorMessageFrom(status: number, body: unknown): { message: string; code?: string } {
  if (isRecord(body)) {
    const err = body.error;
    const parts: string[] = [];
    let code: string | undefined;
    if (isRecord(err)) {
      if (typeof err.message === "string") parts.push(err.message);
      if (typeof err.code === "string") code = err.code;
      else if (typeof err.type === "string") code = err.type;
    } else if (typeof err === "string" && !/PAYMENT-SIGNATURE header is required/i.test(err)) {
      parts.push(err);
    }
    const quote = isRecord(body.quote) ? body.quote : undefined;
    if (quote && typeof quote.model === "string" && quote.model.includes("not offered")) parts.push(quote.model);
    const suggested = isRecord(body.suggested_model) ? body.suggested_model : undefined;
    if (suggested && typeof suggested.id === "string") parts.push(`Suggested model: ${suggested.id}.`);
    if (parts.length) return code ? { message: parts.join(" "), code } : { message: parts.join(" ") };
  }
  return { message: `Synap answered HTTP ${status}` };
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

export class SynapClient {
  readonly origin: string;
  private readonly apiKey: string | undefined;
  private readonly payFetch: PayFetch | null;
  private readonly plainFetch: typeof globalThis.fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;

  constructor(opts: SynapClientOptions) {
    this.origin = normalizeOrigin(opts.origin);
    this.apiKey = opts.apiKey;
    this.payFetch = opts.payFetch ?? null;
    this.plainFetch = opts.fetch ?? globalThis.fetch;
    this.userAgent = opts.userAgent;
    this.timeoutMs = opts.timeoutMs ?? 180_000;
  }

  get mode(): "api-key" | "x402" | "none" {
    return this.apiKey ? "api-key" : this.payFetch ? "x402" : "none";
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": this.userAgent,
    };
    let url: string;
    let doFetch: typeof globalThis.fetch;
    const paymentsBefore = this.payFetch?.payments.length ?? 0;
    if (this.apiKey) {
      url = `${this.origin}/v1/chat/completions`;
      headers.authorization = `Bearer ${this.apiKey}`;
      doFetch = this.plainFetch;
    } else if (this.payFetch) {
      url = `${this.origin}${X402_CHAT_PATH}`;
      doFetch = this.payFetch.fetch;
    } else {
      throw new SynapError(SETUP_HINT, undefined, "synap_unconfigured");
    }
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const body = JSON.stringify({ ...req, stream: false });
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const safe = this.apiKey ? msg.split(this.apiKey).join("[redacted]") : msg;
      throw new SynapError(`Request to Synap failed: ${safe}`);
    }
    if (res.status >= 300 && res.status < 400) {
      throw new SynapError(`Synap answered a redirect (HTTP ${res.status}); refusing to follow it with credentials`, res.status);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new SynapError(`Synap answered HTTP ${res.status} with a non-JSON body`, res.status);
    }
    if (!res.ok) {
      const { message, code } = errorMessageFrom(res.status, json);
      const hint =
        res.status === 401 ? " Check SYNAP_API_KEY." : res.status === 402 && this.apiKey ? " Add credits at https://synap402.com." : "";
      throw new SynapError(`${message}${hint}`, res.status, code);
    }
    const doc = isRecord(json) ? json : {};
    const choice = Array.isArray(doc.choices) && isRecord(doc.choices[0]) ? doc.choices[0] : undefined;
    const message = choice && isRecord(choice.message) ? choice.message : undefined;
    const result: ChatResult = {
      text: contentToText(message?.content),
      model: typeof doc.model === "string" ? doc.model : req.model,
    };
    if (choice && typeof choice.finish_reason === "string") result.finishReason = choice.finish_reason;
    const reasoning = message?.reasoning_content ?? message?.reasoning;
    if (typeof reasoning === "string" && reasoning.length) result.reasoningChars = reasoning.length;
    if (isRecord(doc.usage)) result.usage = doc.usage as ChatUsage;
    if (this.payFetch && !this.apiKey) {
      const paid = this.payFetch.payments.slice(paymentsBefore).at(-1);
      const settlement: Settlement | undefined = readSettlement(res.headers);
      if (paid || settlement) {
        const payment: ChatPayment = {};
        if (paid?.amountUsd !== undefined) payment.usd = paid.amountUsd;
        const net = settlement?.network ?? paid?.network;
        if (net) payment.network = net;
        if (settlement?.transaction) payment.transaction = settlement.transaction;
        result.payment = payment;
      }
    }
    return result;
  }
}
