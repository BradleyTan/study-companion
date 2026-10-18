// Starter suggestions for an empty chat (chat.md "Data the screen needs"): built from names the
// student already has (weak topics, note and file titles), never by AI, and never questions the
// notes can't answer.
import { clip, collapse } from "../ai/text";

export const QUIZ_ME = "Quiz me with one question";
const MAX = 4;

/** "Quiz me with one question" in any case, with or without a full stop. */
export function isQuizMe(question: string): boolean {
  return collapse(question).toLowerCase().replace(/[.!?]+$/, "") === QUIZ_ME.toLowerCase();
}

/** "Lecture 3.pdf" → "Lecture 3". */
export function titleOf(name: string): string {
  return collapse(name.replace(/\.(?:pdf|pptx)$/i, "").replace(/[_]+/g, " "));
}

export function starterSuggestions(input: { weakTopics: string[]; titles: string[] }): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (out.length < MAX - 1 && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  };
  for (const t of input.weakTopics.slice(0, 2)) if (/[\p{L}\p{N}]/u.test(t)) add(`Explain ${clip(t, 40)} simply`);
  for (const t of input.titles) if (/[\p{L}\p{N}]/u.test(titleOf(t))) add(`What are the key points of ${clip(titleOf(t), 80)}?`);
  out.push(QUIZ_ME);
  return out;
}
