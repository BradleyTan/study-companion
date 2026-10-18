import { SUP } from "../extract/scripts";
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

/**
 * Sentences of a text. A full stop inside a number ("7.35", "98.08") or after a single capital
 * before a lower-case word (the "E." of "E. coli") does not end a sentence.
 */
export function sentences(text: string): string[] {
  return (collapse(text).match(SENTENCE) ?? []).map((s) => s.trim()).filter(Boolean);
}
const NOT_END = String.raw`(?:[^.!?]|\.(?=\d)|(?<=(?:^|[\s(])\p{Lu})\.(?=\s\p{Ll}))`;
const SENTENCE = new RegExp(String.raw`${NOT_END}+[.!?]+["')\]]*|${NOT_END}+$`, "gu");

export const STOP = new Set("the a an of and or to in on for is are was were be by with as at that this it its from into than then".split(" "));
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

/**
 * Very light stemming so "membranes"/"membrane", "dividing"/"divide" and the Latin plurals of
 * science ("mitochondria"/"mitochondrion", "bacteria"/"bacterium") match.
 */
export function stem(w: string): string {
  const rules: [RegExp, string][] = [[/ies$/, "y"], [/(ing|ed|es|ly)$/, ""], [/s$/, ""], [/e$/, ""]];
  let out = w;
  for (const [re, rep] of rules) {
    const next = out.replace(re, rep);
    if (next !== out && next.length >= 3) out = next;
  }
  if (out.length >= 7 && !/[^\p{L}]/u.test(out)) out = out.replace(/(?:on|um|a)$/, "");
  return out;
}


// ---- grounding: is an answer supported by its passage? ------------------------------------
// Science notation must survive the comparison both ways (Bradley, 2026-10-17): H₂O and H2O are
// the same, 10⁸ is not 108, C₆H₁₂O₅ is not C₆H₁₂O₆, −70 is not +70, α-helix is not β-helix.
// Every pattern that can start anywhere begins with a lookbehind, so a match only starts at a
// token's first character: without it, runs like "1.1.1.1…" or "a1a1a1…" backtrack quadratically.

/** A run of Unicode superscript characters (the ones extraction produces, see extract/scripts.ts). */
const SUPERSCRIPTS = new RegExp(`[${[...new Set(Object.values(SUP))].join("")}]+`, "gu");
export const GREEK = /\p{Script=Greek}/u;
/** Number scales: "132 million" is not "132 billion". */
export const SCALE = /^(?:thousand|million|billion|trillion)$/;

/**
 * Canonical text for grounding checks (never shown): superscript runs become "^" + run
 * ("10⁸" → "10^8", "Ca²⁺" → "Ca^2+"), then NFKC (subscripts to digits "H₂O" → "H2O", "ﬁ" → "fi",
 * "µ" → "μ"), every dash and minus sign becomes "-", "<=>"/"↔"/"⇄" become "⇌" and "->"/"⟶"
 * become "→", digit groups split by a space ("100 000") are joined, and it is lower-cased.
 */
export function canonical(s: string): string {
  return s
    .replace(SUPERSCRIPTS, (m) => `^${m}`)
    .normalize("NFKC")
    .replace(/[‐-―−﹣－]/g, "-")
    .replace(/<=>|<->|[↔⇄⇋]/g, "⇌")
    .replace(/-->|->|=>|[⟶⇒]/g, "→")
    .replace(/(?<![\d.,])(\d{1,3})[    ](?=\d{3}(?![\d.,]))/g, "$1")
    .toLowerCase();
}

/** "70mV" → "70 mV" (a number glued to its unit); "6CO2" stays one term. */
const GLUED_UNIT = /(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)*)(\p{L}+)(?![\p{L}\p{N}])/gu;

export const NUMBER_WORD_VALUES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

/** "1,200" → 1200, "2,5" → 2.5, "4.0" → 4 (as a canonical string, so 4% and 4.0% match). */
function numberValue(raw: string): string {
  const n = /^\d{1,3}(,\d{3})+$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : n;
}

/**
 * Numbers written in a text, as canonical strings with their sign: "−70 mV" → "-70",
 * "7.35–7.45" → "7.35", "7.45" (a range, not a minus), "10⁸" → "10", "8", "45%" → "45".
 * Digits inside a term ("H2O", "BRCA1", "6CO2") are not numbers here; terms are checked whole.
 */
export function numbersIn(s: string): string[] {
  return scanNumbers(s).map((n) => n.value);
}

/**
 * Same as numbersIn, also saying when the minus is a hyphen after a word ("type-2", "L-1"), so
 * an answer may write the number without it ("type 2 diabetes").
 */
export function scanNumbers(s: string): { value: string; hyphen: boolean }[] {
  const c = canonical(s).replace(GLUED_UNIT, "$1 $2");
  const out: { value: string; hyphen: boolean }[] = [];
  for (const m of c.matchAll(/(?<![\d.,])\d+(?:[.,]\d+)*/g)) {
    const i = m.index;
    const before = c[i - 1] ?? "";
    const after = c[i + m[0].length] ?? "";
    if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
    // A minus sign, not a range ("7.35-7.45"); after a letter ("l-1" in mol·L-1) it is kept too.
    const prev = c[i - 2] ?? "";
    const signed = before === "-" && !/[\p{N}.,)\]]/u.test(prev);
    out.push({ value: `${signed ? "-" : ""}${numberValue(m[0].replace(/[.,]$/, ""))}`, hyphen: signed && /\p{L}/u.test(prev) });
  }
  return out;
}

const LATIN_EPITHET = /(?:us|um|is|ae|ii|i|ens|ensis|a|ica|oides|ata|ana)$/;
const BINOMIAL = /(?<![\p{L}])(\p{Lu}\p{Ll}+|\p{Lu}\.)\s+(\p{Ll}{3,})(?![\p{L}])/gu;
/** Capitalised words that start sentences, never a genus ("The nucleus", "In bacteria"). */
const NOT_GENUS = new Set(("the a an this that these those its it their there they each every some all most many any no "
  + "in on at by for from with into onto over under when where which what why how both such our your his her "
  + "one two three another other only also then thus hence so but and or if as after before during").split(" "));

/** Units whose prefix changes the size (µm vs mm): a number's unit must match the passage's. */
const UNITS = new Set(("m mm cm km μm nm pm g mg kg μg ng l ml μl dl mol mmol μmol nmol pmol s ms μs ns min h hz khz mhz "
  + "v mv μv kv a ma μa j kj mj cal kcal w kw mw pa kpa mpa atm k °c °f da kda bp kb mb gb").split(" "));

/** Facts of a text the grounding check compares. */
export type Facts = {
  numbers: string[];
  /** Stemmed content words (3+ letters, or any word with a Greek letter: α, ΔG). */
  words: string[];
  /** Terms mixing letters and digits, compared whole: h2o, c6h12o6, brca1, p53, 6co2. */
  terms: string[];
  /** The canonical text with spaces and "^" removed, for finding an equation in it. */
  squashed: string;
  /** Genus (or "e.") → species epithets named with it. */
  species: Map<string, Set<string>>;
  /** Superscripted terms, compared whole: "ca^2+", "mc^2", "10^8", "l^-1", "h^+". */
  scripted: string[];
  /** Greek-prefixed compounds, compared whole: "α-helix", "β-sheet". */
  compounds: string[];
  /** Number → units written right after it ("30" → "μm"), from UNITS. */
  units: Map<string, Set<string>>;
};

export function factsOf(text: string): Facts {
  const c = canonical(text);
  const tokens = c.replace(GLUED_UNIT, "$1 $2").match(/[\p{L}\p{N}]+/gu) ?? [];
  const words: string[] = [];
  const terms: string[] = [];
  for (const t of tokens) {
    const letters = /\p{L}/u.test(t);
    if (letters && /\p{N}/u.test(t)) terms.push(t);
    else if (letters && (GREEK.test(t) || (t.length > 2 && !STOP.has(t)))) words.push(NUMBER_WORD_VALUES[t] !== undefined || SCALE.test(t) ? t : stem(t));
  }
  const species = new Map<string, Set<string>>();
  for (const m of text.normalize("NFKC").matchAll(BINOMIAL)) {
    const genus = m[1].toLowerCase();
    if (!LATIN_EPITHET.test(m[2]) || NOT_GENUS.has(genus)) continue;
    species.set(genus, (species.get(genus) ?? new Set()).add(m[2]));
  }
  const scripted = [...c.matchAll(/(?<![\p{L}\p{N}])([\p{L}\p{N}]+)\^([\d+\-]+)/gu)].map((m) => `${m[1]}^${m[2]}`);
  const compounds = [...c.matchAll(/(?<![\p{L}])(\p{Script=Greek}+)-(\p{L}+)/gu)].map((m) => `${m[1]}-${stem(m[2])}`);
  const units = new Map<string, Set<string>>();
  for (const m of c.matchAll(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)*) ?(°?\p{L}+)(?![\p{L}])/gu)) {
    if (!UNITS.has(m[2])) continue;
    const n = numberValue(m[1]);
    units.set(n, (units.get(n) ?? new Set()).add(m[2]));
  }
  return { numbers: numbersIn(text), words, terms, squashed: c.replace(/[\s^]+/g, ""), species, scripted, compounds, units };
}

/** What an answer may draw on from a passage, as sets. */
export type PassageFacts = Omit<Facts, "numbers" | "words" | "terms" | "scripted" | "compounds"> & {
  /** Numbers, plus number words ("five" → 5) and hyphenated numbers without the hyphen ("type-2" → 2). */
  numbers: Set<string>;
  words: Set<string>;
  /** Terms, also without a leading coefficient ("6co2" → "co2") and with superscripts flattened ("ca2", "mc2"). */
  terms: Set<string>;
  scripted: Set<string>;
  compounds: Set<string>;
};

const passageCache = new Map<string, PassageFacts>();

/** Facts of a passage, worked out once per text (every card citing it reuses them). */
export function passageFacts(text: string): PassageFacts {
  const hit = passageCache.get(text);
  if (hit) return hit;
  const f = factsOf(text);
  const numbers = new Set(f.numbers);
  for (const w of f.words) if (NUMBER_WORD_VALUES[w] !== undefined) numbers.add(String(NUMBER_WORD_VALUES[w]));
  for (const n of scanNumbers(text)) if (n.hyphen) numbers.add(n.value.slice(1));
  const terms = new Set(f.terms.flatMap((t) => [t, t.replace(/^\d+(?=\p{L})/u, "")]));
  for (const t of factsOf(text.replace(SUPERSCRIPTS, (m) => m.normalize("NFKC"))).terms) terms.add(t);
  const out: PassageFacts = { ...f, numbers, words: new Set(f.words), terms, scripted: new Set(f.scripted), compounds: new Set(f.compounds) };
  if (passageCache.size >= 200) passageCache.clear();
  passageCache.set(text, out);
  return out;
}

/** Equations in canonical text: the run of formula-like tokens around each =, → or ⇌. */
export function equationsIn(c: string): string[] {
  const tokens = c.split(/\s+/).filter(Boolean);
  const plainWord = (t: string) => /^\p{L}{2,}$/u.test(t.replace(/[.,;:!?]+$/, "")) && !GREEK.test(t);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!/[=→⇌]/.test(tokens[i])) { i++; continue; }
    let a = i;
    while (a > 0 && !plainWord(tokens[a - 1]) && !/[.,;:!?]$/.test(tokens[a - 1])) a--;
    let b = i;
    while (b + 1 < tokens.length && !/[.,;:!?]$/.test(tokens[b]) && !plainWord(tokens[b + 1])) b++;
    const eq = tokens.slice(a, b + 1).join("").replace(/\^/g, "").replace(/[.,;:!?]+$/, "");
    if (/[\p{L}\p{N}]/u.test(eq.replace(/[=→⇌]/g, "")) && /[\p{L}\p{N}].*[=→⇌]|[=→⇌].*[\p{L}\p{N}]/u.test(eq)) out.push(eq);
    i = b + 1;
  }
  return out;
}
