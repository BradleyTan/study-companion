// Retrieval rules for Ask your notes (chat.md "Answering rules"). Pure functions, shared by the
// Supabase repo (which only fetches candidates) and demo mode, so both decide the same way.
import { stem, words } from "../ai/text";

/** Passages sent with one question. */
export const TOP_K = 6;
/**
 * gte-small cosine similarity the best passage needs before the model is asked (chat.md suggests
 * 0.75). gte-small scores even unrelated English text around 0.7, so this sits just above that.
 */
export const SIMILARITY_MIN = 0.75;
/** Passages between this and SIMILARITY_MIN are sent along, or shown as "Closest I found". */
export const SIMILARITY_LOOSE = 0.7;
/** Keyword mode: share of the question's key words a passage must contain to answer from it. */
export const KEYWORD_MIN = 0.5;
/** Keyword mode: below KEYWORD_MIN but at least this is "Closest I found". */
export const KEYWORD_LOOSE = 0.3;
/** Candidates fetched from full-text search before they are scored here. */
export const KEYWORD_CANDIDATES = 30;

// Words that say what kind of answer is wanted, not what it is about.
const ASKING = new Set((
  "what which who whom whose when where why how does did doe can could would should will shall may might must "
  + "explain describe define definition tell give list name state key main point points simply simple about mean "
  + "means meaning example examples please summarise summarize summary short briefly brief quick quiz question one "
  + "into more much many some any other again also just like").split(" "));

/** The words of a question a passage has to share (stemmed, no question words or stop words). */
export function keyTerms(question: string): string[] {
  return [...new Set(words(question).filter((w) => !ASKING.has(w)).map(stem))];
}

/** Share of the key terms found in a text (0–1) and how often they occur there. */
export function keywordScore(terms: string[], text: string): { coverage: number; hits: number } {
  if (!terms.length) return { coverage: 0, hits: 0 };
  const counts = new Map<string, number>();
  for (const w of words(text)) {
    const s = stem(w);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let found = 0;
  let hits = 0;
  for (const t of terms) {
    const n = counts.get(t) ?? 0;
    if (n) { found++; hits += n; }
  }
  return { coverage: found / terms.length, hits };
}

/** Passages ranked for a question by keyword coverage (best first); only ones sharing at least one term. */
export function rankByKeywords<T extends { id: string; text: string }>(question: string, list: T[]): { item: T; score: number }[] {
  const terms = keyTerms(question);
  return list
    .map((item) => ({ item, ...keywordScore(terms, item.text) }))
    .filter((x) => x.coverage > 0)
    .sort((a, b) => b.coverage - a.coverage || b.hits - a.hits || a.item.id.localeCompare(b.item.id))
    .map(({ item, coverage }) => ({ item, score: coverage }));
}

export type Retrieved<T> = {
  /** The passages to answer from (empty: not covered, so the model isn't asked). */
  passages: T[];
  /** When not covered: up to 2 loosely related passages for "Closest I found". */
  closest: T[];
};

/**
 * Whether the notes cover a question. Answers only when the best passage reaches `min`; then the
 * top `TOP_K` passages at or above `loose` go to the model. Otherwise up to 2 at or above `loose`
 * are offered as "Closest I found". `ranked` must be best first.
 */
export function decide<T>(ranked: { item: T; score: number }[], min: number, loose: number): Retrieved<T> {
  const usable = ranked.filter((r) => r.score >= loose);
  if (ranked.length && ranked[0].score >= min) return { passages: usable.slice(0, TOP_K).map((r) => r.item), closest: [] };
  return { passages: [], closest: usable.slice(0, 2).map((r) => r.item) };
}
