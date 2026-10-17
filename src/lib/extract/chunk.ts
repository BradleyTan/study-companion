import { createHash } from "node:crypto";

export type Chunk = { ordinal: number; page: number | null; text: string; contentHash: string };

export const CHUNK_TARGET = 900; // characters; roughly 200 tokens
export const CHUNK_MAX = 1200;

export function normaliseText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    // Re-join words hyphenated across lines ("mito-\nchondria", "(cyto-\nplasm)"), but keep the
    // hyphen of a term that has one ("α-\nhelix", "BRCA1-\nlinked", "3-\nphosphate", "ATP-\nase").
    // The lookbehind anchors the match at a word's start (no quadratic backtracking on long runs).
    .replace(/(?<![^\s(\[{"'])([^\s-]*)-\n(?=\p{Ll})/gu, (_, w: string) => {
      const core = w.replace(/^[^\p{L}\p{N}]+/u, "");
      return /^\p{L}\p{Ll}+$/u.test(core) && !/\p{Script=Greek}/u.test(core) ? w : `${w}-`;
    })
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

export type StoredChunk = { id: string; ordinal: number; page: number | null; contentHash: string };
export type ChunkSync = {
  /** Existing passages that stay (same text); `ordinal` is their new position. */
  keep: { id: string; ordinal: number }[];
  insert: Chunk[];
  remove: string[];
};

/**
 * Plans how to bring stored passages in line with freshly chunked text while keeping the
 * ids of passages whose text didn't change, so flashcards and mindmap nodes that point
 * at them stay linked when the student edits another part of the note.
 */
export function planChunkSync(existing: StoredChunk[], next: Chunk[]): ChunkSync {
  const pool = new Map<string, StoredChunk[]>();
  for (const c of [...existing].sort((a, b) => a.ordinal - b.ordinal)) {
    const k = `${c.page ?? ""}|${c.contentHash}`;
    pool.set(k, [...(pool.get(k) ?? []), c]);
  }
  const keep: ChunkSync["keep"] = [];
  const insert: Chunk[] = [];
  for (const c of next) {
    const match = pool.get(`${c.page ?? ""}|${c.contentHash}`)?.shift();
    if (match) keep.push({ id: match.id, ordinal: c.ordinal });
    else insert.push(c);
  }
  const kept = new Set(keep.map((k) => k.id));
  return { keep, insert, remove: existing.filter((c) => !kept.has(c.id)).map((c) => c.id) };
}
