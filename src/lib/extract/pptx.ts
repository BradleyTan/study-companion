import JSZip from "jszip";
import { SUB, SUP, toScript } from "./scripts";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });
}

/**
 * The next `<a:NAME ...>` tag at or after `from`: its name, where its attributes start and
 * where it ends. Scanned with indexOf, never a regex over the rest of the slide: an
 * unterminated tag in a hostile deck must not cost a scan of the whole slide per tag
 * (security review S2-16: the old regexes were quadratic, minutes of CPU per slide).
 */
function nextTag(xml: string, from: number): { name: string; attrs: string; end: number } | null {
  const at = xml.indexOf("<a:", from);
  if (at < 0) return null;
  const gt = xml.indexOf(">", at);
  if (gt < 0) return null; // no ">" anywhere after: no further tag can end
  const raw = xml.slice(at + 3, gt);
  const name = /^\w+/.exec(raw)?.[0] ?? "";
  return { name, attrs: raw.slice(name.length), end: gt + 1 };
}

/** Text of a run's <a:t> elements, joined. */
function runText(body: string): string {
  let out = "";
  let pos = 0;
  for (let tag = nextTag(body, pos); tag; tag = nextTag(body, pos)) {
    pos = tag.end;
    if (tag.name !== "t" || /^\S/.test(tag.attrs)) continue; // <a:t> or <a:t attr…>, not <a:t/>
    const close = body.indexOf("</a:t>", pos);
    if (close < 0) break;
    out += decodeXml(body.slice(pos, close));
    pos = close + 6;
  }
  return out;
}

/** The run's baseline (superscript > 0, subscript < 0) from its first <a:rPr> that sets one. */
function runBaseline(body: string): number {
  let pos = 0;
  for (let tag = nextTag(body, pos); tag; tag = nextTag(body, pos)) {
    pos = tag.end;
    if (tag.name !== "rPr") continue;
    const m = /\bbaseline="(-?\d+)"/.exec(tag.attrs);
    if (m) return Number(m[1]);
  }
  return 0;
}

/** Text of one slide's XML: each <a:p> paragraph becomes a line, runs <a:t> are joined. */
export function slideXmlToText(xml: string): string {
  const paragraphs = xml.split(/<\/a:p>/);
  const lines: string[] = [];
  for (const p of paragraphs) {
    let line = "";
    // Runs (<a:r>, fields <a:fld>) and line breaks inside the paragraph, in order.
    const unclosed = new Set<string>();
    let pos = 0;
    for (let tag = nextTag(p, pos); tag; tag = nextTag(p, pos)) {
      pos = tag.end;
      if (tag.name === "br") { line += " "; continue; }
      if ((tag.name !== "r" && tag.name !== "fld") || unclosed.has(tag.name) || tag.attrs.endsWith("/")) continue;
      const closeTag = `</a:${tag.name}>`;
      const close = p.indexOf(closeTag, pos);
      // None later either: remember, so the next unterminated run doesn't scan again.
      if (close < 0) { unclosed.add(tag.name); continue; }
      const body = p.slice(pos, close);
      const text = runText(body);
      // Superscript and subscript runs (baseline="30000" / "-25000") keep their meaning: 10⁸, CO₂.
      const baseline = runBaseline(body);
      line += baseline > 0 ? toScript(text, SUP) : baseline < 0 ? toScript(text, SUB) : text;
      pos = close + closeTag.length;
    }
    line = line.trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export const MAX_SLIDES = 500;

/** Returns one string per slide (in slide order), including speaker notes. */
export async function extractPptx(buf: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((a, b) => Number(a.name.match(/(\d+)\.xml$/)![1]) - Number(b.name.match(/(\d+)\.xml$/)![1]))
    .slice(0, MAX_SLIDES);
  const out: string[] = [];
  for (const f of slideFiles) {
    const n = f.name.match(/(\d+)\.xml$/)![1];
    const text = slideXmlToText(await f.async("string"));
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${n}.xml`)?.async("string");
    const notes = notesXml ? slideXmlToText(notesXml).replace(/^\d+$/m, "").trim() : "";
    out.push(notes ? `${text}\n\nSpeaker notes: ${notes}` : text);
  }
  return out;
}
