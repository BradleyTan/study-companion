// Free-plan AI limits. docs/PLAN.md sections 3b and 4.

export type AiKind = "flashcards" | "mindmap";

/** Successful, non-cached generations per student per local day. */
export const DAILY_LIMITS: Record<AiKind, number> = { flashcards: 5, mindmap: 3 };

/**
 * App-wide daily budget per model, kept below the free plan's limits so students get a
 * friendly "try tomorrow" instead of errors. Groq free plan: ~1,000 requests and
 * 200,000 tokens a day per model. Cloudflare Workers AI: 10,000 neurons a day.
 */
export const APP_BUDGET: Record<"groq" | "cloudflare", { requests: number; tokens: number }> = {
  groq: { requests: 900, tokens: 180_000 },
  cloudflare: { requests: 300, tokens: 150_000 },
};

export type Quota = { kind: AiKind; used: number; limit: number; left: number; appAllowanceLeft: boolean };

export function quotaFrom(kind: AiKind, used: number, appAllowanceLeft: boolean): Quota {
  const limit = DAILY_LIMITS[kind];
  return { kind, used, limit, left: Math.max(0, limit - used), appAllowanceLeft };
}

/** Chip text, always a full sentence ("3 of 5 left today"). */
export function quotaLabel(q: Pick<Quota, "left" | "limit">): string {
  return `${q.left} of ${q.limit} left today`;
}
