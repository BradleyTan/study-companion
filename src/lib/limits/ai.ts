// Free-plan AI limits. docs/PLAN.md sections 3b and 4.

export type AiKind = "flashcards" | "mindmap";

/** Successful, non-cached generations per student per local day. */
export const DAILY_LIMITS: Record<AiKind, number> = { flashcards: 15, mindmap: 3 };

/**
 * Tries per student per local day, failed ones included. A failed generation gives the go
 * back, but it still used the shared allowance, so retries can't be endless.
 */
export const DAILY_ATTEMPTS: Record<AiKind, number> = { flashcards: 45, mindmap: 9 };

/**
 * App-wide daily budget per model, kept below the free plan's limits so students get a
 * friendly "try tomorrow" instead of errors. Groq free plan: ~1,000 requests and
 * 200,000 tokens a day per model. Cloudflare Workers AI: 10,000 neurons a day.
 */
export const APP_BUDGET: Record<"groq" | "cloudflare", { requests: number; tokens: number }> = {
  groq: { requests: 900, tokens: 180_000 },
  cloudflare: { requests: 300, tokens: 150_000 },
};

/**
 * Character budget per flashcard request. Groq's free plan allows ~8,000 tokens a minute per
 * model, counting the prompt and the reply, so a request stays around 4,000 input tokens.
 */
export const FLASHCARDS_MAX_CHARS = 14_000;
/** Below this a note or file is "a bit short" for flashcards (flashcards.md). */
export const MIN_SOURCE_CHARS = 200;

export type Quota = { kind: AiKind; used: number; limit: number; left: number; appAllowanceLeft: boolean };

export function quotaFrom(kind: AiKind, used: number, appAllowanceLeft: boolean): Quota {
  const limit = DAILY_LIMITS[kind];
  return { kind, used, limit, left: Math.max(0, limit - used), appAllowanceLeft };
}

/** Chip text, always a full sentence ("3 of 5 left today"). */
export function quotaLabel(q: Pick<Quota, "left" | "limit">): string {
  return `${q.left} of ${q.limit} left today`;
}
