// Read-aloud helpers (read-aloud.md). Pure, so they can be unit tested without a browser.

export type Sentence = { text: string; start: number; end: number };

/** Splits text into sentences with their offsets, using Intl.Segmenter when available. */
export function splitSentences(text: string, lang = "en"): Sentence[] {
  const out: Sentence[] = [];
  const push = (start: number, end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (/[\p{L}\p{N}]/u.test(t)) out.push({ text: t, start: start + lead, end: start + lead + t.length });
  };
  // Line breaks always end a sentence (headings and list items are read on their own).
  let lineStart = 0;
  for (const line of text.split("\n")) {
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
      const seg = new Intl.Segmenter(lang, { granularity: "sentence" });
      for (const s of seg.segment(line)) push(lineStart + s.index, lineStart + s.index + s.segment.length);
    } else {
      const re = /[^.!?]+[.!?]*\s*/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) push(lineStart + m.index, lineStart + m.index + m[0].length);
    }
    lineStart += line.length + 1;
  }
  return out;
}

export type VoiceLike = { name: string; lang: string; voiceURI: string; localService: boolean; default?: boolean };

/**
 * Voices grouped for the picker: on-device first, online after; within each, voices for
 * the page language first, then the rest ("Other languages").
 */
export function groupVoices<V extends VoiceLike>(voices: V[], lang = "en") {
  const base = lang.toLowerCase().split("-")[0];
  const matches = (v: V) => v.lang.toLowerCase().replace("_", "-").split("-")[0] === base;
  const sort = (list: V[]) => [...list].sort((a, b) => Number(matches(b)) - Number(matches(a)) || a.name.localeCompare(b.name));
  const onDevice = sort(voices.filter((v) => v.localService));
  const online = sort(voices.filter((v) => !v.localService));
  return { onDevice, online, matches };
}

/** Default voice: the saved one if it's on this device, else the first on-device voice for the page language. */
export function pickVoice<V extends VoiceLike>(voices: V[], savedURI: string | null, lang = "en"): V | null {
  const saved = savedURI ? voices.find((v) => v.voiceURI === savedURI) : undefined;
  if (saved) return saved;
  const { onDevice, online, matches } = groupVoices(voices, lang);
  return onDevice.find(matches) ?? onDevice[0] ?? online.find(matches) ?? online[0] ?? null;
}

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type ReadAloudPrefs = { voiceURI: string | null; rate: number; autoReadCards: boolean };
export const PREFS_KEY = "studynest.readAloud";
export const DEFAULT_PREFS: ReadAloudPrefs = { voiceURI: null, rate: 1, autoReadCards: false };

export function parsePrefs(raw: string | null): ReadAloudPrefs {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<ReadAloudPrefs> | null;
    if (!v || typeof v !== "object") return DEFAULT_PREFS;
    return {
      voiceURI: typeof v.voiceURI === "string" ? v.voiceURI.slice(0, 500) : null,
      rate: RATES.includes(v.rate as (typeof RATES)[number]) ? (v.rate as number) : 1,
      autoReadCards: v.autoReadCards === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// ---- science notation, said out loud ----------------------------------------------------------
// Speech engines skip or garble ₂, ⁺, ⇌ and Greek letters. What is spoken is rewritten (what is
// shown and highlighted is not): "C₆H₁₂O₆" → "C 6 H 12 O 6", "Ca²⁺" → "Ca 2 plus",
// "10⁸" → "10 to the power 8", "E = mc²" → "E equals m c squared", "ΔG" → "delta G".

const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const GREEK_NAMES: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", Δ: "delta", ε: "epsilon", θ: "theta", κ: "kappa", λ: "lambda",
  μ: "mu", µ: "mu", ν: "nu", π: "pi", ρ: "rho", σ: "sigma", Σ: "sigma", τ: "tau", φ: "phi", χ: "chi", ψ: "psi", ω: "omega", Ω: "omega",
};
const MICRO_UNITS: Record<string, string> = { m: "micrometres", g: "micrograms", l: "microlitres", L: "microlitres", mol: "micromoles", s: "seconds", M: "micromolar" };

const digitsOf = (s: string, set: string) => [...s].map((c) => (set.includes(c) ? String(set.indexOf(c)) : c)).join("");

/** Text for the speech engine: notation spelled out, everything else unchanged. */
export function speakable(text: string): string {
  return text
    // µm, µg, µmol… before Greek letters are named.
    .replace(/(?<=\d\s?)[µμ](mol|m|g|l|L|s|M)\b/g, (_, u: string) => ` ${u === "s" ? "microseconds" : MICRO_UNITS[u]}`)
    // [H⁺] is a concentration.
    .replace(/\[([^\]\s]*[⁺⁻][^\]\s]*)\]/g, " concentration of $1 ")
    // Charges: Ca²⁺ → "Ca 2 plus", HCO₃⁻ → "HCO 3 minus", H⁺ → "H plus".
    .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹]*)([⁺⁻])(?![⁰¹²³⁴⁵⁶⁷⁸⁹])/g, (_, d: string, sign: string) => ` ${d ? `${digitsOf(d, SUP_DIGITS)} ` : ""}${sign === "⁺" ? "plus" : "minus"} `)
    // Powers: x² squared, x³ cubed, 10⁸ / L⁻¹ "to the power".
    .replace(/(?<![⁻⁰¹²³⁴⁵⁶⁷⁸⁹])²(?![⁰¹²³⁴⁵⁶⁷⁸⁹])/g, " squared ")
    .replace(/(?<![⁻⁰¹²³⁴⁵⁶⁷⁸⁹])³(?![⁰¹²³⁴⁵⁶⁷⁸⁹])/g, " cubed ")
    .replace(/(⁻?)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, minus: string, d: string) => ` to the power ${minus ? "minus " : ""}${digitsOf(d, SUP_DIGITS)} `)
    // Subscripts: H₂O → "H 2 O".
    .replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, (d) => ` ${digitsOf(d, SUB_DIGITS)} `)
    .replace(/[α-ωΑ-Ωµ]/g, (c) => (GREEK_NAMES[c] ? ` ${GREEK_NAMES[c]} ` : c))
    .replace(/⇌|⇄|↔/g, " is in equilibrium with ")
    .replace(/→|⟶/g, " gives ")
    .replace(/°C\b/g, " degrees Celsius").replace(/°F\b/g, " degrees Fahrenheit").replace(/°/g, " degrees ")
    .replace(/(^|[\s(=[])[−-](?=\d)|(^|[\s(=])−(?=\p{L})/gu, (_, a?: string, b?: string) => `${a ?? b ?? ""}minus `)
    .replace(/\s[−–]\s/g, " minus ")
    .replace(/\s=\s|(?<=\S)=(?=\S)/g, " equals ")
    .replace(/±/g, " plus or minus ").replace(/×/g, " times ").replace(/≈/g, " about ")
    .replace(/(?<=\d)–(?=\d)/g, " to ")
    .replace(/·/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
