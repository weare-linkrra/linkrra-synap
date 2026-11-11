import assert from "node:assert/strict";
import { test } from "node:test";
import { answerText, errorMessageFrom, SynapClient, SynapError } from "../src/client.ts";

test("answerText explains an empty answer from a reasoning model that hit max_tokens", async () => {
  const fake: typeof fetch = async () =>
    new Response(JSON.stringify({ model: "gpt-oss-20b", choices: [{ message: { content: "", reasoning_content: "thinking..." }, finish_reason: "length" }] }), { status: 200 });
  const r = await new SynapClient({ apiKey: "k", userAgent: "t", fetch: fake }).chat({ model: "synap-v1", messages: [] });
  assert.equal(r.reasoningChars, 11);
  assert.match(answerText(r), /larger max_tokens/);
  assert.equal(answerText({ text: "hi", model: "m" }), "hi");
  assert.equal(answerText({ text: " ", model: "m", finishReason: "stop" }), "(The model returned no text.)");
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("api-key mode posts to /v1/chat/completions with a Bearer and parses the answer", async () => {
  let seen: { url: string; auth: string | null; body: Record<string, unknown> } | undefined;
  const fake: typeof fetch = async (input, init) => {
    seen = { url: String(input), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) };
    return json(200, {
      model: "qwen3-coder-30b",
      choices: [{ message: { role: "assistant", content: [{ type: "text", text: "hel" }, { type: "text", text: "lo" }] }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    });
  };
  const c = new SynapClient({ apiKey: "sk-test", fetch: fake, userAgent: "t", origin: "https://synap402.com/v1" });
  assert.equal(c.mode, "api-key");
  const r = await c.chat({ model: "synap-v1", messages: [{ role: "user", content: "hi" }], max_tokens: 5 });
  assert.equal(seen!.url, "https://synap402.com/v1/chat/completions");
  assert.equal(seen!.auth, "Bearer sk-test");
  assert.equal(seen!.body.stream, false);
  assert.equal(seen!.body.max_tokens, 5);
  assert.equal(r.text, "hello");
  assert.equal(r.model, "qwen3-coder-30b");
  assert.equal(r.finishReason, "stop");
  assert.equal(r.payment, undefined);
});

test("no payment method -> a setup error that names both options", async () => {
  const c = new SynapClient({ userAgent: "t" });
  assert.equal(c.mode, "none");
  await assert.rejects(c.chat({ model: "m", messages: [] }), (e: unknown) => {
    assert.ok(e instanceof SynapError);
    assert.match(e.message, /SYNAP_API_KEY/);
    assert.match(e.message, /SYNAP_WALLET_KEY/);
    assert.match(e.message, /synap402\.com/);
    return true;
  });
});

test("errors carry the server's sentence plus a fix", async () => {
  const c401 = new SynapClient({ apiKey: "k", userAgent: "t", fetch: async () => json(401, { error: { message: "Invalid API key", type: "auth" } }) });
  await assert.rejects(c401.chat({ model: "m", messages: [] }), /Invalid API key Check SYNAP_API_KEY/);
  const c402 = new SynapClient({ apiKey: "k", userAgent: "t", fetch: async () => json(402, { error: { message: "Insufficient credits" } }) });
  await assert.rejects(c402.chat({ model: "m", messages: [] }), /Insufficient credits Add credits at https:\/\/synap402\.com/);
});

test("errorMessageFrom reads x402 quotes and suggested models, hides the bare header error", () => {
  const m = errorMessageFrom(402, {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    quote: { model: '"x" is not offered. Suggested: gemma.' },
    suggested_model: { id: "gemma" },
  });
  assert.equal(m.message, '"x" is not offered. Suggested: gemma. Suggested model: gemma.');
  assert.equal(errorMessageFrom(500, "boom").message, "Synap answered HTTP 500");
});

test("redirects are refused and network errors never echo the key", async () => {
  const redirect = new SynapClient({ apiKey: "k", userAgent: "t", fetch: async () => new Response(null, { status: 302, headers: { location: "https://elsewhere" } }) });
  await assert.rejects(redirect.chat({ model: "m", messages: [] }), /refusing to follow/);
  const leaky = new SynapClient({ apiKey: "sk-secret-123", userAgent: "t", fetch: async () => { throw new Error("socket closed while sending sk-secret-123"); } });
  await assert.rejects(leaky.chat({ model: "m", messages: [] }), (e: unknown) => {
    assert.doesNotMatch((e as Error).message, /sk-secret-123/);
    assert.match((e as Error).message, /\[redacted\]/);
    return true;
  });
});

test("x402 mode posts to the x402 door and reports what was paid", async () => {
  const payments: Array<{ network: string; asset: string; payTo: string; amountAtomic: string; amountUsd?: number; at: string }> = [];
  let url = "";
  const payFetch = {
    fetch: (async (input: RequestInfo | URL) => {
      url = String(input);
      payments.push({ network: "eip155:8453", asset: "usdc", payTo: "x", amountAtomic: "1000", amountUsd: 0.001, at: "now" });
      return json(200, { model: "m", choices: [{ message: { content: "ok" } }] }, {
        "payment-response": Buffer.from(JSON.stringify({ success: true, transaction: "0xabc", network: "eip155:8453" })).toString("base64"),
      });
    }) as typeof fetch,
    networks: ["eip155:8453"],
    addresses: {},
    maxPerCallUsd: 0.1,
    payments,
    totalUsd: () => 0.001,
  };
  const c = new SynapClient({ payFetch, userAgent: "t" });
  assert.equal(c.mode, "x402");
  const r = await c.chat({ model: "m", messages: [{ role: "user", content: "hi" }] });
  assert.equal(url, "https://synap402.com/api/billing/x402/chat/completions");
  assert.deepEqual(r.payment, { usd: 0.001, network: "eip155:8453", transaction: "0xabc" });
});
