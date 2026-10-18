// Free-plan AI limits. docs/PLAN.md sections 3b and 4.

export type AiKind = "flashcards" | "mindmap" | "quiz" | "chat";

/** Successful, non-cached generations per student per local day. */
export const DAILY_LIMITS: Record<AiKind, number> = { flashcards: 15, mindmap: 3, quiz: 3, chat: 20 };

/**
 * Tries per student per local day, failed ones included. A failed generation gives the go
 * back, but it still used the shared allowance, so retries can't be endless.
 */
export const DAILY_ATTEMPTS: Record<AiKind, number> = { flashcards: 45, mindmap: 9, quiz: 9, chat: 60 };

/**
 * App-wide daily budget per model, kept below the free plan's limits so students get a
 * friendly "try tomorrow" instead of errors. Groq free plan: ~1,000 requests and
 * 200,000 tokens a day per model. Cloudflare Workers AI: 10,000 neurons a day.
 * Each model is counted on its own (`ai_app_usage` is keyed by day and model), so
 * `openai/gpt-oss-120b` (quizzes, chat) has its own budget beside `openai/gpt-oss-20b`
 * (flashcards, mindmaps); see `appBudgetFor`.
 */
export const APP_BUDGET: Record<"groq" | "cloudflare", { requests: number; tokens: number }> = {
  groq: { requests: 900, tokens: 180_000 },
  cloudflare: { requests: 300, tokens: 150_000 },
};

/**
 * Per-model overrides of APP_BUDGET. Groq's free plan gives gpt-oss-120b the same daily
 * allowance as gpt-oss-20b (1,000 requests, 200,000 tokens), counted separately.
 */
export const MODEL_BUDGET: Record<string, { requests: number; tokens: number }> = {
  "openai/gpt-oss-20b": { requests: 900, tokens: 180_000 },
  "openai/gpt-oss-120b": { requests: 900, tokens: 180_000 },
};

/** The app-wide daily budget for one model of a provider. */
export function appBudgetFor(provider: "groq" | "cloudflare", model: string): { requests: number; tokens: number } {
  return (provider === "groq" ? MODEL_BUDGET[model] : undefined) ?? APP_BUDGET[provider];
}

/**
 * Character budget per flashcard request. Groq's free plan allows ~8,000 tokens a minute per
 * model, counting the prompt and the reply, so a request stays around 4,000 input tokens.
 */
export const FLASHCARDS_MAX_CHARS = 14_000;
/** Below this a note or file is "a bit short" for flashcards (flashcards.md). */
export const MIN_SOURCE_CHARS = 200;

/**
 * Character budget per quiz request (quiz-builder.md suggests 14,000, tunable). gpt-oss-120b's
 * free plan allows ~8,000 tokens a minute, prompt and reply together, and a quiz reply is
 * longer than a card set's (four options and an explanation per question, up to 4,000 tokens),
 * so the passages stay around 3,000 tokens.
 */
export const QUIZ_MAX_CHARS = 12_000;

export type Quota = { kind: AiKind; used: number; limit: number; left: number; appAllowanceLeft: boolean };

export function quotaFrom(kind: AiKind, used: number, appAllowanceLeft: boolean): Quota {
  const limit = DAILY_LIMITS[kind];
  return { kind, used, limit, left: Math.max(0, limit - used), appAllowanceLeft };
}

/**
 * Ask your notes (chat.md): passages sent with one question. Six passages of up to 1,200
 * characters each (CHUNK_MAX) plus the last 4 messages stay around 2,500 tokens, so a question,
 * its rules and a reply of up to 1,200 tokens fit gpt-oss-120b's 8,000 tokens a minute.
 */
export const CHAT_MAX_CHARS = 7_200;

/** Chip text, always a full sentence ("3 of 5 left today"). */
export function quotaLabel(q: Pick<Quota, "left" | "limit">): string {
  return `${q.left} of ${q.limit} left today`;
}
