import "server-only";
import { aiConfig, CLOUDFLARE_MODEL, GROQ_MODELS } from "@/lib/ai/providers";
import type { AiBudget } from "@/lib/ai/run";
import { APP_BUDGET, DAILY_LIMITS, quotaFrom, type AiKind, type Quota } from "@/lib/limits/ai";
import { localDayKey, safeTimeZone } from "@/lib/srs/due";
import type { Repo } from "./repo/types";

/** The app-wide budget runs on UTC days; student quotas on their own local day. */
export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

export async function studentDay(repo: Repo, now = new Date()): Promise<string> {
  return localDayKey(safeTimeZone((await repo.getProfile()).timezone), now);
}

export function appBudget(repo: Repo, now = new Date()): AiBudget {
  const day = utcDay(now);
  return {
    reserve: (provider, model) => repo.reserveAppBudget(day, model, APP_BUDGET[provider].requests, APP_BUDGET[provider].tokens),
    addTokens: (_provider, model, tokens) => repo.addAppTokens(day, model, tokens),
  };
}

/** Whether any configured provider still has app-wide budget today (always true without a key). */
export async function appAllowanceLeft(repo: Repo, kind: AiKind, now = new Date()): Promise<boolean> {
  const cfg = aiConfig();
  if (!cfg.groqKey) return true;
  const day = utcDay(now);
  if (await repo.appBudgetLeft(day, GROQ_MODELS[kind], APP_BUDGET.groq.requests, APP_BUDGET.groq.tokens)) return true;
  return cfg.cloudflare ? repo.appBudgetLeft(day, CLOUDFLARE_MODEL, APP_BUDGET.cloudflare.requests, APP_BUDGET.cloudflare.tokens) : false;
}

/** What the quota chip shows; always the server's numbers. */
export async function quotaFor(repo: Repo, kind: AiKind, now = new Date()): Promise<Quota> {
  const [used, left] = await Promise.all([repo.aiUsageCount(await studentDay(repo, now), kind), appAllowanceLeft(repo, kind, now)]);
  return quotaFrom(kind, used, left);
}

export { DAILY_LIMITS };
