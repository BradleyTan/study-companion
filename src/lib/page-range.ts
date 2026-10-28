// Page ranges for making flashcards (flashcards.md "Long files") and quizzes (quiz-builder.md,
// same pattern with the quiz budget) from long lecture files. Pure and client-safe: the dialogs
// use it for hints, the server for the real answer.
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
  return pageStatsFromCounts(chunks.map((c) => ({ page: c.page, chars: c.text.length })), pageCount);
}

/** Highest page number counted (above the 500-page extraction limit, as defence in depth). */
const MAX_PAGE = 10_000;

/** Same as pageStats, from characters already summed per page (repo.listPageChars). */
export function pageStatsFromCounts(rows: { page: number | null; chars: number }[], pageCount: number | null): PageStats {
  let looseChars = 0;
  let totalChars = 0;
  let maxPage = 0;
  const paged = (p: number | null): p is number => p !== null && Number.isInteger(p) && p >= 1 && p <= MAX_PAGE;
  for (const r of rows) {
    totalChars += r.chars;
    if (!paged(r.page)) looseChars += r.chars;
    else maxPage = Math.max(maxPage, r.page);
  }
  if (maxPage === 0) return { pageChars: null, looseChars, totalChars };
  const pageChars = new Array<number>(Math.min(MAX_PAGE, Math.max(maxPage, pageCount ?? 0))).fill(0);
  for (const r of rows) if (paged(r.page)) pageChars[r.page - 1] += r.chars;
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
  /** `snap` is the covered fit from the same first page ("Want every passage? Use pages 1–6"). */
  | { kind: "sampled"; text: string; snap: PageRange | null };

/** What a set is made of, for the hint wording ("Cards will be spread…", "Questions will be spread…"). */
export type RangeNoun = "Cards" | "Questions" | "Notes";

/** The coverage hint under the page fields. Never a warning: a wide range is a quick sample. */
export function rangeHint(pageChars: number[] | null, looseChars: number, range: PageRange, unit: PageUnit = "page", budget: number = FLASHCARDS_MAX_CHARS, noun: RangeNoun = "Cards"): RangeHint {
  const lower = noun.toLowerCase();
  if (!pageChars) return { kind: "unknown", text: `${noun} will be spread across the ${unit}s you pick.` };
  const chars = rangeChars(pageChars, looseChars, range);
  if (chars < MIN_SOURCE_CHARS) return { kind: "thin", text: `These ${unit}s don't have much text. Add a ${unit} or two.` };
  if (chars <= budget) return { kind: "covered", text: `Covers every passage on ${pagesText(range, unit)}.` };
  const fit = fitPageRange(pageChars, looseChars, range.from, budget);
  const fitOk = isCovered(pageChars, looseChars, fit, budget);
  if (!fitOk && range.to <= fit.to) return { kind: "long_page", text: `${cap(unit)} ${range.from} has lots of text, so ${lower} will be spread across it.` };
  return {
    kind: "sampled",
    text: `${noun} will be spread across ${pagesText(range, unit)}, a quick tour of the lot.`,
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

/** Range size used without per-page counts and by the "20 pages" quick pick. */
export const DEFAULT_PAGES = 20;

/** Default range for a long file (fit rule; without page counts, up to 20 pages). */
export function defaultRange(pageChars: number[] | null, looseChars: number, pageCount: number, from: number, budget: number = FLASHCARDS_MAX_CHARS): PageRange {
  if (pageChars) return fitPageRange(pageChars, looseChars, from, budget);
  return sizedRange(from, DEFAULT_PAGES, pageCount);
}

/** `size` pages from `from`, clamped to the file. */
export function sizedRange(from: number, size: number, pageCount: number): PageRange {
  const last = Math.max(1, pageCount);
  const start = Math.min(Math.max(1, Math.floor(from)), last);
  return { from: start, to: Math.min(last, start + Math.max(1, Math.floor(size)) - 1) };
}

/** True when a page after `afterPage` has text (without counts: when there is a page after it). */
function textAfter(pageChars: number[] | null, afterPage: number, pageCount: number): boolean {
  if (!pageChars) return afterPage < pageCount;
  for (let p = afterPage + 1; p <= pageChars.length; p++) if (pageChars[p - 1] > 0) return true;
  return false;
}

/**
 * The server's `next` range after a set (flashcards.md "Next follows the size the student
 * chose"): a best-fit set continues by the fit rule; any other set keeps its size from the page
 * after it, clamped to the file. Null when no later page has text.
 */
export function seriesNext(pageChars: number[] | null, looseChars: number, range: PageRange, pageCount: number, budget: number = FLASHCARDS_MAX_CHARS): PageRange | null {
  if (!textAfter(pageChars, range.to, pageCount)) return null;
  if (pageChars && fitPageRange(pageChars, looseChars, range.from, budget).to === range.to) {
    return nextRange(pageChars, looseChars, range.to, budget);
  }
  return sizedRange(range.to + 1, range.to - range.from + 1, Math.max(pageCount, pageChars?.length ?? 0));
}

// ---- quick picks ----------------------------------------------------------------

export type PickId = "fit" | "20" | "50" | "all";
export type QuickPick = { id: PickId; label: string; name: string; range: PageRange };
const sameRange = (a: PageRange, b: PageRange) => a.from === b.from && a.to === b.to;

/**
 * Quick picks under the page fields: "Best fit", "20 pages", "50 pages" (or "All N pages" when
 * the file has ≤ 50). A pick equal to another is hidden ("20 pages" first); fewer than two
 * picks show no row at all (empty list).
 */
export function quickPicks(pageChars: number[] | null, looseChars: number, pageCount: number, from: number, unit: PageUnit = "page", budget: number = FLASHCARDS_MAX_CHARS): QuickPick[] {
  const fit = pageChars ? fitPageRange(pageChars, looseChars, from, budget) : null;
  const twenty = sizedRange(from, DEFAULT_PAGES, pageCount);
  const third: QuickPick = pageCount <= MAX_CARD_PAGES
    ? { id: "all", label: `All ${pageCount} ${unit}s`, name: `All ${pageCount} ${unit}s`, range: { from: 1, to: pageCount } }
    : (() => { const r = sizedRange(from, MAX_CARD_PAGES, pageCount); return { id: "50" as const, label: `${MAX_CARD_PAGES} ${unit}s`, name: `${MAX_CARD_PAGES} ${unit}s: ${pagesSpoken(r, unit)}`, range: r }; })();
  const list: QuickPick[] = [];
  if (fit) list.push({ id: "fit", label: "Best fit", name: `Best fit: ${pagesSpoken(fit, unit)}`, range: fit });
  if (!list.some((p) => sameRange(p.range, twenty)) && !sameRange(third.range, twenty)) {
    list.push({ id: "20", label: `${DEFAULT_PAGES} ${unit}s`, name: `${DEFAULT_PAGES} ${unit}s: ${pagesSpoken(twenty, unit)}`, range: twenty });
  }
  if (!list.some((p) => sameRange(p.range, third.range))) list.push(third);
  return list.length > 1 ? list : [];
}

/** How "Last page" follows a new "First page": the fit rule, or keep a size. */
export type RefitMode = { kind: "fit" } | { kind: "size"; size: number };

/** The mode a range implies: the fit when it equals the fit from its first page, else its size. */
export function modeOf(pageChars: number[] | null, looseChars: number, range: PageRange, budget: number = FLASHCARDS_MAX_CHARS): RefitMode {
  if (pageChars && fitPageRange(pageChars, looseChars, range.from, budget).to === range.to) return { kind: "fit" };
  return { kind: "size", size: range.to - range.from + 1 };
}

/** The range after "First page" changes to `from`, following the pressed pick (or the size). */
export function refit(mode: RefitMode, pageChars: number[] | null, looseChars: number, pageCount: number, from: number, budget: number = FLASHCARDS_MAX_CHARS): PageRange {
  if (mode.kind === "fit" && pageChars) return fitPageRange(pageChars, looseChars, from, budget);
  return sizedRange(from, mode.kind === "size" ? Math.min(mode.size, MAX_CARD_PAGES) : DEFAULT_PAGES, pageCount);
}

// ---- pages covered (union of ranges made) ---------------------------------------

export type Coverage = [number, number][];

/** Merged, sorted union of ranges (overlapping or touching ranges join). */
export function mergeRanges(list: Coverage, add?: PageRange): Coverage {
  const all = [...list, ...(add ? [[add.from, add.to] as [number, number]] : [])]
    .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a)
    .sort((x, y) => x[0] - y[0]);
  const out: Coverage = [];
  for (const [a, b] of all) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Last page with text (without counts: the last page). */
export function lastTextPage(pageChars: number[] | null, pageCount: number): number {
  if (pageChars) for (let p = pageChars.length; p >= 1; p--) if (pageChars[p - 1] > 0) return p;
  return pageChars ? 0 : pageCount;
}

/**
 * The union clamped to the file, with the pages after the last page with text counted as done
 * once that page is covered.
 */
export function effectiveCoverage(union: Coverage, pageChars: number[] | null, pageCount: number): Coverage {
  let list = mergeRanges(union.map(([a, b]) => [a, Math.min(b, pageCount)] as [number, number]).filter(([a, b]) => a <= b));
  const last = lastTextPage(pageChars, pageCount);
  if (last < pageCount && (last === 0 || list.some(([a, b]) => a <= last && last <= b))) list = mergeRanges(list, { from: last + 1, to: pageCount });
  return list;
}

export const coveredCount = (list: Coverage) => list.reduce((n, [a, b]) => n + b - a + 1, 0);

/** Progress line: "Pages 1–34 of 42 done", "26 of 42 pages done", "All 42 pages done. Nice work!". */
export function coverageText(list: Coverage, pageCount: number, unit: PageUnit, sampled: boolean): string {
  const n = coveredCount(list);
  if (n >= pageCount) return `All ${pageCount} ${unit}s done. Nice work!`;
  const tail = sampled ? " (some passages sampled)" : "";
  if (list.length === 1 && list[0][0] === 1) return `${pagesTitle({ from: 1, to: list[0][1] }, unit)} of ${pageCount} done${tail}`;
  return `${n} of ${pageCount} ${unit}s done${tail}`;
}

/** First line of the hint when the student has made sets from this file before. */
export function madeSoFarText(list: Coverage, pageCount: number, unit: PageUnit): string | null {
  if (!list.length) return null;
  if (list.length === 1 && list[0][0] === 1) return `You've made cards from ${pagesText({ from: 1, to: list[0][1] }, unit)} so far.`;
  return `You've made cards from ${coveredCount(list)} of ${pageCount} ${unit}s so far.`;
}

/** Whether a range overlaps pages already made: none, some (and adds new ones) or all. */
export function overlapOf(list: Coverage, range: PageRange): "none" | "some" | "all" {
  let inside = 0;
  for (const [a, b] of list) inside += Math.max(0, Math.min(b, range.to) - Math.max(a, range.from) + 1);
  if (inside === 0) return "none";
  return inside >= range.to - range.from + 1 ? "all" : "some";
}

/** Where the default range starts: the first page not made yet that has text, else null (page 1). */
export function firstUnmade(list: Coverage, pageChars: number[] | null, pageCount: number): number | null {
  if (!list.length) return null;
  const made = (p: number) => list.some(([a, b]) => a <= p && p <= b);
  for (let p = 1; p <= pageCount; p++) {
    if (made(p)) continue;
    if (!pageChars || (pageChars[p - 1] ?? 0) > 0) return p;
  }
  return null;
}

/** Parses the stored coverage (invalid = empty). */
export function parseCoverage(raw: string | null): Coverage {
  if (raw === null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const pairs = v.filter((x): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every((n) => Number.isInteger(n) && n >= 1 && n <= 10_000));
    return mergeRanges(pairs);
  } catch {
    return [];
  }
}
