// Readable text from a web page (make-notes.md "From a web link"). A small one-pass scanner, not
// a parser: it never backtracks, so a hostile page can't make it slow (no regex over the markup).
// It keeps the page's study text and drops scripts, styles, menus, footers and forms; when the
// page marks its main content (<main>, <article>, role="main") and that holds enough text, only
// that part is used.
import { SUB, SUP, toScript } from "./scripts";

/** Elements whose content is never shown as text (raw text: skipped to their closing tag). */
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "template", "iframe", "noembed", "noframes"]);
/** Page furniture: skipped with everything inside. */
const FURNITURE = new Set(["head", "nav", "footer", "aside", "form", "button", "select", "svg", "canvas", "dialog", "menu", "object"]);
const BLOCK = new Set([
  "address", "article", "blockquote", "caption", "dd", "div", "dl", "dt", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "main", "ol", "p", "pre", "section", "table", "tbody", "thead", "tfoot", "tr", "ul", "br", "details", "summary",
]);
/** Main content with at least this much text wins over the whole page. */
const MAIN_MIN = 500;
export const WEB_TEXT_MAX = 60_000;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", deg: "°", times: "×", divide: "÷", minus: "−", plusmn: "±", micro: "µ", middot: "·", bull: "•",
  rarr: "→", larr: "←", harr: "↔", rArr: "⇒", hArr: "⇔", le: "≤", ge: "≥", ne: "≠", asymp: "≈", infin: "∞", sup1: "¹", sup2: "²",
  sup3: "³", frac12: "½", frac14: "¼", frac34: "¾", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", tau: "τ",
  phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω", Pi: "Π", Gamma: "Γ", Theta: "Θ", Lambda: "Λ", Phi: "Φ", shy: "",
  zwj: "", zwnj: "", lrm: "", rlm: "", ensp: " ", emsp: " ", thinsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,9});?/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return Object.hasOwn(NAMED, body) ? NAMED[body] : m;
  });
}

/** Longest tag scanned for quoted attributes; past it the first `>` ends the tag (keeps the scan linear). */
const TAG_SCAN = 8_192;

/**
 * Index of the `>` that ends the tag starting at `from`, skipping quoted attribute values; a stray
 * quote (`alt=don't`) falls back to the first `>`. -1 when the page ends inside the tag.
 */
function tagEnd(html: string, from: number): number {
  let quote = "";
  const stop = Math.min(html.length, from + TAG_SCAN);
  for (let i = from; i < stop; i++) {
    const c = html[i];
    if (quote) { if (c === quote) quote = ""; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i;
  }
  return html.indexOf(">", from);
}

export type PageText = { title: string; text: string };

/** Longest <sup>/<sub> run turned into Unicode characters; longer ones are kept as plain text. */
const SCRIPT_MAX = 40;

/** The page's title and readable text (main content when it has enough), at most WEB_TEXT_MAX characters. */
export function htmlToText(html: string): PageText {
  // ASCII-only lower case, so indexes match `html` ("İ".toLowerCase() is two characters: security review FB-4).
  const lower = html.replace(/[A-Z]+/g, (m) => m.toLowerCase());
  const strict = scanPage(html, lower, true);
  // Some sites (ASP.NET, SharePoint) wrap the whole page in one <form>: read it again with forms kept (QA feedback).
  if (strict.text.length >= MAIN_MIN || !lower.includes("<form")) return strict;
  const loose = scanPage(html, lower, false);
  return loose.text.length > strict.text.length ? loose : strict;
}

function scanPage(html: string, lower: string, skipForms: boolean): PageText {
  const all: string[] = [];
  const main: string[] = [];
  let title = "";
  let furniture = 0;
  // The first <main>/<article>/role="main" element: how deep we are inside it, and whether it ended.
  let mainTag = "";
  let mainDepth = 0;
  let mainDone = false;
  // Inside <sup>/<sub>: the text is held back, then written as Unicode ("10<sup>8</sup>" is 10⁸, not 108).
  let script = "";
  let scriptBuf: string[] = [];
  let scriptLen = 0;
  const push = (t: string) => {
    if (furniture) return;
    if (script) {
      scriptBuf.push(t);
      scriptLen += t.length;
      if (scriptLen > SCRIPT_MAX) endScript(false);
      return;
    }
    all.push(t);
    if (mainDepth > 0) main.push(t);
  };
  function endScript(convert: boolean) {
    const raw = scriptBuf.join("");
    const name = script;
    script = "";
    scriptBuf = [];
    scriptLen = 0;
    const plain = decodeEntities(raw).trim();
    const out = convert ? toScript(plain, name === "sup" ? SUP : SUB) : plain;
    // Unchanged (a citation like [3], or letters): the raw text, decoded once later like the rest.
    push(convert && out !== plain ? out : raw);
  }
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) { push(html.slice(i)); break; }
    if (lt > i) push(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 40));
    if (!m) {
      if (html[lt + 1] === "!" || html[lt + 1] === "?") { const end = html.indexOf(">", lt); i = end === -1 ? html.length : end + 1; continue; }
      push("<");
      i = lt + 1;
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const end = tagEnd(html, lt + m[0].length);
    if (end === -1) break;
    const attrs = html.slice(lt + m[0].length, end);
    i = end + 1;
    if (!closing && RAW.has(name)) {
      const close = lower.indexOf(`</${name}`, i);
      const inner = html.slice(i, close === -1 ? html.length : close);
      if (name === "title" && !title) title = decodeEntities(inner).replace(/\s+/g, " ").trim();
      const closeEnd = close === -1 ? -1 : tagEnd(html, close);
      i = closeEnd === -1 ? html.length : closeEnd + 1;
      continue;
    }
    // <body> ends the head even when </head> was left out (it's optional in HTML).
    if (name === "body") { if (!closing) furniture = 0; continue; }
    if (FURNITURE.has(name) && (skipForms || name !== "form")) {
      if (closing) furniture = Math.max(0, furniture - 1);
      else if (!attrs.trimEnd().endsWith("/")) furniture++;
      continue;
    }
    if (furniture) continue;
    if (name === "sup" || name === "sub") {
      if (!closing && !script) { script = name; scriptBuf = []; scriptLen = 0; }
      else if (closing && script === name) endScript(true);
      continue;
    }
    const isMain = name === "main" || name === "article" || /\brole\s*=\s*["']?main\b/i.test(attrs);
    if (!closing && !mainDone && (mainDepth === 0 ? isMain : name === mainTag)) {
      if (mainDepth === 0) mainTag = name;
      mainDepth++;
    } else if (closing && mainDepth > 0 && name === mainTag) {
      mainDepth--;
      if (mainDepth === 0) mainDone = true;
    }
    if (name === "li" && !closing) push("\n- ");
    else if (/^h[1-6]$/.test(name)) push("\n\n");
    else if (name === "td" || name === "th") push(" ");
    else if (BLOCK.has(name)) push("\n");
  }
  if (script) endScript(false);
  const tidy = (parts: string[]) => decodeEntities(parts.join(""))
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n(?:- *\n)+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const mainText = tidy(main);
  const text = mainText.length >= MAIN_MIN ? mainText : tidy(all);
  return { title: title.slice(0, 200), text: text.slice(0, WEB_TEXT_MAX) };
}
