// Validation of model output. The model's reply is untrusted: shape-checked with zod,
// then normalised (lengths, duplicates, tree shape) and every passage reference is mapped
// through the server's own list, so a card or node can only point at this student's text.
import { z } from "zod";
import { clip, collapse, containsLoose, overlap, sentences } from "./text";
import type { GeneratedCard, MindmapGraph, MindmapNode, Passage } from "./types";

export const CARD_FRONT_MAX = 500;
export const CARD_BACK_MAX = 1500;
export const QUOTE_MAX = 300;
export const MINDMAP_MAX_NODES = 40;
export const MINDMAP_MAX_DEPTH = 3;
export const MINDMAP_LABEL_MAX = 60;

const ref = z.union([z.string(), z.number()]).transform(String);

export const rawFlashcards = z.object({
  cards: z.array(z.object({
    front: z.string(),
    back: z.string(),
    passage: ref.nullish(),
    quote: z.string().nullish(),
  })).max(100),
});

export const rawMindmap = z.object({
  nodes: z.array(z.object({
    id: ref,
    label: z.string(),
    parent: ref.nullish(),
    passage: ref.nullish(),
  })).max(300),
});

/** Accepts "p3", "P3", "[p3]" or "3"; returns the passage only if it's one we sent. */
export function resolvePassage(raw: string | null | undefined, passages: Passage[]): Passage | null {
  if (!raw) return null;
  const m = /^\[?\s*p?\s*(\d+)\s*\]?$/i.exec(raw.trim());
  if (!m) return null;
  return passages.find((p) => p.ref === `p${Number(m[1])}`) ?? null;
}

function bestSentence(passage: Passage, about: string): string {
  const list = sentences(passage.text);
  let best = list[0] ?? passage.text;
  let score = -1;
  for (const s of list) {
    const sc = overlap(s, about);
    if (sc > score) { score = sc; best = s; }
  }
  return clip(best, QUOTE_MAX);
}

/** Validates and cleans the model's flashcards. Null when the reply isn't usable at all. */
export function normaliseFlashcards(json: unknown, passages: Passage[], max: number): GeneratedCard[] | null {
  const parsed = rawFlashcards.safeParse(json);
  if (!parsed.success) return null;
  const out: GeneratedCard[] = [];
  const seen = new Set<string>();
  for (const c of parsed.data.cards) {
    const front = clip(c.front, CARD_FRONT_MAX);
    const back = clip(c.back, CARD_BACK_MAX);
    if (!front || !back) continue;
    const key = front.toLowerCase();
    if (seen.has(key)) continue;
    const quote = c.quote ? collapse(c.quote) : "";
    // The passage must be one we sent. If the reference is missing or made up, find the
    // passage the quote (or the card's words) actually came from; otherwise drop the card.
    let passage = resolvePassage(c.passage, passages);
    if (!passage && quote) passage = passages.find((p) => containsLoose(p.text, quote)) ?? null;
    if (!passage) {
      let best = 0;
      for (const p of passages) {
        const sc = overlap(`${front} ${back}`, p.text);
        if (sc > best) { best = sc; passage = p; }
      }
    }
    if (!passage) continue;
    // Only show a quote that really is in the passage.
    const verified = quote && quote.length <= 600 && containsLoose(passage.text, quote) ? clip(quote, QUOTE_MAX) : bestSentence(passage, `${front} ${back}`);
    seen.add(key);
    out.push({ front, back, chunkId: passage.chunkId, quote: verified });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Validates the model's mindmap into a tree: one root labelled `rootLabel`, at most
 * 40 nodes, depth ≤ 3 below the root, labels ≤ 60 characters. Nodes whose parent is
 * unknown hang off the root; cycles and anything deeper are dropped.
 */
export function normaliseMindmap(json: unknown, passages: Passage[], rootLabel: string): MindmapGraph | null {
  const parsed = rawMindmap.safeParse(json);
  if (!parsed.success) return null;
  const raw = parsed.data.nodes
    .map((n) => ({ ...n, label: clip(n.label, MINDMAP_LABEL_MAX) }))
    .filter((n) => n.label);
  const byId = new Map<string, (typeof raw)[number]>();
  for (const n of raw) if (!byId.has(n.id)) byId.set(n.id, n);

  // The model's own root (no parent) is replaced by ours; its children become level 1.
  const rootRawId = raw.find((n) => !n.parent || n.parent === n.id)?.id ?? null;
  const children = new Map<string, string[]>();
  const ROOT = "__root__";
  for (const n of byId.values()) {
    if (n.id === rootRawId) continue;
    const parent = n.parent && byId.has(n.parent) && n.parent !== n.id ? (n.parent === rootRawId ? ROOT : n.parent) : ROOT;
    children.set(parent, [...(children.get(parent) ?? []), n.id]);
  }

  const nodes: MindmapNode[] = [{ id: "n0", label: clip(rootLabel, MINDMAP_LABEL_MAX) || "Subject", parentId: null, chunkId: null }];
  const newId = new Map<string, string>([[ROOT, "n0"]]);
  const queue: { raw: string; depth: number }[] = [{ raw: ROOT, depth: 0 }];
  while (queue.length && nodes.length < MINDMAP_MAX_NODES) {
    const { raw: pid, depth } = queue.shift()!;
    if (depth >= MINDMAP_MAX_DEPTH) continue;
    for (const cid of children.get(pid) ?? []) {
      if (newId.has(cid) || nodes.length >= MINDMAP_MAX_NODES) continue;
      const n = byId.get(cid)!;
      const id = `n${nodes.length}`;
      newId.set(cid, id);
      nodes.push({ id, label: n.label, parentId: newId.get(pid)!, chunkId: resolvePassage(n.passage, passages)?.chunkId ?? null });
      queue.push({ raw: cid, depth: depth + 1 });
    }
  }
  return nodes.length >= 2 ? { version: 1, nodes } : null;
}

// ---- stored graph (read back from the database / sent by the browser) --------

export const mindmapGraph = z.object({
  version: z.literal(1),
  nodes: z.array(z.object({
    id: z.string().max(20),
    label: z.string().max(MINDMAP_LABEL_MAX + 10),
    parentId: z.string().max(20).nullable(),
    chunkId: z.uuid().nullable(),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  })).max(MINDMAP_MAX_NODES),
});

export const positionsInput = z.object({
  subjectId: z.uuid(),
  positions: z.array(z.object({
    id: z.string().regex(/^n\d{1,3}$/),
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  })).max(MINDMAP_MAX_NODES),
});
