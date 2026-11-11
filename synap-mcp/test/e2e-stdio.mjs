// Live end-to-end smoke: spawns the BUILT server (dist/index.js) over stdio
// with the official MCP client and calls tools against the real Synap API.
//
//   API key:  SYNAP_E2E_KEY_FILE=/path/to/key  node test/e2e-stdio.mjs
//   x402:     SYNAP_WALLET_KEY=0x...  E2E_MODE=x402  node test/e2e-stdio.mjs
//
// Secrets are read from files/env and passed to the child process only;
// nothing secret is printed. E2E_TOOLS (comma list) limits which tools run.
// E2E_MODEL pins the text model (e.g. a free-tier model for a probe key).
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mode = process.env.E2E_MODE ?? "key";
const only = (process.env.E2E_TOOLS ?? "list_models,chat,review_diff,extract_json,summarize_url,describe_image").split(",");
const env = { PATH: process.env.PATH, HOME: process.env.HOME, SYNAP_HOME: mkdtempSync(join(tmpdir(), "synap-e2e-")) };
if (mode === "key") {
  const keyFile = process.env.SYNAP_E2E_KEY_FILE;
  if (!keyFile) throw new Error("set SYNAP_E2E_KEY_FILE");
  env.SYNAP_API_KEY = readFileSync(keyFile, "utf8").trim();
} else {
  if (!process.env.SYNAP_WALLET_KEY) throw new Error("set SYNAP_WALLET_KEY for x402 mode");
  env.SYNAP_WALLET_KEY = process.env.SYNAP_WALLET_KEY;
  env.SYNAP_MAX_PER_CALL_USD = process.env.SYNAP_MAX_PER_CALL_USD ?? "0.02";
}
if (process.env.E2E_MODEL) env.SYNAP_MODEL = process.env.E2E_MODEL;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../dist/index.js", import.meta.url).pathname],
  env,
  stderr: "pipe",
});
const stderr = [];
transport.stderr?.on("data", (c) => stderr.push(String(c)));
const client = new Client({ name: "synap-e2e", version: "1.0.0" });
await client.connect(transport);
const info = client.getServerVersion();
console.log(`connected: ${info.name} ${info.version} (mode=${mode})`);
const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);

let failures = 0;
const show = (s, n = 700) => (s.length > n ? `${s.slice(0, n)} …[${s.length - n} more chars]` : s);
async function call(name, args, check) {
  if (!only.includes(name)) return;
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.map((c) => c.text ?? "").join("\n") ?? "";
  const ok = !r.isError && check(text, r);
  if (!ok) failures++;
  console.log(`\n=== ${name} ${ok ? "OK" : "FAIL"} (${Date.now() - t0} ms)\n${show(text)}`);
}

await call("list_models", {}, (t) => /models? live at https:\/\/synap402\.com\/v1\/models/.test(t) && /per 1M tokens/.test(t));
await call("chat", { messages: [{ role: "user", content: "Reply with exactly: SYNAP_MCP_OK" }], max_tokens: 300 }, (t) => t.includes("SYNAP_MCP_OK"));
await call(
  "review_diff",
  {
    diff: [
      "--- a/src/paginate.js",
      "+++ b/src/paginate.js",
      "@@ -1,6 +1,6 @@",
      " export function page(items, pageNo, size) {",
      "-  const start = (pageNo - 1) * size;",
      "+  const start = pageNo * size;",
      "   return items.slice(start, start + size);",
      " }",
    ].join("\n"),
    context: "pages are 1-based in the public API",
  },
  (t) => /severity|REQUEST CHANGES|APPROVE/i.test(t),
);
await call(
  "extract_json",
  {
    text: "Invoice 2026-118 from Acme GmbH, issued 3 Nov 2026, total EUR 1,240.50, due in 30 days.",
    schema: {
      type: "object",
      properties: { invoice_number: { type: "string" }, vendor: { type: "string" }, total: { type: "number" }, currency: { type: "string" } },
      required: ["invoice_number", "vendor", "total", "currency"],
    },
  },
  (_t, r) => r.structuredContent?.data?.total === 1240.5,
);
await call("summarize_url", { url: "https://example.com", length: "short" }, (t) => /example/i.test(t));
if (only.includes("describe_image")) {
  if (!process.env.E2E_IMAGE) throw new Error("set E2E_IMAGE to a png/jpg path or URL for describe_image");
  await call("describe_image", { image: process.env.E2E_IMAGE, prompt: "Describe this image in one or two sentences, and quote any visible text." }, (t) => t.length > 20);
}

await client.close();
if (stderr.length) console.log(`\n[server stderr]\n${stderr.join("").trim()}`);
console.log(`\n${failures ? `FAILED: ${failures}` : "ALL OK"}`);
process.exit(failures ? 1 : 0);
