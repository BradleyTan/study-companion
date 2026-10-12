import { createHash } from "node:crypto";

export type Chunk = { ordinal: number; page: number | null; text: string; contentHash: string };

export const CHUNK_TARGET = 900; // characters; roughly 200 tokens
export const CHUNK_MAX = 1200;

export function normaliseText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/-\n(?=[a-z])/g, "") // re-join words hyphenated across lines
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLong(s: string): string[] {
  // Split an over-long paragraph on sentence ends, then hard-wrap as a last resort.
  const sentences = s.match(/[^.!?。！？]+[.!?。！？]+["')\]]*\s*|[^.!?。！？]+$/g) ?? [s];
  const out: string[] = [];
  let cur = "";
  for (const sen of sentences) {
    if ((cur + sen).length > CHUNK_MAX && cur) {
      out.push(cur.trim());
      cur = "";
    }
    if (sen.length > CHUNK_MAX) {
      for (let i = 0; i < sen.length; i += CHUNK_MAX) out.push(sen.slice(i, i + CHUNK_MAX).trim());
    } else cur += sen;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Split pages (or a whole note, as one "page" with page=null) into passages of
 * about CHUNK_TARGET characters, never crossing a page boundary so citations
 * can point at an exact page.
 */
export function chunkPages(pages: string[], opts: { paged: boolean } = { paged: true }): Chunk[] {
  const chunks: Chunk[] = [];
  pages.forEach((raw, i) => {
    const page = opts.paged ? i + 1 : null;
    const paras = normaliseText(raw).split(/\n\n+/).flatMap((p) => (p.length > CHUNK_MAX ? splitLong(p) : [p]));
    let cur = "";
    const flush = () => {
      const text = cur.trim();
      if (text) chunks.push({ ordinal: chunks.length, page, text, contentHash: sha256(text) });
      cur = "";
    };
    for (const p of paras) {
      if (cur && cur.length + p.length + 2 > CHUNK_TARGET) flush();
      cur = cur ? `${cur}\n\n${p}` : p;
    }
    flush();
  });
  return chunks;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
