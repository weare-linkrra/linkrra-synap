// synap-mcp: MCP tools backed by Synap's OpenAI-compatible chat completions.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Ajv } from "ajv";
import { z } from "zod";
import { answerText, SynapClient, SynapError, SETUP_HINT, type ChatMessage, type ChatResult } from "./client.ts";
import { loadConfig, type SynapMcpConfig } from "./config.ts";
import { formatPricing, ModelCatalog, pickTextModel, pickVisionModel, type SynapModel } from "./core/models.ts";
import { createPayFetch, type PayFetch } from "./core/x402.ts";
import { loadImageDataUri, loadPageText } from "./fetch-content.ts";
import {
  describeImagePrompt,
  extractJsonPrompt,
  parseJsonLoose,
  repairJsonMessages,
  enforceReviewVerdict,
  reviewDiffPrompt,
  summarizePrompt,
  type SummaryLength,
} from "./prompts.ts";

export const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();

export const USER_AGENT = `synap-mcp/${VERSION}`;

const NETWORK_NAMES: Record<string, string> = {
  "eip155:8453": "Base",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "Solana",
};

/** One-line run receipt appended to every model answer. */
export function receiptLine(r: ChatResult): string {
  const parts = [`model: ${r.model}`];
  if (r.usage?.prompt_tokens !== undefined || r.usage?.completion_tokens !== undefined) {
    parts.push(`tokens: ${r.usage?.prompt_tokens ?? "?"} in / ${r.usage?.completion_tokens ?? "?"} out`);
  }
  if (r.payment) {
    const net = r.payment.network ? ` on ${NETWORK_NAMES[r.payment.network] ?? r.payment.network}` : "";
    const usd = r.payment.usd !== undefined ? `$${r.payment.usd}` : "x402";
    parts.push(`paid ${usd} USDC${net}${r.payment.transaction ? ` (tx ${r.payment.transaction})` : ""}`);
  }
  if (r.finishReason === "length") parts.push("stopped at max_tokens");
  return `\n\n— ${parts.join(" · ")}`;
}

function ok(text: string, structured?: Record<string, unknown>): CallToolResult {
  const res: CallToolResult = { content: [{ type: "text", text }] };
  if (structured) res.structuredContent = structured;
  return res;
}

function fail(e: unknown): CallToolResult {
  const msg = e instanceof SynapError || e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text", text: msg }] };
}

export interface SynapMcpDeps {
  config?: SynapMcpConfig;
  fetch?: typeof globalThis.fetch;
  /** Overrides wallet payment (tests). */
  payFetch?: PayFetch | null;
  log?: (msg: string) => void;
}

export interface SynapMcp {
  server: McpServer;
  config: SynapMcpConfig;
  client(): Promise<SynapClient>;
  catalog: ModelCatalog;
}

export function createSynapMcpServer(deps: SynapMcpDeps = {}): SynapMcp {
  const config = deps.config ?? loadConfig();
  const log = deps.log ?? ((m: string) => process.stderr.write(`[synap-mcp] ${m}\n`));
  const catalogOpts: ConstructorParameters<typeof ModelCatalog>[0] = { origin: config.origin, userAgent: USER_AGENT, ttlMs: 5 * 60_000 };
  if (deps.fetch) catalogOpts.fetch = deps.fetch;
  if (config.apiKey) catalogOpts.apiKey = config.apiKey;
  const catalog = new ModelCatalog(catalogOpts);

  let clientPromise: Promise<SynapClient> | undefined;
  const client = (): Promise<SynapClient> => {
    clientPromise ??= (async () => {
      let payFetch: PayFetch | null = null;
      if (config.mode === "x402") {
        if (deps.payFetch !== undefined) payFetch = deps.payFetch;
        else {
          const opts: Parameters<typeof createPayFetch>[0] = { keys: config.wallet, origin: config.origin, maxPerCallUsd: config.maxPerCallUsd };
          if (config.preferNetwork) opts.preferNetwork = config.preferNetwork;
          if (deps.fetch) opts.baseFetch = deps.fetch;
          payFetch = await createPayFetch(opts);
        }
        if (payFetch) {
          const who = [payFetch.addresses.base && `Base ${payFetch.addresses.base}`, payFetch.addresses.solana && `Solana ${payFetch.addresses.solana}`].filter(Boolean).join(", ");
          log(`x402 wallet payment: ${who}; per-call ceiling $${payFetch.maxPerCallUsd}`);
        }
      }
      const opts: ConstructorParameters<typeof SynapClient>[0] = { origin: config.origin, payFetch, userAgent: USER_AGENT };
      if (config.mode === "api-key" && config.apiKey) opts.apiKey = config.apiKey;
      if (deps.fetch) opts.fetch = deps.fetch;
      return new SynapClient(opts);
    })();
    clientPromise.catch(() => {
      clientPromise = undefined;
    });
    return clientPromise;
  };

  const requireAuth = () => {
    if (config.mode === "none") throw new SynapError(SETUP_HINT, undefined, "synap_unconfigured");
  };

  const runChat = async (messages: ChatMessage[], model: string, maxTokens?: number, temperature?: number): Promise<ChatResult> => {
    requireAuth();
    const c = await client();
    const req: Parameters<SynapClient["chat"]>[0] = { model, messages };
    if (maxTokens !== undefined) req.max_tokens = maxTokens;
    if (temperature !== undefined) req.temperature = temperature;
    return c.chat(req);
  };

  const textModel = async (explicit?: string): Promise<string> => {
    if (explicit?.trim()) return explicit.trim();
    if (config.defaultModel) return config.defaultModel;
    return pickTextModel(await catalog.list());
  };

  /** Char budget for untrusted input, bounded by the model's context window when known. */
  const inputBudget = async (model: string, maxTokens: number): Promise<number> => {
    let budget = config.maxInputChars;
    try {
      const m = (await catalog.list()).find((x) => x.id === model);
      if (m?.contextWindow) budget = Math.min(budget, Math.max(4000, (m.contextWindow - maxTokens - 2000) * 3));
    } catch {
      /* the catalog is advisory here */
    }
    return budget;
  };

  const server = new McpServer(
    { name: "synap", title: "Synap by Linkrra", version: VERSION, websiteUrl: "https://synap402.com" },
    {
      instructions:
        "Synap by Linkrra runs open models on dedicated GPUs behind an OpenAI-compatible API. Use `chat` for general prompts, " +
        "the task tools (summarize_url, review_diff, extract_json, describe_image) for those jobs, and `list_models` for live model ids and prices. " +
        "Omit `model` to let Synap's router (synap-v1) pick the cheapest model that can do the job.",
    },
  );

  const modelArg = z.string().min(1).max(200).optional().describe("Model id from list_models. Omit to use the router (synap-v1) or SYNAP_MODEL.");

  server.registerTool(
    "chat",
    {
      title: "Chat with a Synap model",
      description: "Send a chat conversation to a Synap model and get the reply. OpenAI-style messages.",
      inputSchema: {
        messages: z
          .array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() }))
          .min(1)
          .describe("Conversation so far, oldest first."),
        model: modelArg,
        max_tokens: z.number().int().min(1).max(32768).optional().describe("Reply length cap (default 2048)."),
        temperature: z.number().min(0).max(2).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ messages, model, max_tokens, temperature }) => {
      try {
        const id = await textModel(model);
        const r = await runChat(messages, id, max_tokens ?? 2048, temperature);
        return ok(answerText(r) + receiptLine(r));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_models",
    {
      title: "List Synap models",
      description: "Live list of Synap model ids with capability, context window and per-token price, read from /v1/models.",
      inputSchema: {
        filter: z.string().max(100).optional().describe("Case-insensitive text to match against id or capability, e.g. 'vision' or 'coder'."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ filter }) => {
      try {
        let models: SynapModel[] = await catalog.list();
        if (filter?.trim()) {
          const f = filter.trim().toLowerCase();
          models = models.filter((m) => `${m.id} ${m.name} ${m.description}`.toLowerCase().includes(f));
        }
        const lines = models.map((m) => {
          const bits = [m.description || m.name];
          if (m.vision) bits.push("reads images");
          if (m.contextWindow) bits.push(`${Math.round(m.contextWindow / 1024)}K context`);
          bits.push(formatPricing(m.pricing));
          return `- ${m.id}: ${bits.join("; ")}`;
        });
        const header = `${models.length} model${models.length === 1 ? "" : "s"} live at ${config.origin}/v1/models (prices in USD, read just now):`;
        return ok([header, ...lines].join("\n"), { models: models as unknown as Record<string, unknown>[] });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "summarize_url",
    {
      title: "Summarize a web page",
      description: "Fetch a public web page and summarize it with a Synap model. Page text is treated as data, never as instructions.",
      inputSchema: {
        url: z.string().url().describe("http(s) URL of the page."),
        focus: z.string().max(500).optional().describe("What to focus on, e.g. 'pricing and limits'."),
        length: z.enum(["short", "medium", "long"]).optional().describe("Summary length (default medium)."),
        model: modelArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url, focus, length, model }) => {
      try {
        requireAuth();
        const len: SummaryLength = length ?? "medium";
        const maxTokens = { short: 500, medium: 900, long: 1800 }[len];
        const id = await textModel(model);
        const page = await loadPageText(url, {
          allowPrivate: config.allowPrivateUrls,
          maxChars: await inputBudget(id, maxTokens),
          userAgent: USER_AGENT,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        });
        if (!page.text.trim()) return fail(new Error(`${page.url} has no readable text`));
        const args: Parameters<typeof summarizePrompt>[0] = { url: page.url, text: page.text, truncated: page.truncated, length: len };
        if (page.title) args.title = page.title;
        if (focus) args.focus = focus;
        const r = await runChat(summarizePrompt(args), id, maxTokens, 0.2);
        return ok(answerText(r) + receiptLine(r));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "review_diff",
    {
      title: "Review a code diff",
      description: "Code review of a unified diff (git diff output): bugs, security issues and missing edge cases, with severity, location and fix.",
      inputSchema: {
        diff: z.string().min(1).describe("Unified diff text, e.g. the output of `git diff`."),
        context: z.string().max(2000).optional().describe("What the change is meant to do."),
        focus: z.string().max(500).optional().describe("Extra attention area, e.g. 'security' or 'concurrency'."),
        model: modelArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ diff, context, focus, model }) => {
      try {
        const id = await textModel(model);
        const maxTokens = 1800;
        const budget = await inputBudget(id, maxTokens);
        if (diff.length > budget) {
          return fail(new Error(`Diff is ${diff.length} characters; this model takes about ${budget}. Split it by file, or pass a model with a larger context window.`));
        }
        const args: Parameters<typeof reviewDiffPrompt>[0] = { diff };
        if (context) args.context = context;
        if (focus) args.focus = focus;
        const r = await runChat(reviewDiffPrompt(args), id, maxTokens, 0.1);
        return ok(enforceReviewVerdict(answerText(r)) + receiptLine(r));
      } catch (e) {
        return fail(e);
      }
    },
  );

  const ajv = new Ajv({ allErrors: true, strict: false });

  server.registerTool(
    "extract_json",
    {
      title: "Extract JSON from text",
      description: "Extract structured data from text into JSON matching a JSON Schema (validated, with one automatic repair attempt).",
      inputSchema: {
        text: z.string().min(1).describe("Source text to extract from."),
        schema: z
          .union([z.record(z.string(), z.unknown()), z.string().min(1)])
          .describe("JSON Schema object for the output, or a plain-language description of the wanted shape."),
        instructions: z.string().max(2000).optional(),
        model: modelArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ text, schema, instructions, model }) => {
      try {
        const id = await textModel(model);
        const maxTokens = 2000;
        const budget = await inputBudget(id, maxTokens);
        if (text.length > budget) return fail(new Error(`Text is ${text.length} characters; this model takes about ${budget}. Split it first.`));
        let validate: ((v: unknown) => boolean) & { errors?: unknown } | undefined;
        if (typeof schema === "object") {
          try {
            validate = ajv.compile(schema);
          } catch (e) {
            return fail(new Error(`schema is not a valid JSON Schema: ${(e as Error).message}`));
          }
        }
        const args: Parameters<typeof extractJsonPrompt>[0] = { text, schema };
        if (instructions) args.instructions = instructions;
        let messages = extractJsonPrompt(args);
        let last: ChatResult | undefined;
        let problem = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          last = await runChat(messages, id, maxTokens, 0);
          try {
            const data = parseJsonLoose(last.text);
            if (validate && !validate(data)) {
              problem = `does not match the schema: ${ajv.errorsText(validate.errors as never)}`;
            } else {
              return ok(JSON.stringify(data, null, 2) + receiptLine(last), { data: data as Record<string, unknown>, model: last.model });
            }
          } catch (e) {
            problem = (e as Error).message;
          }
          messages = repairJsonMessages(messages, last.text, problem);
        }
        return fail(new Error(`The model did not return valid JSON (${problem}). Last output:\n${last?.text ?? ""}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "describe_image",
    {
      title: "Describe an image",
      description: "Describe or answer a question about an image (screenshot, chart, photo, scanned page) with a Synap vision model.",
      inputSchema: {
        image: z.string().min(1).describe("Local file path (png/jpg/gif/webp), http(s) URL, or data: URI."),
        prompt: z.string().max(4000).optional().describe("Question about the image. Default: full description with transcribed text."),
        detail: z.enum(["auto", "low", "high"]).optional(),
        model: z.string().min(1).max(200).optional().describe("Vision model id. Omit to use the cheapest vision model listed."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ image, prompt, detail, model }) => {
      try {
        requireAuth();
        const id = model?.trim() || config.visionModel || pickVisionModel(await catalog.list());
        const dataUri = await loadImageDataUri(image, {
          allowPrivate: config.allowPrivateUrls,
          userAgent: USER_AGENT,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        });
        const args: Parameters<typeof describeImagePrompt>[0] = { image: dataUri };
        if (prompt) args.prompt = prompt;
        if (detail) args.detail = detail;
        const r = await runChat(describeImagePrompt(args), id, 900, 0.2);
        return ok(answerText(r) + receiptLine(r));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return { server, config, client, catalog };
}
