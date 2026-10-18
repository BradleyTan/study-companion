// Validation of model output. The model's reply is untrusted: shape-checked with zod,
// then normalised (lengths, duplicates, tree shape) and every passage reference is mapped
// through the server's own list, so a card or node can only point at this student's text.
import { z } from "zod";
import { canonical, clip, collapse, containsLoose, equationsIn, factsOf, GREEK, NO_SPACES, normaliseFront, NUMBER_WORD_VALUES, numbersIn, overlap, passageFacts, SCALE, sentences, stem, type PassageFacts } from "./text";
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

/**
 * Accepts "p3", "P3", "[p3]", "3", "passage 3" or "p3, p4" (the first one); returns the passage
 * only if it's one we sent.
 */
export function resolvePassage(raw: string | null | undefined, passages: Passage[]): Passage | null {
  if (!raw) return null;
  const first = raw.trim().slice(0, 40).split(/[,;/&]|\band\b/)[0];
  const m = /^\[?\s*(?:p|passage)?\s*#?\s*(\d+)\s*\]?$/i.exec(first.trim());
  if (!m) return null;
  return passages.find((p) => p.ref === `p${Number(m[1])}`) ?? null;
}

export function bestSentence(passage: Passage, about: string): string {
  const list = sentences(passage.text);
  let best = list[0] ?? passage.text;
  let score = -1;
  for (const s of list) {
    const sc = overlap(s, about);
    if (sc > score) { score = sc; best = s; }
  }
  return clip(best, QUOTE_MAX);
}

/** Shortest front that can be a real question (scripts without spaces: see FRONT_MIN_NO_SPACES). */
export const FRONT_MIN = 12;
const FRONT_MIN_NO_SPACES = 4;
/**
 * Share of the answer's content words that must appear in the cited passage. 0.5 keeps honest
 * paraphrases ("Water moving across a membrane" for "the movement of water across a membrane"
 * shares 3 of 4) and drops answers built from outside knowledge, which share 0–1 of 3–6 words
 * (see "grounding" in ai.test.ts).
 */
export const GROUNDING_MIN = 0.5;

const IMPERATIVE = /^\s*(?:define|name|explain|describe|list|state|give|outline|compare|contrast|identify|calculate|write|label|summarise|summarize)\b/i;

/** Why a card fails the quality bar, or null when it's fine (Bradley: quality as important as quantity). */
export function cardQualityIssue(front: string, back: string): "short" | "not_a_question" | "repeats_front" | null {
  const noSpaces = NO_SPACES.test(front);
  if (front.length < (noSpaces ? FRONT_MIN_NO_SPACES : FRONT_MIN)) return "short";
  const tokens = front.match(/[\p{L}\p{N}]+/gu) ?? [];
  // Short imperatives are real prompts too ("Define osmosis", "Name the enzyme").
  if (!/[?？¿؟]/u.test(front) && tokens.length < 3 && !noSpaces && !IMPERATIVE.test(front)) return "not_a_question";
  const f = normaliseFront(front);
  const b = normaliseFront(back);
  if (b === f || (b.includes(f) && b.length - f.length < 10)) return "repeats_front";
  // A non-answer that only names what was asked ("What is the molar mass of X?" → "The molar
  // mass of X."): every word of the answer is in the question. Not for either/or questions.
  const fw = new Set(factsOf(front).words);
  const bf = factsOf(back);
  if (!noSpaces && !/\bor\b/i.test(front) && bf.words.length >= 2 && !bf.numbers.length && !bf.terms.length && bf.words.every((w) => fw.has(w))) return "repeats_front";
  return null;
}

/**
 * Whether the answer is grounded in the passage it cites (Bradley: what a card says must be
 * accurate, science notation included). Compared in canonical form (see `canonical` in text.ts),
 * so H₂O = H2O, 10⁸ = 10^8, −70 = -70, 4% = 4.0%, "five" = 5:
 * - every number in the answer is in the passage, with its sign (an answer that says "minus",
 *   "negative" or "below" may give the size of a negative number);
 * - every term mixing letters and digits (H2O, C6H12O6, BRCA1, p53, 6CO2) and every word with a
 *   Greek letter (α-helix, ΔG) is in the passage;
 * - every equation (around =, →, ⇌) appears in the passage as written, spacing aside;
 * - a species name (Genus epithet, or E. coli) uses an epithet the passage gives that genus;
 * - at least GROUNDING_MIN of the answer's words, numbers and terms are in the passage.
 * Answers in scripts without spaces get the number check only.
 */
export function isGrounded(back: string, passageText: string): boolean {
  const p = passageFacts(passageText);
  const a = factsOf(back);
  const sizeOnly = /\b(?:minus|negative|below)\b/i.test(back);
  const numberOk = (n: string) => p.numbers.has(n) || (sizeOnly && (p.numbers.has(n.replace(/^-/, "")) || p.numbers.has(`-${n.replace(/^-/, "")}`)));
  if (!a.numbers.every(numberOk)) return false;
  if (NO_SPACES.test(back)) return true;

  if (!a.terms.every((t) => p.terms.has(t))) return false;
  // Greek-letter words (α-helix, ΔG) and number scales (million, billion) must match exactly.
  if (!a.words.filter((w) => GREEK.test(w) || SCALE.test(w)).every((w) => p.words.has(w))) return false;
  if (!equationsIn(canonical(back)).every((eq) => p.squashed.includes(eq))) return false;
  // Charges, powers and exponents (Ca²⁺, mc², 10⁸, L⁻¹), Greek compounds (α-helix) and the unit
  // after a number (µm, not mm) must be the passage's own.
  if (!a.scripted.every((t) => p.scripted.has(t))) return false;
  if (!a.compounds.every((t) => p.compounds.has(t))) return false;
  for (const [n, units] of a.units) {
    const known = p.units.get(n);
    if (known && ![...units].every((u) => known.has(u))) return false;
  }
  for (const [genus, names] of a.species) {
    const known = [...p.species].filter(([g]) => g === genus || (genus.endsWith(".") ? g[0] === genus[0] : `${genus[0]}.` === g));
    if (known.length && ![...names].every((n) => known.some(([, set]) => set.has(n)))) return false;
    // A species the passage never names ("Staphylococcus aureus" when it is about Escherichia
    // coli): the genus must at least be in the passage (QA step 3).
    if (!known.length && (genus.endsWith(".") || !p.words.has(stem(genus)))) return false;
  }

  // Number words in the answer ("five") count as numbers.
  const answerWords = a.words.filter((w) => !(NUMBER_WORD_VALUES[w] !== undefined && p.numbers.has(String(NUMBER_WORD_VALUES[w]))));
  const total = answerWords.length + a.numbers.length + a.terms.length;
  if (!total) return true;
  const hits = answerWords.filter((w) => p.words.has(w)).length + a.numbers.length + a.terms.length;
  return hits / total >= GROUNDING_MIN;
}

/**
 * Sentences of a passage (whitespace collapsed), split only at . ! ? followed by a space and a
 * capital, digit or bracket, or at 。！？. Decimals (7.35) and "E. coli" stay inside a sentence.
 */
export function passageSentences(text: string): string[] {
  return collapse(text).split(/(?<=[.!?]["')\]]?)\s+(?=[\p{Lu}\p{N}("'\[−-])|(?<=[。！？])/u).map((x) => x.trim()).filter(Boolean);
}

const LOWER_END = /\b(?:lower|lowest|minimum|bottom)\b/i;
const UPPER_END = /\b(?:upper|highest|maximum|top)\b/i;

/**
 * A card that asks for one end of a range and answers with the other ("What is the lower limit
 * of normal arterial pH?" → "7.45" when the passage says 7.35–7.45).
 */
export function wrongRangeEnd(front: string, back: string, passageText: string): boolean {
  const card = `${front} ${back}`;
  const lower = LOWER_END.test(card);
  const upper = UPPER_END.test(card);
  if (lower === upper) return false;
  const answer = new Set(numbersIn(back));
  const c = canonical(passageText);
  for (const m of c.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?) ?- ?(\d+(?:[.,]\d+)?)(?![\d.,])/g)) {
    const [x, y] = [numbersIn(m[1])[0], numbersIn(m[2])[0]];
    if (!x || !y || Number(x) >= Number(y)) continue;
    if (lower && answer.has(y) && !answer.has(x)) return true;
    if (upper && answer.has(x) && !answer.has(y)) return true;
  }
  return false;
}

/**
 * Accuracy where the fact sits (QA L2): every number, formula and charge in the answer must be
 * in the sentence the card comes from: the sentence(s) holding the model's verified quote, or,
 * without one, the sentence(s) sharing most words with the card. A value from another sentence is
 * accepted only when it appears in exactly one sentence of the passage and that sentence shares at
 * least two words with the card (a list answer gathering facts about the same thing). This drops
 * "a right number from the wrong sentence" (inflation given as the base rate's 5.25%).
 */
export function groundedNearQuote(front: string, back: string, passageText: string, quote: string | null): boolean {
  const sents = passageSentences(passageText);
  if (sents.length < 2) return true;
  const cardWords = new Set(factsOf(`${front} ${back}`).words);
  const shared = (t: string) => { let n = 0; for (const w of passageFacts(t).words) if (cardWords.has(w)) n++; return n; };
  let anchor: string[] = [];
  if (quote) {
    // Sentences overlapping the quote's span (positions in the collapsed, lower-cased passage).
    const pt = collapse(passageText).toLowerCase();
    const at = pt.indexOf(collapse(quote).toLowerCase());
    if (at >= 0) {
      const end = at + collapse(quote).length;
      let pos = 0;
      for (const t of sents) {
        const start = pt.indexOf(t.toLowerCase(), pos);
        const stop = start + t.length;
        if (start >= 0) { if (start < end && stop > at) anchor.push(t); pos = stop; }
      }
    }
  }
  if (!anchor.length) {
    const scores = sents.map(shared);
    const best = Math.max(...scores);
    if (best === 0) return true; // nothing to anchor on: the whole-passage check stands
    anchor = sents.filter((_, i) => scores[i] === best);
  }
  const a = factsOf(back);
  const sizeOnly = /\b(?:minus|negative|below)\b/i.test(back);
  const hasNumber = (f: PassageFacts, n: string) => f.numbers.has(n) || (sizeOnly && (f.numbers.has(n.replace(/^-/, "")) || f.numbers.has(`-${n.replace(/^-/, "")}`)));
  const near = passageFacts(anchor.join(" "));
  const checks: ((f: PassageFacts) => boolean)[] = [
    ...a.numbers.map((n) => (f: PassageFacts) => hasNumber(f, n)),
    ...a.terms.map((t) => (f: PassageFacts) => f.terms.has(t)),
    ...a.scripted.map((t) => (f: PassageFacts) => f.scripted.has(t)),
  ];
  for (const has of checks) {
    if (has(near)) continue;
    const holders = sents.filter((t) => has(passageFacts(t)));
    if (holders.length === 1 && shared(holders[0]) >= 2) continue;
    return false;
  }
  return true;
}

export type NormalisedCards = { cards: GeneratedCard[]; dropped: number };

/** Validates and cleans the model's flashcards. Null when the reply isn't usable at all. */
export function normaliseFlashcards(json: unknown, passages: Passage[], max: number): GeneratedCard[] | null {
  return normaliseFlashcardsWithStats(json, passages, max)?.cards ?? null;
}

/**
 * Same as normaliseFlashcards, with the number of cards dropped by the quality and grounding
 * checks: empty, too short, not a question, answer repeats the question, duplicate question in
 * the set, a passage we didn't send, or an answer the cited passage doesn't support.
 */
export function normaliseFlashcardsWithStats(json: unknown, passages: Passage[], max: number): NormalisedCards | null {
  const parsed = rawFlashcards.safeParse(json);
  if (!parsed.success) return null;
  const out: GeneratedCard[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const c of parsed.data.cards) {
    if (out.length >= max) break;
    const front = clip(c.front, CARD_FRONT_MAX);
    const back = clip(c.back, CARD_BACK_MAX);
    if (!front || !back || cardQualityIssue(front, back)) { dropped++; continue; }
    const key = normaliseFront(front);
    if (seen.has(key)) { dropped++; continue; }
    const quote = c.quote ? collapse(c.quote) : "";
    // A cited passage must be one we sent; citing any other is dropped. Without a citation, find
    // the passage the quote (or the card's words) actually came from; otherwise drop the card.
    let passage = resolvePassage(c.passage, passages);
    if (!passage && c.passage) { dropped++; continue; }
    if (!passage && quote) passage = passages.find((p) => containsLoose(p.text, quote)) ?? null;
    if (!passage) {
      let best = 0;
      for (const p of passages) {
        const sc = overlap(`${front} ${back}`, p.text);
        if (sc > best) { best = sc; passage = p; }
      }
    }
    if (!passage || !isGrounded(back, passage.text)) { dropped++; continue; }
    // Only show a quote that really is in the passage.
    const modelQuote = quote && quote.length <= 600 && containsLoose(passage.text, quote) ? quote : null;
    if (wrongRangeEnd(front, back, passage.text) || (!NO_SPACES.test(back) && !groundedNearQuote(front, back, passage.text, modelQuote))) { dropped++; continue; }
    const verified = modelQuote ? clip(modelQuote, QUOTE_MAX) : bestSentence(passage, `${front} ${back}`);
    seen.add(key);
    out.push({ front, back, chunkId: passage.chunkId, quote: verified });
  }
  return { cards: out, dropped };
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
