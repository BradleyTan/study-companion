import "server-only";
// Reading a web page for "Make study notes" (make-notes.md "From a web link"). The URL is the
// student's own input, so the fetch is locked down against server-side request forgery:
// http(s) on the default ports only, no credentials in the URL, every address the name
// resolves to must be a public one (checked at connect time, so DNS rebinding can't swap in a
// private address after the check), at most 4 redirects (each one checked again), 10 seconds,
// 2 MB, and only HTML or plain text. Nothing is stored except the notes made from it.
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import zlib from "node:zlib";
import { htmlToText, type PageText } from "@/lib/extract/html";

export const WEB_TIMEOUT_MS = 10_000;
export const WEB_MAX_BYTES = 2_000_000;
export const WEB_MAX_REDIRECTS = 4;

export type WebError = "bad_url" | "blocked" | "unreachable" | "http" | "not_html" | "pdf" | "too_slow";
export class WebPageError extends Error {
  constructor(public code: WebError) { super(code); }
}

/** Addresses no student link may reach: private, loopback, link-local, shared, multicast, reserved, documentation. */
const BLOCKED = (() => {
  const b = new BlockList();
  for (const [net, bits] of [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
    ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ] as const) b.addSubnet(net, bits, "ipv4");
  // IPv6: only global unicast (2000::/3) is allowed, minus these.
  for (const [net, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) b.addSubnet(net, bits, "ipv6");
  return b;
})();

/** Whether a resolved address is a public one a page may live on. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, "ipv4");
  if (family !== 6) return false;
  const a = address.toLowerCase().split("%")[0];
  // IPv4-mapped (::ffff:10.0.0.1 or ::ffff:a00:1): judged as the IPv4 address it carries.
  const mapped = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return isPublicAddress(mapped[1]);
  const hex = /^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    return isPublicAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
  }
  const first = parseInt(a.split(":")[0] || "0", 16);
  if (!(first >= 0x2000 && first <= 0x3fff)) return false;
  return !BLOCKED.check(a, "ipv6");
}

/** The link a student pasted, as a URL we're willing to open, or a WebPageError("bad_url" | "blocked"). */
export function parseWebUrl(raw: string): URL {
  let text = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try { url = new URL(text); } catch { throw new WebPageError("bad_url"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new WebPageError("bad_url");
  if (url.username || url.password) throw new WebPageError("blocked");
  if (url.port && url.port !== "80" && url.port !== "443") throw new WebPageError("blocked");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new WebPageError("bad_url");
  if (isIP(host)) { if (!isPublicAddress(host)) throw new WebPageError("blocked"); }
  else if (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|localdomain)\.?$/.test(host)) throw new WebPageError("blocked");
  url.hash = "";
  return url;
}

type Checker = (address: string) => boolean;

/** dns.lookup that refuses any name with a non-public address (Node calls it on every connect). */
function guardedLookup(allowed: Checker) {
  return (hostname: string, options: LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, "");
      const list = addresses as LookupAddress[];
      if (!list.length || list.some((a) => !allowed(a.address))) return cb(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "");
      if (options.all) cb(null, list);
      else cb(null, list[0].address, list[0].family);
    });
  };
}

type Raw = { status: number; location: string | null; contentType: string; body: Buffer };

function requestOnce(url: URL, allowed: Checker, deadline: number): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // An IP literal skips the lookup, so it's checked here.
    if (isIP(host) && !allowed(host)) { reject(new WebPageError("blocked")); return; }
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "GET",
      lookup: guardedLookup(allowed) as unknown as typeof dnsLookup,
      agent: false,
      headers: {
        "User-Agent": "StudyNest/1.0 (study notes for a student; +https://study-companion-steel-kappa.vercel.app/privacy)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en;q=0.9, *;q=0.5",
      },
      timeout: Math.max(1, deadline - Date.now()),
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
      if ((status >= 300 && status < 400) || status >= 400 || !/^(?:text\/html|application\/xhtml\+xml|text\/plain)\b/.test(contentType)) {
        // No body wanted: close the connection rather than drain a body that may never end.
        res.on("error", () => {});
        resolve({ status, location, contentType, body: Buffer.alloc(0) });
        req.destroy();
        return;
      }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
      const unzip = enc === "gzip" || enc === "x-gzip" ? zlib.createGunzip()
        : enc === "deflate" ? zlib.createInflate()
        : enc === "br" ? zlib.createBrotliDecompress()
        : null;
      const stream = unzip ? res.pipe(unzip) : res;
      const parts: Buffer[] = [];
      let size = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        // Stop the decompressor too: a few KB of brotli can unpack to gigabytes, and it would keep
        // going in the background on the input it already holds (security review FB-1).
        if (unzip) { res.unpipe(unzip); unzip.destroy(); }
        req.destroy();
        resolve({ status, location, contentType, body: Buffer.concat(parts) });
      };
      stream.on("data", (chunk: Buffer) => {
        // Past the cap (counted after decompression), keep what we have.
        const room = WEB_MAX_BYTES - size;
        if (room <= 0) return finish();
        parts.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
        size += Math.min(chunk.length, room);
        if (size >= WEB_MAX_BYTES) finish();
      });
      stream.on("end", finish);
      stream.on("error", () => { if (!done) { done = true; req.destroy(); reject(new WebPageError("unreachable")); } });
      res.on("error", (e) => { if (!done) { done = true; reject(e instanceof WebPageError ? e : new WebPageError("unreachable")); } });
    });
    // A hard stop for the whole fetch, not just an idle socket (a page sent a byte at a time).
    const timer = setTimeout(() => req.destroy(new WebPageError("too_slow")), Math.max(1, deadline - Date.now()));
    req.on("close", () => clearTimeout(timer));
    req.on("timeout", () => req.destroy(new WebPageError("too_slow")));
    req.on("error", (e) => reject(e instanceof WebPageError ? e : (e as NodeJS.ErrnoException).code === "EBLOCKED" ? new WebPageError("blocked") : new WebPageError("unreachable")));
    req.end();
  });
}

/** The charset the page declares (header first, then a <meta> near the top), for TextDecoder. */
function charsetOf(contentType: string, body: Buffer): string {
  const header = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1];
  const meta = /<meta[^>]{0,200}?charset\s*=\s*["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1];
  return header ?? meta ?? "utf-8";
}

function decode(body: Buffer, contentType: string): string {
  try { return new TextDecoder(charsetOf(contentType, body)).decode(body); } catch { return new TextDecoder("utf-8").decode(body); }
}

export type WebPage = PageText & { url: string };

export type WebDeps = { allowed: Checker; parse: (raw: string) => URL };
const REAL: WebDeps = { allowed: isPublicAddress, parse: parseWebUrl };

/**
 * Fetches a page the student linked and returns its readable text. `deps` decide which links
 * and addresses may be reached; the app always uses the real rules (tests swap them to reach a
 * local server).
 */
export async function readWebPage(raw: string, deps: WebDeps = REAL): Promise<WebPage> {
  const { allowed, parse } = deps;
  let url = parse(raw);
  const deadline = Date.now() + WEB_TIMEOUT_MS;
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, allowed, deadline);
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop >= WEB_MAX_REDIRECTS) throw new WebPageError("unreachable");
      try { url = parse(new URL(res.location, url).toString()); } catch (e) { throw e instanceof WebPageError ? e : new WebPageError("bad_url"); }
      continue;
    }
    if (res.status !== 200) throw new WebPageError(res.status >= 300 ? "http" : "unreachable");
    if (/^application\/pdf\b/.test(res.contentType)) throw new WebPageError("pdf");
    if (!res.body.length) throw new WebPageError("not_html");
    const text = decode(res.body, res.contentType);
    const page = res.contentType.startsWith("text/plain") ? { title: "", text: text.slice(0, 60_000).trim() } : htmlToText(text);
    return { ...page, url: url.toString() };
  }
}
