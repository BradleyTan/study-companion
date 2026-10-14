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
