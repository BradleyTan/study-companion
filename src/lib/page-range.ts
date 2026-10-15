// Page ranges for making flashcards from long lecture files (flashcards.md "Long files").
// Pure and client-safe: the dialog uses it for hints, the server for the real answer.
import { FLASHCARDS_MAX_CHARS, MIN_SOURCE_CHARS } from "./limits/ai";
import { MAX_CARD_PAGES } from "./validation";

export type PageRange = { from: number; to: number };
export type PageUnit = "page" | "slide";

/** Characters per page (index 0 = page 1) and characters of passages without a page number. */
export type PageStats = { pageChars: number[] | null; looseChars: number; totalChars: number };

/**
 * Per-page character counts of a file's passages. `pageChars` is null when no passage has a
 * page number (nothing to fit pages against). Its length covers `pageCount` and every page seen.
 */
export function pageStats(chunks: { page: number | null; text: string }[], pageCount: number | null): PageStats {
  let looseChars = 0;
  let totalChars = 0;
  let maxPage = 0;
  for (const c of chunks) {
    totalChars += c.text.length;
    if (c.page === null || c.page < 1) looseChars += c.text.length;
    else maxPage = Math.max(maxPage, c.page);
  }
  if (maxPage === 0) return { pageChars: null, looseChars, totalChars };
  const pageChars = new Array<number>(Math.max(maxPage, pageCount ?? 0)).fill(0);
  for (const c of chunks) if (c.page !== null && c.page >= 1) pageChars[c.page - 1] += c.text.length;
  return { pageChars, looseChars, totalChars };
}

/** Characters a range sends: its pages plus the loose passages (sent with every range). */
export function rangeChars(pageChars: number[], looseChars: number, range: PageRange): number {
  let n = looseChars;
  for (let p = Math.max(1, range.from); p <= Math.min(range.to, pageChars.length); p++) n += pageChars[p - 1];
  return n;
}

/**
 * The fit rule: from `from`, add pages while the range's characters stay within `budget` and it
 * stays within `maxPages`. Always at least one page; pages without text cost nothing and are
 * swallowed (even after a page that alone is over the budget).
 */
export function fitPageRange(pageChars: number[], looseChars: number, from: number, budget: number = FLASHCARDS_MAX_CHARS, maxPages: number = MAX_CARD_PAGES): PageRange {
  const last = Math.max(1, pageChars.length);
  const start = Math.min(Math.max(1, Math.floor(from)), last);
  let to = start;
  let used = looseChars + (pageChars[start - 1] ?? 0);
  while (to < pageChars.length && to - start + 1 < maxPages) {
    const next = pageChars[to];
    if (next > 0 && used + next > budget) break;
    used += next;
    to++;
  }
  return { from: start, to };
}

/** True when every passage of the range fits in one request (no sampling). */
export function isCovered(pageChars: number[], looseChars: number, range: PageRange, budget: number = FLASHCARDS_MAX_CHARS): boolean {
  return rangeChars(pageChars, looseChars, range) <= budget;
}

/** The range after `afterPage` by the fit rule, or null when no page after it has text. */
export function nextRange(pageChars: number[], looseChars: number, afterPage: number, budget: number = FLASHCARDS_MAX_CHARS, maxPages: number = MAX_CARD_PAGES): PageRange | null {
  for (let p = afterPage + 1; p <= pageChars.length; p++) {
    if (pageChars[p - 1] > 0) return fitPageRange(pageChars, looseChars, afterPage + 1, budget, maxPages);
  }
  return null;
}

/** Whether a file needs page ranges at all (its text is longer than one set's budget). */
export function fitsOneSet(totalChars: number, budget: number = FLASHCARDS_MAX_CHARS): boolean {
  return totalChars <= budget;
}

// ---- copy -----------------------------------------------------------------------

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "pages 7–12" or "page 7" (en dash, for display). */
export function pagesText(range: PageRange, unit: PageUnit = "page"): string {
  return range.from === range.to ? `${unit} ${range.from}` : `${unit}s ${range.from}–${range.to}`;
}
/** "pages 7 to 12" (for screen-reader names). */
export function pagesSpoken(range: PageRange, unit: PageUnit = "page"): string {
  return range.from === range.to ? `${unit} ${range.from}` : `${unit}s ${range.from} to ${range.to}`;
}
/** "Pages 7–12" or "Page 7", for the start of a sentence. */
export const pagesTitle = (range: PageRange, unit: PageUnit = "page") => cap(pagesText(range, unit));

export type RangeHint =
  | { kind: "unknown"; text: string }
  | { kind: "thin"; text: string }
  | { kind: "covered"; text: string }
  | { kind: "long_page"; text: string }
  | { kind: "sampled"; text: string; snap: PageRange | null };

/** The coverage hint under the page fields. */
export function rangeHint(pageChars: number[] | null, looseChars: number, range: PageRange, unit: PageUnit = "page", budget: number = FLASHCARDS_MAX_CHARS): RangeHint {
  if (!pageChars) return { kind: "unknown", text: `Cards will come from across the ${unit}s you pick.` };
  const chars = rangeChars(pageChars, looseChars, range);
  if (chars < MIN_SOURCE_CHARS) return { kind: "thin", text: `These ${unit}s don't have much text. Add a ${unit} or two.` };
  if (chars <= budget) return { kind: "covered", text: `Covers every passage on ${pagesText(range, unit)}.` };
  const fit = fitPageRange(pageChars, looseChars, range.from, budget);
  const fitOk = isCovered(pageChars, looseChars, fit, budget);
  if (!fitOk && range.to <= fit.to) return { kind: "long_page", text: `${cap(unit)} ${range.from} is long: cards will come from across it.` };
  return {
    kind: "sampled",
    text: `Long range: cards will come from across ${pagesText(range, unit)}. Pick fewer ${unit}s to cover every passage.`,
    snap: fitOk ? fit : null,
  };
}

/** Inline validation of the two page fields; null when the range is fine. */
export function rangeError(fromText: string, toText: string, pageCount: number, unit: PageUnit = "page", maxPages: number = MAX_CARD_PAGES): { field: "from" | "to"; text: string } | null {
  const outOfRange = `Pick a ${unit} between 1 and ${pageCount}.`;
  const parse = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN);
  const from = parse(fromText);
  const to = parse(toText);
  if (!(from >= 1 && from <= pageCount)) return { field: "from", text: outOfRange };
  if (!(to >= 1 && to <= pageCount)) return { field: "to", text: outOfRange };
  if (to < from) return { field: "to", text: `The last ${unit} comes before the first.` };
  if (to - from >= maxPages) return { field: "to", text: `Up to ${maxPages} ${unit}s at a time.` };
  return null;
}

/** Where a long file's default range starts: after the furthest page made last time, else page 1. */
export function resumeFrom(pageChars: number[] | null, looseChars: number, pageCount: number, storedLast: number | null): number | null {
  if (storedLast === null || !Number.isInteger(storedLast) || storedLast < 1 || storedLast >= pageCount) return null;
  if (pageChars && !nextRange(pageChars, looseChars, storedLast)) return null;
  return storedLast + 1;
}

/** Default range for a long file (fit rule; without page counts, up to 20 pages). */
export function defaultRange(pageChars: number[] | null, looseChars: number, pageCount: number, from: number): PageRange {
  if (pageChars) return fitPageRange(pageChars, looseChars, from);
  const start = Math.min(Math.max(1, from), Math.max(1, pageCount));
  return { from: start, to: Math.min(Math.max(1, pageCount), start + MAX_CARD_PAGES - 1) };
}
