// The two Step 2 generations, as tasks for runAiTask.
import { fakeFlashcards, fakeMindmap } from "./fake";
import { flashcardMessages, mindmapMessages } from "./prompts";
import { GROQ_MODELS } from "./providers";
import type { AiTask } from "./run";
import { normaliseFlashcardsWithStats, normaliseMindmap, type NormalisedCards } from "./schemas";
import type { MindmapGraph, Passage } from "./types";

// Flashcard budgets live in limits/ai.ts so the dialog can use them too (page-range hints).
export { FLASHCARDS_MAX_CHARS, MIN_SOURCE_CHARS } from "../limits/ai";
/** See FLASHCARDS_MAX_CHARS. */
export const MINDMAP_MAX_CHARS = 16_000;
export const MIN_MINDMAP_CHARS = 200;
export const CARD_COUNTS = [10, 15, 20] as const;
export type CardCount = (typeof CARD_COUNTS)[number];

export function flashcardTask(passages: Passage[], count: CardCount): AiTask<NormalisedCards> {
  return {
    groqModel: GROQ_MODELS.flashcards,
    messages: flashcardMessages(passages, count),
    maxTokens: 3500,
    // Allow a few more than asked; nothing beyond 25.
    parse: (json) => {
      // Never padded: cards that fail the quality or grounding checks are dropped, not replaced.
      const out = normaliseFlashcardsWithStats(json, passages, Math.min(count + 5, 25));
      return out && out.cards.length ? out : null;
    },
    fake: () => fakeFlashcards(passages, count),
  };
}

export function mindmapTask(passages: Passage[], subjectName: string): AiTask<MindmapGraph> {
  return {
    groqModel: GROQ_MODELS.mindmap,
    messages: mindmapMessages(passages, subjectName),
    maxTokens: 3000,
    parse: (json) => normaliseMindmap(json, passages, subjectName),
    fake: () => fakeMindmap(passages, subjectName),
  };
}

/** Gives passages the short refs (p1, p2, …) the model uses. */
export function toPassages(chunks: { id: string; text: string; page: number | null }[]): Passage[] {
  return chunks.map((c, i) => ({ chunkId: c.id, text: c.text, page: c.page, ref: `p${i + 1}` }));
}
