import "server-only";
import { AiRateLimited, aiConfig, callCloudflare, callGroq, CLOUDFLARE_MODEL, parseJsonReply, type CallResult, type Provider } from "./providers";
import type { ChatMessage } from "./types";

/** App-wide budget hooks (implemented on top of the database by the caller). */
export type AiBudget = {
  /** Reserve one request for this model today; false when the app-wide budget is used up. */
  reserve(provider: Provider, model: string): Promise<boolean>;
  addTokens(provider: Provider, model: string, tokens: number): Promise<void>;
};

export type AiTask<T> = {
  groqModel: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Validates the parsed JSON; null = unusable reply. */
  parse: (json: unknown) => T | null;
  /** Deterministic local output (JSON, same shape as the model's), used without an AI key. */
  fake: () => unknown;
};

export type AiOutcome<T> =
  /** `raw` is the parsed reply before validation: what gets cached (and re-validated on reuse). */
  | { ok: true; value: T; raw: unknown; model: string; inputTokens: number; outputTokens: number }
  | { ok: false; reason: "allowance" | "failed" };

/**
 * Runs one generation: Groq, then Cloudflare when Groq is rate limited, down or returns
 * something unusable. Without GROQ_API_KEY it uses the local fake generator.
 * "allowance" = every provider tried was out of free allowance; "failed" = anything else.
 */
export async function runAiTask<T>(task: AiTask<T>, budget: AiBudget): Promise<AiOutcome<T>> {
  const cfg = aiConfig();
  if (!cfg.groqKey) {
    const raw = task.fake();
    const value = task.parse(raw);
    return value ? { ok: true, value, raw, model: "local", inputTokens: 0, outputTokens: 0 } : { ok: false, reason: "failed" };
  }

  const attempts: { provider: Provider; model: string; call: () => Promise<CallResult> }[] = [
    { provider: "groq", model: task.groqModel, call: () => callGroq(cfg.groqKey!, task.groqModel, task.messages, task.maxTokens) },
  ];
  if (cfg.cloudflare) {
    const cf = cfg.cloudflare;
    attempts.push({ provider: "cloudflare", model: CLOUDFLARE_MODEL, call: () => callCloudflare(cf, task.messages, task.maxTokens) });
  }

  let allOutOfAllowance = true;
  for (const a of attempts) {
    if (!(await budget.reserve(a.provider, a.model))) continue; // app-wide budget used up for this model
    try {
      const r = await a.call();
      await budget.addTokens(a.provider, a.model, r.inputTokens + r.outputTokens);
      const raw = parseJsonReply(r.text);
      const value = task.parse(raw);
      if (value) return { ok: true, value, raw, model: a.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
      allOutOfAllowance = false; // answered, but with something unusable
    } catch (e) {
      if (!(e instanceof AiRateLimited)) allOutOfAllowance = false;
    }
  }
  return { ok: false, reason: allOutOfAllowance ? "allowance" : "failed" };
}
