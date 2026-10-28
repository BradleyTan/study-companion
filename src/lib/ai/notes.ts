// Make study notes (docs/design/screens/make-notes.md): prompt and validation. Same approach as
// flashcards and quizzes: the student's text goes in as defused data, the reply is shape-checked
// with zod, every passage ref is mapped through the server's own list, and every point and key
// term must be grounded in the passage it cites. Points that fail are dropped, never replaced.
import { z } from "zod";
import { contradictsPassage } from "./contradict";
import { DATA_RULES, passagesBlock } from "./prompts";
import { groundedNearQuote, isGrounded, resolvePassage } from "./schemas";
import { clip, containsLoose, normaliseFront, overlap } from "./text";
import type { ChatMessage, Passage } from "./types";

export const NOTES_TITLE_MAX = 80;
export const NOTES_HEADING_MAX = 80;
export const NOTES_POINT_MAX = 400;
export const NOTES_TERM_MAX = 60;
export const NOTES_DEFINITION_MAX = 300;
export const NOTES_MAX_SECTIONS = 12;
export const NOTES_MAX_POINTS = 10;
export const NOTES_MAX_TERMS = 15;
/** Fewer grounded points than this and the source counts as "too little text" (go refunded). */
export const MIN_NOTE_POINTS = 3;

/** How study notes are written (student test feedback, 2026-10-28: "auto make notes from slides, websites, notes or PDFs"). */
export const NOTES_RULES = [
  "Write the notes a top student would make to revise for the exam: organised by topic in the order the passages teach it, one section per topic with a short heading.",
  "Each point is one complete sentence (under 35 words) that stands on its own and carries real content: a definition, how something works, the steps of a process in order, a cause and its effect, a difference between two ideas, an example, or a number, formula or rule. Capture the details; never write vague points like \"The lecture covers enzymes\".",
  "Every point comes from one passage, cited by its id in \"passage\". Use only what the passages say: no outside knowledge. Keep names, numbers, units, formulas, symbols and technical terms exactly as the passage writes them (H₂O, Ca²⁺, 10⁸, α-helix, ΔG, −70 mV). Plain text only: no Markdown, LaTeX or HTML.",
  "Leave out anything that isn't study content: course admin, slide or page numbers, reading lists, references, website menus, adverts, cookie notices and sign-up prompts.",
  "\"terms\" lists the key technical terms with the definition the passages give (up to 15). Skip terms the passages don't define.",
  "\"title\" names the material in a few words, such as \"Cell respiration\".",
  "Aim for 3 to 10 sections with 2 to 8 points each; fewer if the passages are short. Never pad.",
].join("\n");

export function notesMessages(passages: Passage[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You turn a university student's lecture slides, readings and notes into clear, accurate study notes.",
        DATA_RULES,
        'JSON shape: {"title":"short title","sections":[{"heading":"topic","points":[{"text":"one complete sentence","passage":"p1"}]}],"terms":[{"term":"word","definition":"what the passage says it means","passage":"p2"}]}',
        NOTES_RULES,
      ].join("\n\n"),
    },
    { role: "user", content: `${passagesBlock(passages)}\n\nWrite the study notes for the passages above.` },
  ];
}

const ref = z.union([z.string(), z.number()]).transform(String);
const text = z.union([z.string(), z.number()]).transform(String);

export const rawNotes = z.object({
  title: text.nullish(),
  sections: z.array(z.object({
    heading: text.nullish(),
    points: z.array(z.union([text, z.object({ text, passage: ref.nullish() }).loose()])).max(40),
  }).loose()).max(40),
  terms: z.array(z.object({ term: text, definition: text, passage: ref.nullish() }).loose()).max(60).nullish(),
});

export type NotePoint = { text: string; chunkId: string };
export type StudyNotes = {
  title: string;
  sections: { heading: string; points: NotePoint[] }[];
  terms: { term: string; definition: string; chunkId: string }[];
  /** Points and terms dropped by the grounding checks. */
  dropped: number;
};

/** The cited passage, or (without a usable citation) the passage sharing most words with the text. */
function passageFor(raw: string | null | undefined, about: string, passages: Passage[]): Passage | null {
  if (raw) return resolvePassage(raw, passages);
  let best: Passage | null = null;
  let score = 0;
  for (const p of passages) {
    const sc = overlap(about, p.text);
    if (sc > score) { score = sc; best = p; }
  }
  return best;
}

/** A point or definition is kept only when its passage supports it, in the sentence it comes from. */
function grounded(claim: string, about: string, passage: Passage): boolean {
  return isGrounded(claim, passage.text) && groundedNearQuote(about, claim, passage.text, null) && !contradictsPassage(claim, passage.text);
}

/** Validates and cleans the model's study notes. Null when the reply isn't usable or too little survives. */
export function normaliseNotes(json: unknown, passages: Passage[], fallbackTitle: string): StudyNotes | null {
  const parsed = rawNotes.safeParse(json);
  if (!parsed.success) return null;
  let dropped = 0;
  const seen = new Set<string>();
  const sections: StudyNotes["sections"] = [];
  for (const s of parsed.data.sections) {
    if (sections.length >= NOTES_MAX_SECTIONS) break;
    const heading = clip(s.heading ?? "", NOTES_HEADING_MAX);
    const points: NotePoint[] = [];
    for (const raw of s.points) {
      const item = typeof raw === "string" ? { text: raw, passage: null } : raw;
      const t = clip(item.text, NOTES_POINT_MAX);
      if (t.length < 12) { dropped++; continue; }
      const key = normaliseFront(t);
      if (seen.has(key)) { dropped++; continue; }
      const passage = passageFor(item.passage, t, passages);
      if (!passage || !grounded(t, heading, passage)) { dropped++; continue; }
      if (points.length >= NOTES_MAX_POINTS) break;
      seen.add(key);
      points.push({ text: t, chunkId: passage.chunkId });
    }
    if (points.length) sections.push({ heading: heading || "Key points", points });
  }
  const terms: StudyNotes["terms"] = [];
  const seenTerms = new Set<string>();
  for (const t of parsed.data.terms ?? []) {
    if (terms.length >= NOTES_MAX_TERMS) break;
    const term = clip(t.term, NOTES_TERM_MAX);
    const definition = clip(t.definition, NOTES_DEFINITION_MAX);
    const key = normaliseFront(term);
    if (!term || definition.length < 8 || seenTerms.has(key)) { dropped++; continue; }
    const passage = passageFor(t.passage, `${term} ${definition}`, passages);
    // The term itself must be in the passage too: a definition alone can share enough common words.
    if (!passage || !containsLoose(passage.text, term) || !grounded(definition, term, passage)) { dropped++; continue; }
    seenTerms.add(key);
    terms.push({ term, definition, chunkId: passage.chunkId });
  }
  const pointCount = sections.reduce((n, s) => n + s.points.length, 0);
  if (pointCount < MIN_NOTE_POINTS) return null;
  return { title: clip(parsed.data.title ?? "", NOTES_TITLE_MAX) || clip(fallbackTitle, NOTES_TITLE_MAX) || "Study notes", sections, terms, dropped };
}
