import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeEntities, htmlToText } from "@/lib/extract/html";
import { isPublicAddress, parseWebUrl, readWebPage, WEB_MAX_BYTES, WebPageError } from "./web-page";

const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof WebPageError ? e.code : "other"; } };
const asyncCode = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof WebPageError ? e.code : "other"; } };

describe("readable text from a web page", () => {
  it("keeps the study text and drops scripts, styles, menus, footers and comments", () => {
    const html = `<!doctype html><html><head><title>Osmosis &amp; diffusion - Wiki</title><style>p{color:red}</style>
      <script>var x = "<p>not text</p>";</script></head><body><nav><a href="/">Home</a> | <a>Log in</a></nav>
      <h1>Osmosis</h1><p>Osmosis is the movement of water&nbsp;across a membrane.</p><!-- <p>hidden</p> -->
      <ul><li>Passive</li><li>Needs a gradient</li></ul><table><tr><td>H&#8322;O</td><td>10&sup2;</td></tr></table>
      <footer>© 2026 Cookie settings</footer></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("Osmosis & diffusion - Wiki");
    expect(text).toContain("Osmosis is the movement of water across a membrane.");
    expect(text).toContain("- Passive\n- Needs a gradient");
    expect(text).toContain("H₂O 10²");
    for (const bad of ["color:red", "not text", "Home", "Log in", "hidden", "Cookie"]) expect(text).not.toContain(bad);
  });

  it("uses the main content when the page marks it and it has enough text", () => {
    const body = "Diffusion is the net movement of particles from high to low concentration. ".repeat(10);
    const { text } = htmlToText(`<div class="sidebar">Related: cats</div><article><h2>Diffusion</h2><p>${body}</p></article><div>Share this</div>`);
    expect(text.startsWith("Diffusion")).toBe(true);
    expect(text).not.toContain("cats");
    expect(text).not.toContain("Share this");
    // Too little in <main>: the whole page is used.
    expect(htmlToText("<main><p>Hi</p></main><p>Other text here.</p>").text).toContain("Other text here.");
  });

  it("survives broken markup: quotes in attributes, a stray quote, unclosed tags", () => {
    expect(htmlToText(`<p title="a > b">Kept text</p>`).text).toBe("Kept text");
    expect(htmlToText(`<img alt=don't><p>After the image</p>`).text).toContain("After the image");
    expect(htmlToText(`<p>One<p>Two <b>bold`).text).toBe("One\nTwo bold");
    expect(htmlToText(`<p>Ends inside a tag <a href="x`).text).toBe("Ends inside a tag");
    expect(htmlToText(`a < b and c > d`).text).toBe("a < b and c > d");
  });

  it("decodes entities, keeping unknown ones as written", () => {
    expect(decodeEntities("&alpha;-helix &Delta;G &minus;70&nbsp;mV &#x1F600; &unknown; &#0;")).toBe("α-helix ΔG −70 mV 😀 &unknown; ");
  });

  it("stays fast on hostile markup", () => {
    const hostile = [`<a title='`.repeat(50_000), "<script>".repeat(50_000), "<nav>".repeat(50_000), "<!--".repeat(50_000)];
    for (const h of hostile) {
      const t = Date.now();
      htmlToText(h);
      expect(Date.now() - t).toBeLessThan(1500);
    }
  });
});

describe("which links may be opened", () => {
  it("only public addresses", () => {
    for (const ok of ["8.8.8.8", "142.250.72.14", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) expect(isPublicAddress(ok)).toBe(true);
    for (const bad of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe",
      "64:ff9b::a9fe:a9fe", "2001:db8::1", "2002:7f00:1::", "not an ip",
    ]) expect(isPublicAddress(bad), bad).toBe(false);
  });

  it("http(s) on the usual ports, no credentials, no local names", () => {
    expect(parseWebUrl("en.wikipedia.org/wiki/Osmosis").toString()).toBe("https://en.wikipedia.org/wiki/Osmosis");
    expect(parseWebUrl("http://example.com:80/a#frag").toString()).toBe("http://example.com/a");
    expect(code(() => parseWebUrl("ftp://example.com/file"))).toBe("bad_url");
    expect(code(() => parseWebUrl("javascript:alert(1)"))).toBe("bad_url");
    expect(code(() => parseWebUrl("file:///etc/passwd"))).toBe("bad_url");
    expect(code(() => parseWebUrl("https://user:pw@example.com/"))).toBe("blocked");
    expect(code(() => parseWebUrl("https://example.com:8080/"))).toBe("blocked");
    expect(code(() => parseWebUrl("http://localhost/"))).toBe("blocked");
    expect(code(() => parseWebUrl("http://printer.local/"))).toBe("blocked");
    expect(code(() => parseWebUrl("http://intranet/"))).toBe("blocked");
    expect(code(() => parseWebUrl("http://127.0.0.1/"))).toBe("blocked");
    expect(code(() => parseWebUrl("http://[::1]/"))).toBe("blocked");
    expect(code(() => parseWebUrl("http://169.254.169.254/latest/meta-data/"))).toBe("blocked");
    expect(code(() => parseWebUrl("http://2130706433/"))).toBe("blocked"); // 127.0.0.1 as a number
    expect(code(() => parseWebUrl("http://0x7f.1/"))).toBe("blocked");
  });
});

describe("reading a page", () => {
  let server: Server;
  let base = "";
  const allowAll = () => true;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const u = req.url ?? "/";
      if (u === "/page") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<title>T</title><p>Osmosis moves water.</p>"); }
      else if (u === "/gzip") { res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }); res.end(gzipSync("<p>Zipped text.</p>")); }
      else if (u === "/latin1") { res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" }); res.end(Buffer.from("<p>caf\xe9</p>", "latin1")); }
      else if (u === "/plain") { res.writeHead(200, { "content-type": "text/plain" }); res.end("Plain <b>text</b>."); }
      else if (u === "/pdf") { res.writeHead(200, { "content-type": "application/pdf" }); res.end("%PDF-1.4"); }
      else if (u === "/image") { res.writeHead(200, { "content-type": "image/png" }); res.end("x"); }
      else if (u === "/huge") { res.writeHead(200, { "content-type": "text/plain" }); res.end("a".repeat(WEB_MAX_BYTES + 500_000)); }
      else if (u === "/to-page") { res.writeHead(302, { location: "/page" }); res.end(); }
      else if (u === "/to-local") { res.writeHead(302, { location: "http://localhost/secret" }); res.end(); }
      else if (u === "/to-meta") { res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" }); res.end(); }
      else if (u === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); }
      else { res.writeHead(404, { "content-type": "text/html" }); res.end("nope"); }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.closeAllConnections(); server.close(); });

  // The test server listens on 127.0.0.1 with a port, which real links may never use: these tests
  // let its own URLs through and keep the real rules for everything else (so redirects are checked).
  const read = (path: string) => readWebPage(`${base}${path}`, { allowed: allowAll, parse: (s) => (s.startsWith(base) ? new URL(s) : parseWebUrl(s)) });

  it("refuses the local test server with the real address check", async () => {
    expect(await asyncCode(readWebPage(`${base}/page`))).toBe("blocked");
  });

  it("reads HTML, gzip, other charsets and plain text", async () => {
    expect(await read("/page")).toMatchObject({ title: "T", text: "Osmosis moves water." });
    expect((await read("/gzip")).text).toBe("Zipped text.");
    expect((await read("/latin1")).text).toBe("café");
    expect((await read("/plain")).text).toBe("Plain <b>text</b>.");
  });

  it("follows a redirect but checks where it goes", async () => {
    expect((await read("/to-page")).text).toBe("Osmosis moves water.");
    expect(await asyncCode(read("/to-local"))).toBe("blocked");
    expect(await asyncCode(read("/to-meta"))).toBe("blocked");
    expect(await asyncCode(read("/loop"))).toBe("unreachable");
  });

  it("says why other links can't be read", async () => {
    expect(await asyncCode(read("/pdf"))).toBe("pdf");
    expect(await asyncCode(read("/image"))).toBe("not_html");
    expect(await asyncCode(read("/missing"))).toBe("http");
  });

  it("stops at 2 MB", async () => {
    expect((await read("/huge")).text.length).toBeLessThanOrEqual(60_000);
  });
});

