// Forgiving fill-in-the-blank matching (quiz.md "Fill-in matching"). One shared function,
// used by the server when checking an answer. Pure and client-safe.

export type FillMatch = {
  correct: boolean;
  /** Accepted with one typo: the screen says "watch the spelling" and shows `expected`. */
  typo: boolean;
  /** The answer (or accepted alternative) it matched, as written in the quiz. */
  expected: string | null;
};

/** Longest answer we compare (the input is capped too). */
export const FILL_GIVEN_MAX = 200;

const LEADING_ARTICLE = /^(?:the|a|an)\s+/;

/**
 * Lower-case, no diacritics, one space between words, no leading "the/a/an", no trailing
 * punctuation. Degree signs, percent and the like are kept (units are compared separately).
 */
export function normaliseAnswer(s: string): string {
  let t = s
    .slice(0, FILL_GIVEN_MAX)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[“”«»"„]/g, "")
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  // Trailing punctuation (loop, not /[...]+$/, so long runs can't backtrack).
  let end = t.length;
  while (end > 0 && /[\s.,;:!?'")\]]/.test(t[end - 1])) end--;
  let start = 0;
  while (start < end && /[\s'"(\[]/.test(t[start])) start++;
  t = t.slice(start, end);
  return t.replace(LEADING_ARTICLE, "");
}

// ---- numbers and units ------------------------------------------------------

/** Unit spellings that mean the same thing, mapped to one form. */
const UNIT_ALIASES: [RegExp, string][] = [
  [/^(?:°|º|deg(?:ree)?s?)\s*c(?:elsius)?$/, "°c"],
  [/^(?:°|º|deg(?:ree)?s?)\s*f(?:ahrenheit)?$/, "°f"],
  [/^(?:k|kelvins?)$/, "k"],
  [/^(?:%|percent|per cent)$/, "%"],
  [/^(?:µ|μ|u)m$|^micro(?:m|met(?:re|er)s?)$/, "μm"],
  [/^(?:mm|millimet(?:re|er)s?)$/, "mm"],
  [/^(?:cm|centimet(?:re|er)s?)$/, "cm"],
  [/^(?:km|kilomet(?:re|er)s?)$/, "km"],
  [/^(?:nm|nanomet(?:re|er)s?)$/, "nm"],
  [/^(?:m|met(?:re|er)s?)$/, "m"],
  [/^(?:mg|milligrams?)$/, "mg"],
  [/^(?:kg|kilograms?)$/, "kg"],
  [/^(?:g|grams?)$/, "g"],
  [/^(?:ml|millilit(?:re|er)s?)$/, "ml"],
  [/^(?:l|lit(?:re|er)s?)$/, "l"],
  [/^(?:mv|millivolts?)$/, "mv"],
  [/^(?:v|volts?)$/, "v"],
  [/^(?:ms|milliseconds?)$/, "ms"],
  [/^(?:s|secs?|seconds?)$/, "s"],
  [/^(?:min|mins|minutes?)$/, "min"],
  [/^(?:h|hrs?|hours?)$/, "h"],
  [/^(?:mol|moles?)$/, "mol"],
  [/^(?:kj|kilojoules?)$/, "kj"],
  [/^(?:j|joules?)$/, "j"],
  [/^(?:kcal|kilocalories?)$/, "kcal"],
  [/^(?:hz|hertz)$/, "hz"],
];

function unitOf(raw: string): string {
  const u = raw.replace(/\s+/g, " ").trim().toLowerCase();
  for (const [re, to] of UNIT_ALIASES) if (re.test(u)) return to;
  return u;
}

/** "1,200" → 1200, "2,5" → 2.5, ".5" → 0.5. NaN when it isn't a number. */
function numberValue(raw: string): number {
  const r = raw.startsWith(".") ? `0${raw}` : raw;
  const n = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(r) ? r.replace(/,/g, "") : r.replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : NaN;
}

/** A number with an optional unit ("25 °C", "25°C", "25 degrees C", "-70 mV", "45%"); null when not that shape. */
export function parseQuantity(s: string): { value: number; unit: string | null } | null {
  const m = /^(-?(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*(.*)$/.exec(s.trim());
  if (!m) return null;
  const value = numberValue(m[1].startsWith("-") ? m[1].slice(1) : m[1]) * (m[1].startsWith("-") ? -1 : 1);
  if (!Number.isFinite(value)) return null;
  const rest = m[2].trim();
  if (!rest) return { value, unit: null };
  // A unit is at most three short words ("degrees C", "per cent"); anything longer is a phrase.
  if (rest.split(" ").length > 3 || rest.length > 20) return null;
  return { value, unit: unitOf(rest) };
}

// ---- singular / plural of the last word ---------------------------------------

/** Forms a word could take as singular or plural (cell/cells, species, mitochondrion/mitochondria). */
export function numberForms(w: string): Set<string> {
  const out = new Set([w]);
  const add = (x: string) => { if (x.length >= 2) out.add(x); };
  add(`${w}s`);
  add(`${w}es`);
  if (w.endsWith("s")) add(w.slice(0, -1));
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("ies")) add(`${w.slice(0, -3)}y`);
  if (w.endsWith("y")) add(`${w.slice(0, -1)}ies`);
  if (w.endsWith("um")) add(`${w.slice(0, -2)}a`);
  if (w.endsWith("on")) add(`${w.slice(0, -2)}a`);
  if (w.endsWith("a")) { add(`${w.slice(0, -1)}um`); add(`${w.slice(0, -1)}on`); add(`${w}e`); }
  if (w.endsWith("ae")) add(w.slice(0, -1));
  if (w.endsWith("us")) add(`${w.slice(0, -2)}i`);
  if (w.endsWith("i")) add(`${w.slice(0, -1)}us`);
  if (w.endsWith("is")) add(`${w.slice(0, -2)}es`);
  if (w.endsWith("es")) add(`${w.slice(0, -2)}is`);
  if (w.endsWith("ex") || w.endsWith("ix")) add(`${w.slice(0, -2)}ices`);
  if (w.endsWith("ices")) { add(`${w.slice(0, -4)}ex`); add(`${w.slice(0, -4)}ix`); }
  return out;
}

function samePhrase(a: string, b: string): boolean {
  if (a === b) return true;
  const aw = a.split(" ");
  const bw = b.split(" ");
  if (aw.length !== bw.length) return false;
  for (let i = 0; i < aw.length - 1; i++) if (aw[i] !== bw[i]) return false;
  const last = aw[aw.length - 1];
  const other = bw[bw.length - 1];
  return /\p{L}{3,}/u.test(last) && (numberForms(last).has(other) || numberForms(other).has(last));
}

// ---- one typo ----------------------------------------------------------------

/** Edit distance ≤ 1, counting a swap of two neighbouring letters as one edit. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false; }
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

const VOWEL = /^[aeiou]$/;

/**
 * Whether `given` is a plausible misspelling of the word `expected`, not a different word.
 * Science is full of real terms one letter apart (afferent/efferent, nitrate/nitrite,
 * ethane/ethene, lactose/lactase, nucleotide/nucleoside, ligase/lipase, insulin/inulin,
 * neuron/neutron, absorption/adsorption; QA step 3), so plain edit distance 1 is not enough:
 * - the word has 6+ plain letters (no digits, Greek letters or symbols) and the first letter is right;
 * - two neighbouring letters swapped ("mitochondira");
 * - a vowel or one of a double letter left out or added ("hypothalmus", "acommodate");
 * - "y" and "i" mixed up ("glycolisis");
 * - any other wrong letter only in the middle of a word of 7+ letters: never in the first two
 *   letters (ab-/ad-, en-/ex-) or the last four, where the endings that change the meaning are
 *   (-ate/-ite, -ane/-ene/-yne, -ide/-ine, -ose/-ase, -tide/-side, -onic/-opic).
 */
export function plausibleTypo(given: string, expected: string): boolean {
  const g = given;
  const e = expected;
  if (g === e || !/^[a-z]{6,}$/.test(e) || !/^[a-z]+$/.test(g) || g[0] !== e[0] || !withinOneEdit(g, e)) return false;
  if (g.length === e.length) {
    const diff: number[] = [];
    for (let i = 0; i < e.length; i++) if (g[i] !== e[i]) diff.push(i);
    if (diff.length === 2) return true; // a swap of neighbours (withinOneEdit checked it)
    const i = diff[0];
    if (/^[yi]$/.test(g[i]) && /^[yi]$/.test(e[i])) return true;
    return e.length >= 7 && i >= 2 && i < e.length - 4;
  }
  // One letter more or less: it must be a vowel or a doubled letter.
  const [short, long] = g.length < e.length ? [g, e] : [e, g];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  const extra = long[i];
  return i > 0 && (VOWEL.test(extra) || extra === long[i - 1] || extra === long[i + 1]);
}

/** One typo in exactly one word; every other word the same. */
function typoMatch(g: string, e: string): boolean {
  const gw = g.replace(/-/g, " ").split(" ");
  const ew = e.replace(/-/g, " ").split(" ");
  if (gw.length !== ew.length) return false;
  const differ = ew.map((w, i) => (w === gw[i] ? -1 : i)).filter((i) => i >= 0);
  return differ.length === 1 && plausibleTypo(gw[differ[0]], ew[differ[0]]);
}

/** A whole answer written as a number word ("five") counts as its number. */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const numberWord = (s: string) => (Object.hasOwn(NUMBER_WORDS, s) ? String(NUMBER_WORDS[s]) : s);

// ---- the matcher ---------------------------------------------------------------

function exactMatch(given: string, expected: string): boolean {
  const g = numberWord(normaliseAnswer(given));
  const e = numberWord(normaliseAnswer(expected));
  if (!g || !e) return false;
  const eq = parseQuantity(e);
  if (eq) {
    const gq = parseQuantity(g);
    if (!gq || gq.value !== eq.value) return false;
    // The unit must match when the answer has one.
    return eq.unit === null || gq.unit === eq.unit;
  }
  return samePhrase(g, e) || samePhrase(g.replace(/-/g, " "), e.replace(/-/g, " "));
}

/**
 * Whether a typed fill-in answer counts as right: after normalising both sides (case,
 * diacritics, spaces, a leading "the/a/an", trailing punctuation), numbers by value with the
 * same unit, singular/plural of the last word, and for answers of 6+ letters one typo.
 * Any accepted alternative counts the same as the answer.
 */
export function matchFill(given: string, answer: string, accepted: readonly string[] = []): FillMatch {
  const options = [answer, ...accepted].filter((x) => normaliseAnswer(x));
  for (const o of options) if (exactMatch(given, o)) return { correct: true, typo: false, expected: o };
  const g = normaliseAnswer(given);
  if (!g) return { correct: false, typo: false, expected: null };
  for (const o of options) {
    const e = normaliseAnswer(o);
    // Numbers must be exact; one plausible typo only, in one word of 6+ letters.
    if (parseQuantity(e) || /\d/.test(e)) continue;
    if (typoMatch(g, e)) return { correct: true, typo: true, expected: o };
  }
  return { correct: false, typo: false, expected: null };
}
