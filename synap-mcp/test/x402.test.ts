import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  BASE_CAIP2,
  createEvmWallet,
  createPayFetch,
  DEFAULT_MAX_PER_CALL_USD,
  normalizeEvmKey,
  normalizeSolanaKey,
  parseMaxPerCallUsd,
  parsePreferredNetwork,
  readSettlement,
  requirementUsd,
  resolveWalletKeys,
  selectRequirement,
  SOLANA_CAIP2,
  USDC_BASE,
  USDC_SOLANA,
} from "../src/core/x402.ts";
import { startFakeSeller } from "./helpers/fake-seller.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "synap-x402-"));

test("resolveWalletKeys precedence: config > env > key file; malformed keys ignored", () => {
  const dir = tmp();
  const fileKey = generatePrivateKey();
  writeFileSync(join(dir, "wallet.key"), `${fileKey}\n`);
  const envKey = generatePrivateKey();
  const cfgKey = generatePrivateKey();
  assert.equal(resolveWalletKeys({ dir, env: {} }).evm, fileKey);
  assert.equal(resolveWalletKeys({ dir, env: { SYNAP_WALLET_KEY: envKey } }).evm, envKey);
  const all = resolveWalletKeys({ dir, env: { SYNAP_WALLET_KEY: envKey }, walletKey: cfgKey });
  assert.equal(all.evm, cfgKey);
  assert.equal(all.sources.evm, "config");
  assert.equal(resolveWalletKeys({ dir, env: { SYNAP_WALLET_KEY: "0xnothex" } }).evm, fileKey);
  assert.equal(resolveWalletKeys({ dir: tmp(), env: {} }).evm, undefined);
});

test("key normalization", () => {
  const k = generatePrivateKey();
  assert.equal(normalizeEvmKey(k.slice(2)), k);
  assert.equal(normalizeEvmKey("0x1234"), undefined);
  const arr = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));
  assert.equal(normalizeSolanaKey(arr), arr);
  assert.equal(normalizeSolanaKey("[1,2,3]"), undefined);
  assert.equal(normalizeSolanaKey("0OIl"), undefined, "not base58");
  assert.ok(normalizeSolanaKey("5".repeat(88)));
});

test("ceiling and network parsing never disable the cap on bad input", () => {
  assert.equal(parseMaxPerCallUsd("0.25"), 0.25);
  for (const bad of ["", "off", "0", "-1", "abc", undefined, null]) assert.equal(parseMaxPerCallUsd(bad), DEFAULT_MAX_PER_CALL_USD);
  assert.equal(parsePreferredNetwork("Solana"), "solana");
  assert.equal(parsePreferredNetwork(BASE_CAIP2), "base");
  assert.equal(parsePreferredNetwork("eth"), undefined);
});

test("requirementUsd prices only USDC, from the signed amount field", () => {
  assert.equal(requirementUsd({ asset: USDC_BASE, amount: "1000" }), 0.001);
  assert.equal(requirementUsd({ asset: USDC_BASE.toLowerCase(), maxAmountRequired: "2500000" }), 2.5);
  assert.equal(requirementUsd({ asset: USDC_SOLANA, amount: "10" }), 0.00001);
  assert.equal(requirementUsd({ asset: "0xdead", amount: "1" }), undefined);
  assert.equal(requirementUsd({ asset: USDC_BASE, amount: "1.5" }), undefined);
});

test("selectRequirement prefers the requested network among payable ones", () => {
  const accepts = [
    { scheme: "exact", network: SOLANA_CAIP2, amount: "1" },
    { scheme: "exact", network: BASE_CAIP2, amount: "1" },
  ];
  assert.equal(selectRequirement(accepts, [BASE_CAIP2, SOLANA_CAIP2]).network, BASE_CAIP2);
  assert.equal(selectRequirement(accepts, [BASE_CAIP2, SOLANA_CAIP2], "solana").network, SOLANA_CAIP2);
  assert.equal(selectRequirement(accepts, [SOLANA_CAIP2]).network, SOLANA_CAIP2);
});

test("readSettlement decodes the PAYMENT-RESPONSE receipt", () => {
  const h = new Headers({ "payment-response": Buffer.from(JSON.stringify({ success: true, transaction: "0xabc", network: BASE_CAIP2 })).toString("base64") });
  assert.deepEqual(readSettlement(h), { success: true, transaction: "0xabc", network: BASE_CAIP2 });
  assert.equal(readSettlement(new Headers()), undefined);
  assert.equal(readSettlement(new Headers({ "payment-response": "%%%" })), undefined);
});

test("createPayFetch returns null without a wallet", async () => {
  assert.equal(await createPayFetch({ keys: { sources: {} } }), null);
});

test("createPayFetch signs a real EIP-3009 payment the seller can verify", async () => {
  const seller = await startFakeSeller();
  try {
    const pk = generatePrivateKey();
    const seen: string[] = [];
    const pf = await createPayFetch({ keys: { evm: pk, sources: {} }, origin: seller.origin, onPayment: (p) => seen.push(p.network) });
    assert.ok(pf);
    assert.equal(pf.addresses.base, privateKeyToAccount(pk).address);
    const res = await pf.fetch(`${seller.origin}/api/billing/x402/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content, "paid answer");
    assert.equal(seller.verified.length, 1);
    assert.equal(seller.verified[0]!.valid, true, "signature verifies against the payer address");
    assert.equal(seller.verified[0]!.value, "1000");
    assert.deepEqual(seen, [BASE_CAIP2]);
    assert.equal(pf.totalUsd(), 0.001);
    assert.equal(readSettlement(res.headers)?.transaction, "0xfeedbeef");
  } finally {
    await seller.close();
  }
});

test("createPayFetch refuses a quote over the per-call ceiling before signing", async () => {
  const seller = await startFakeSeller({ amount: "500000" }); // $0.50
  try {
    const pf = await createPayFetch({ keys: { evm: generatePrivateKey(), sources: {} }, origin: seller.origin, maxPerCallUsd: 0.1 });
    await assert.rejects(
      pf!.fetch(`${seller.origin}/api/billing/x402/chat/completions`, { method: "POST", body: "{}" }),
      /spendControls|ceiling/,
    );
    assert.equal(seller.requests.filter((r) => r.headers["payment-signature"]).length, 0, "nothing signed was sent");
    assert.equal(pf!.payments.length, 0);
  } finally {
    await seller.close();
  }
});

test("createPayFetch refuses long-lived payment options", async () => {
  const seller = await startFakeSeller({ maxTimeoutSeconds: 7 * 86_400 });
  try {
    const pf = await createPayFetch({ keys: { evm: generatePrivateKey(), sources: {} }, origin: seller.origin });
    await assert.rejects(pf!.fetch(`${seller.origin}/v1/chat/completions`, { method: "POST", body: "{}" }), /valid/);
    assert.equal(seller.requests.filter((r) => r.headers["payment-signature"]).length, 0);
  } finally {
    await seller.close();
  }
});

test("createPayFetch never pays a host other than the configured origin", async () => {
  const pf = await createPayFetch({ keys: { evm: generatePrivateKey(), sources: {} }, origin: "https://synap402.com" });
  await assert.rejects(pf!.fetch("https://evil.example/api/billing/x402/chat/completions", { method: "POST" }), /refuses to pay a host/);
  await assert.rejects(pf!.fetch("https://synap402.com.evil.example/x", { method: "POST" }), /refuses to pay a host/);
});

test("createEvmWallet writes a 0600 key once and never overwrites it", async () => {
  const dir = join(tmp(), "nested");
  const a = await createEvmWallet(dir);
  assert.equal(a.created, true);
  assert.equal(statSync(a.path).mode & 0o777, 0o600);
  const b = await createEvmWallet(dir);
  assert.equal(b.created, false);
  assert.equal(b.address, a.address);
  assert.equal(resolveWalletKeys({ dir, env: {} }).evm !== undefined, true);
});
