// Packaging invariants for synap-mcp.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const pkg = JSON.parse(read("../package.json"));

test("bin and files are publishable", () => {
  assert.equal(pkg.bin["synap-mcp"], "dist/index.js");
  assert.ok(pkg.files.includes("dist"));
  assert.equal(pkg.license, "MIT");
  assert.ok(existsSync(new URL("../LICENSE", import.meta.url)) || process.env.SKIP_LICENSE_CHECK, "LICENSE present");
  for (const dep of ["@modelcontextprotocol/sdk", "@x402/fetch", "@x402/evm", "@x402/svm", "viem", "zod", "ajv"]) {
    assert.ok(pkg.dependencies[dep], `${dep} is a runtime dependency`);
  }
});

test("shared core is byte-identical to the OpenClaw plugin's copy (when both are checked out)", () => {
  for (const f of ["models.ts", "x402.ts"]) {
    const sibling = new URL(`../../openclaw-provider-synap/src/core/${f}`, import.meta.url);
    if (!existsSync(sibling)) continue;
    assert.equal(read(`../src/core/${f}`), readFileSync(sibling, "utf8"), `src/core/${f} drifted from the plugin`);
  }
});

test("public text never points at the pool host or mentions mining", () => {
  for (const f of ["../README.md", "../package.json", "../src/server.ts", "../src/index.ts", "../src/client.ts", "../src/prompts.ts", "../src/core/x402.ts", "../src/core/models.ts"]) {
    if (!existsSync(new URL(f, import.meta.url))) continue;
    const text = read(f);
    assert.doesNotMatch(text, /pool\.linkrra\.com/i, f);
    assert.doesNotMatch(text, /\bPRL\b|\bmining\b|\bminer\b/i, f);
  }
});
