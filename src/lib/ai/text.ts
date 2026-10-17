// Small text helpers shared by validation, the fake generator and passage matching.

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Half an emoji (a lone surrogate) or a control character: Postgres refuses the first. */
const UNSAFE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\u0000-\u001f\u007f]/g;

/** Cut to `max` characters at a word boundary when possible, never through an emoji. */
export function clip(s: string, max: number): string {
  const t = collapse(s.replace(UNSAFE, " "));
  if (t.length <= max) return t;
  let cut = t.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

export function sentences(text: string): string[] {
  return (collapse(text).match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

const STOP = new Set("the a an of and or to in on for is are was were be by with as at that this it its from into than then".split(" "));
export function words(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

/** How many distinct content words `a` shares with `b`. */
export function overlap(a: string, b: string): number {
  const bw = new Set(words(b));
  return new Set(words(a).filter((w) => bw.has(w))).size;
}

/** Case- and whitespace-insensitive "does `hay` contain `needle`". */
export function containsLoose(hay: string, needle: string): boolean {
  const n = collapse(needle).toLowerCase();
  return n.length > 0 && collapse(hay).toLowerCase().includes(n);
}

/**
 * A card front for duplicate checks (flashcards.md "Overlapping ranges"): trimmed, lower-case,
 * whitespace collapsed, trailing ?.!: and spaces removed.
 */
export function normaliseFront(front: string): string {
  // Trimmed with a loop, not /[...]+$/: that regex backtracks quadratically on long runs of
  // punctuation that don't end the string (security review S2-13).
  const s = collapse(front).toLowerCase();
  let end = s.length;
  while (end > 0 && TRAILING.test(s[end - 1])) end--;
  return s.slice(0, end);
}
const TRAILING = /[\s?.!:？！。：]/u;

/** Scripts written without spaces between words (word checks don't apply to them). */
export const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** Very light stemming so "membranes"/"membrane" and "dividing"/"divide" match. */
export function stem(w: string): string {
  const rules: [RegExp, string][] = [[/ies$/, "y"], [/(ing|ed|es|ly)$/, ""], [/s$/, ""], [/e$/, ""]];
  let out = w;
  for (const [re, rep] of rules) {
    const next = out.replace(re, rep);
    if (next !== out && next.length >= 3) out = next;
  }
  return out;
}

/** Numbers written in a text ("3.5", "45%", "1,200"), normalised for comparison. */
export function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => (/^\d{1,3}(,\d{3})+$/.test(n) ? n.replace(/,/g, "") : n.replace(",", ".")));
}
