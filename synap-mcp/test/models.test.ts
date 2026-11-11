import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  fetchModels,
  formatPricing,
  ModelCatalog,
  normalizeOrigin,
  parseModelList,
  pickTextModel,
  pickVisionModel,
} from "../src/core/models.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/models.json", import.meta.url), "utf8"));

test("parseModelList: routers first, withdrawn/wildcard/duplicate/id-less rows dropped", () => {
  const models = parseModelList(fixture);
  assert.deepEqual(
    models.map((m) => m.id),
    ["synap-v1", "synap-v1-pro", "qwen/qwen3-vl-30b-a3b-instruct", "qwen3-coder-30b", "deepseek/deepseek-v4-flash"],
  );
  assert.equal(models[0]!.router, true);
});

test("parseModelList: reads context, output cap, tools, vision and live pricing", () => {
  const byId = Object.fromEntries(parseModelList(fixture).map((m) => [m.id, m]));
  const vl = byId["qwen/qwen3-vl-30b-a3b-instruct"]!;
  assert.equal(vl.vision, true);
  assert.equal(vl.contextWindow, 65536);
  assert.equal(vl.maxOutputTokens, 65536);
  assert.equal(vl.tools, true);
  assert.deepEqual(vl.pricing, { inputPerMillion: 0.14, outputPerMillion: 0.55 });
  assert.equal(vl.name, "Qwen: Qwen3 VL 30B A3B Instruct");
  const coder = byId["qwen3-coder-30b"]!;
  assert.equal(coder.vision, false);
  assert.equal(coder.description, "Coding, everyday");
  const flash = byId["deepseek/deepseek-v4-flash"]!;
  assert.equal(flash.contextWindow, undefined);
  assert.equal(flash.tools, undefined);
  assert.equal(byId["synap-v1"]!.pricing, undefined);
});

test("parseModelList tolerates junk", () => {
  assert.deepEqual(parseModelList(null), []);
  assert.deepEqual(parseModelList({ data: "nope" }), []);
  assert.deepEqual(parseModelList([{ id: "a" }]).map((m) => m.id), ["a"]);
  assert.equal(parseModelList([{ id: "x", pricing: { prompt_per_million: 1, completion_per_million: 2, currency: "EUR" } }])[0]!.pricing, undefined);
});

test("pickTextModel / pickVisionModel", () => {
  const models = parseModelList(fixture);
  assert.equal(pickTextModel(models), "synap-v1");
  assert.equal(pickTextModel(models, " qwen3-coder-30b "), "qwen3-coder-30b");
  assert.equal(pickTextModel(models.filter((m) => !m.router)), "qwen/qwen3-vl-30b-a3b-instruct");
  assert.equal(pickVisionModel(models), "qwen/qwen3-vl-30b-a3b-instruct");
  assert.throws(() => pickVisionModel(models.filter((m) => !m.vision)), /No vision model/);
  assert.throws(() => pickTextModel([]), /No Synap model/);
});

test("normalizeOrigin accepts OpenAI-style base URLs and rejects other schemes", () => {
  assert.equal(normalizeOrigin(undefined), "https://synap402.com");
  assert.equal(normalizeOrigin("https://synap402.com/v1/"), "https://synap402.com");
  assert.equal(normalizeOrigin("http://127.0.0.1:9999"), "http://127.0.0.1:9999");
  assert.throws(() => normalizeOrigin("file:///etc/passwd"), /http\(s\)/);
});

test("formatPricing", () => {
  assert.equal(formatPricing({ inputPerMillion: 0.0675, outputPerMillion: 0.27 }), "$0.0675 in / $0.27 out per 1M tokens");
  assert.equal(formatPricing({ inputPerMillion: 0.005, outputPerMillion: 0 }), "$0.0050 in / $0 out per 1M tokens");
  assert.match(formatPricing(undefined), /rate of the model that runs/);
});

test("fetchModels hits /v1/models, sends the key only when given, and caches via ModelCatalog", async () => {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fake: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } });
  };
  const models = await fetchModels({ origin: "https://example.test/v1", fetch: fake });
  assert.equal(models.length, 5);
  assert.deepEqual(calls[0], { url: "https://example.test/v1/models", auth: null });
  const cat = new ModelCatalog({ origin: "https://example.test", fetch: fake, apiKey: "k", ttlMs: 60_000 });
  await Promise.all([cat.list(), cat.list()]);
  await cat.list();
  assert.equal(calls.length, 2, "concurrent and repeated lists share one request");
  assert.equal(calls[1]!.auth, "Bearer k");
  await cat.list(true);
  assert.equal(calls.length, 3);
});

test("fetchModels surfaces HTTP errors and empty catalogs", async () => {
  const err500: typeof fetch = async () => new Response("x", { status: 500 });
  await assert.rejects(fetchModels({ fetch: err500 }), /HTTP 500/);
  const empty: typeof fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
  await assert.rejects(fetchModels({ fetch: empty }), /no requestable models/);
});
