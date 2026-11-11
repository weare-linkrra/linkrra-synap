import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodeEntities, htmlToText, isPrivateAddress, loadImageDataUri, loadPageText, sniffImageType } from "../src/fetch-content.ts";

// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("isPrivateAddress covers loopback, RFC1918, link-local, CGNAT, ULA and v4-mapped", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("htmlToText keeps readable text, drops scripts/styles, decodes entities", () => {
  const html = `<!doctype html><html><head><title>A &amp; B</title><style>p{}</style></head>
  <body><script>alert(1)</script><h1>Hello</h1><p>Price: &#36;5 &lt;per&gt;&nbsp;month</p><ul><li>one</li><li>two</li></ul><!-- hidden --></body></html>`;
  const { title, text } = htmlToText(html);
  assert.equal(title, "A & B");
  assert.match(text, /Hello/);
  assert.match(text, /Price: \$5 <per> month/);
  assert.match(text, /- one\n+- two/);
  assert.doesNotMatch(text, /alert|p\{\}|hidden/);
  assert.equal(decodeEntities("&#x41;&bogus;"), "A&bogus;");
});

test("sniffImageType trusts bytes, not names", () => {
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(Buffer.from("not an image")), undefined);
});

test("loadImageDataUri: local file, data URI, and refusals", async () => {
  const dir = mkdtempSync(join(tmpdir(), "synap-img-"));
  const p = join(dir, "shot.png");
  writeFileSync(p, PNG);
  const uri = await loadImageDataUri(p, { allowPrivate: false, userAgent: "t" });
  assert.ok(uri.startsWith("data:image/png;base64,"));
  assert.equal(await loadImageDataUri(uri, { allowPrivate: false, userAgent: "t" }), uri);
  const fake = join(dir, "secret.png");
  writeFileSync(fake, "plain text renamed to .png (stands in for a secret file)");
  await assert.rejects(loadImageDataUri(fake, { allowPrivate: false, userAgent: "t" }), /not a png/);
  await assert.rejects(loadImageDataUri(join(dir, "notes.txt"), { allowPrivate: false, userAgent: "t" }), /must be \.png/);
  await assert.rejects(loadImageDataUri("data:text/html;base64,AAAA", { allowPrivate: false, userAgent: "t" }), /data: URIs/);
});

test("loadPageText refuses local addresses by default and follows redirects when allowed", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/old") {
      res.writeHead(301, { location: "/page" });
      return res.end();
    }
    if (req.url === "/page") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<html><head><title>T</title></head><body><p>${"word ".repeat(50)}</p></body></html>`);
    }
    if (req.url === "/pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end("%PDF");
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await assert.rejects(loadPageText(`${base}/page`, { allowPrivate: false, maxChars: 1000, userAgent: "t" }), /private or local/);
    const page = await loadPageText(`${base}/old`, { allowPrivate: true, maxChars: 40, userAgent: "t" });
    assert.equal(page.url, `${base}/page`);
    assert.equal(page.title, "T");
    assert.equal(page.truncated, true);
    assert.equal(page.text.length, 40);
    await assert.rejects(loadPageText(`${base}/pdf`, { allowPrivate: true, maxChars: 100, userAgent: "t" }), /not a text page/);
    await assert.rejects(loadPageText(`${base}/missing`, { allowPrivate: true, maxChars: 100, userAgent: "t" }), /HTTP 404/);
    await assert.rejects(loadPageText("ftp://example.com/x", { allowPrivate: true, maxChars: 100, userAgent: "t" }), /Only http/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
