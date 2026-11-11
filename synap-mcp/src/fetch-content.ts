// Local content loading for the task tools: web pages for summarize_url and
// images for describe_image. Runs on the user's machine, so it is guarded:
// http(s) only, private/loopback addresses refused unless explicitly allowed,
// redirects re-checked hop by hop, bounded size and time.
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { extname, resolve } from "node:path";

export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** True for loopback, private, link-local, CGNAT, unique-local and unspecified addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}

async function assertPublicUrl(url: URL, allowPrivate: boolean): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs can be fetched, got ${url.protocol}`);
  }
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${url.hostname} resolves to a private or local address; set SYNAP_MCP_ALLOW_PRIVATE_URLS=1 to allow it`);
  }
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error(`Response is ${declared} bytes, over the ${limit}-byte limit`);
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new Error(`Response is over the ${limit}-byte limit`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export interface FetchedResource {
  url: string;
  contentType: string;
  bytes: Uint8Array;
}

export async function fetchPublic(
  rawUrl: string,
  opts: { allowPrivate?: boolean; maxBytes: number; accept: string; userAgent: string; timeoutMs?: number; fetch?: typeof globalThis.fetch },
): Promise<FetchedResource> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  let url = new URL(rawUrl);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url, Boolean(opts.allowPrivate));
    const res = await doFetch(url, { redirect: "manual", signal, headers: { accept: opts.accept, "user-agent": opts.userAgent } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`HTTP ${res.status} redirect without a Location header`);
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new Error(`${url.href} answered HTTP ${res.status}`);
    const bytes = await readLimited(res, opts.maxBytes);
    return { url: url.href, contentType: (res.headers.get("content-type") ?? "").toLowerCase(), bytes };
  }
  throw new Error(`More than ${MAX_REDIRECTS} redirects`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Readable text from an HTML document, plus its <title>. Not a full parser; good enough for summarization. */
export function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|table|ul|ol)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const title = titleMatch ? decodeEntities(titleMatch[1]!.replace(/\s+/g, " ").trim()) : undefined;
  return title ? { title, text: s } : { text: s };
}

export interface PageText {
  url: string;
  title?: string;
  text: string;
  truncated: boolean;
}

export async function loadPageText(
  rawUrl: string,
  opts: { allowPrivate: boolean; maxChars: number; userAgent: string; fetch?: typeof globalThis.fetch },
): Promise<PageText> {
  const res = await fetchPublic(rawUrl, {
    allowPrivate: opts.allowPrivate,
    maxBytes: MAX_PAGE_BYTES,
    accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
    userAgent: opts.userAgent,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const ct = res.contentType;
  if (/pdf|image\/|audio\/|video\/|octet-stream|zip/.test(ct)) {
    throw new Error(`${res.url} is ${ct || "binary"}, not a text page`);
  }
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(res.bytes);
  const page = /html|xml/.test(ct) || /^\s*<(!doctype|html)/i.test(raw) ? htmlToText(raw) : { text: raw.trim() };
  const truncated = page.text.length > opts.maxChars;
  const out: PageText = { url: res.url, text: truncated ? page.text.slice(0, opts.maxChars) : page.text, truncated };
  if ("title" in page && page.title) out.title = page.title;
  return out;
}

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** Detects an image type from magic bytes; undefined for anything that is not png/jpeg/gif/webp. */
export function sniffImageType(b: Uint8Array): string | undefined {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return undefined;
}

/**
 * Resolves an image reference to a data: URI. Accepts a data: URI, an http(s)
 * URL, or a local file path (png/jpeg/gif/webp only, checked by content).
 */
export async function loadImageDataUri(
  ref: string,
  opts: { allowPrivate: boolean; userAgent: string; fetch?: typeof globalThis.fetch },
): Promise<string> {
  const value = ref.trim();
  if (value.startsWith("data:")) {
    const m = value.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!m) throw new Error("data: URIs must be base64 png, jpeg, gif or webp images");
    if ((m[2]!.length * 3) / 4 > MAX_IMAGE_BYTES) throw new Error(`Image is over ${MAX_IMAGE_BYTES} bytes`);
    return value.replace(/\s+/g, "");
  }
  let bytes: Uint8Array;
  if (/^https?:\/\//i.test(value)) {
    const res = await fetchPublic(value, {
      allowPrivate: opts.allowPrivate,
      maxBytes: MAX_IMAGE_BYTES,
      accept: "image/png,image/jpeg,image/gif,image/webp",
      userAgent: opts.userAgent,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    bytes = res.bytes;
  } else {
    const path = resolve(value.replace(/^file:\/\//, ""));
    if (!IMAGE_TYPES[extname(path).toLowerCase()]) throw new Error("Local images must be .png, .jpg, .jpeg, .gif or .webp files");
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${path} is not a file`);
    if (info.size > MAX_IMAGE_BYTES) throw new Error(`Image is over ${MAX_IMAGE_BYTES} bytes`);
    bytes = new Uint8Array(await readFile(path));
  }
  const type = sniffImageType(bytes);
  if (!type) throw new Error("That is not a png, jpeg, gif or webp image");
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}
