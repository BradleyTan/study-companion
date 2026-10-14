import "server-only";
// Free AI providers, called only from the server with keys from the environment.
// Groq (OpenAI-compatible chat API, free plan) first; Cloudflare Workers AI (free plan)
// as the fallback. No paid service, no card attached: at a limit they answer 429.
import { isDemoMode } from "@/lib/env";
import type { ChatMessage } from "./types";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODELS = { flashcards: "openai/gpt-oss-20b", mindmap: "openai/gpt-oss-20b" } as const;
export const CLOUDFLARE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export type Provider = "groq" | "cloudflare";
export type CallResult = { text: string; inputTokens: number; outputTokens: number };

/** Free allowance used up (HTTP 429) or request too big for the per-minute limit. */
export class AiRateLimited extends Error {
  constructor(public retryAfterSec: number | null = null) { super("rate limited"); }
}
/** Network trouble, timeouts and server errors. */
export class AiUnavailable extends Error {}

export function aiConfig() {
  const groqKey = process.env.GROQ_API_KEY || null;
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID || null;
  const cfToken = process.env.CLOUDFLARE_AI_TOKEN || null;
  return { groqKey, cloudflare: cfAccount && cfToken ? { account: cfAccount, token: cfToken } : null };
}

/**
 * "live": a real provider is configured. "local": no key, but this is demo mode or not a
 * production build, so the deterministic fake generator stands in. "off": a production
 * build without a key: students get "AI isn't set up yet", never fake cards.
 */
export function aiMode(): "live" | "local" | "off" {
  if (aiConfig().groqKey) return "live";
  return isDemoMode() || process.env.NODE_ENV !== "production" ? "local" : "off";
}

type OpenAiReply = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

async function post(url: string, token: string, body: unknown, timeoutMs: number): Promise<OpenAiReply> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new AiUnavailable("network");
  }
  if (res.status === 429 || res.status === 413) {
    const ra = Number(res.headers.get("retry-after"));
    throw new AiRateLimited(Number.isFinite(ra) && ra > 0 ? ra : null);
  }
  if (!res.ok) {
    // Never log the request (it holds the student's notes); the status is enough.
    throw new AiUnavailable(`HTTP ${res.status}`);
  }
  try {
    return (await res.json()) as OpenAiReply;
  } catch {
    throw new AiUnavailable("bad json envelope");
  }
}

function toResult(r: OpenAiReply): CallResult {
  const text = r.choices?.[0]?.message?.content ?? "";
  if (!text) throw new AiUnavailable("empty reply");
  return { text, inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 };
}

export async function callGroq(key: string, model: string, messages: ChatMessage[], maxTokens: number): Promise<CallResult> {
  const reply = await post(GROQ_URL, key, {
    model,
    messages,
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_completion_tokens: maxTokens,
    reasoning_effort: "low", // gpt-oss: keeps hidden reasoning (and token use) small
  }, 60_000);
  return toResult(reply);
}

export async function callCloudflare(cfg: { account: string; token: string }, messages: ChatMessage[], maxTokens: number): Promise<CallResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.account)}/ai/v1/chat/completions`;
  const reply = await post(url, cfg.token, { model: CLOUDFLARE_MODEL, messages, max_tokens: maxTokens, temperature: 0.3 }, 60_000);
  return toResult(reply);
}

/** Pulls the JSON object out of a reply (models sometimes wrap it in prose or ``` fences). */
export function parseJsonReply(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
