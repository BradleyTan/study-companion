import { describe, expect, it } from "vitest";
import { APP_BUDGET, appBudgetFor, DAILY_ATTEMPTS, DAILY_LIMITS, quotaFrom, quotaLabel } from "./ai";

describe("AI quotas", () => {
  it("matches the plan: 15 flashcard sets, 3 mindmaps, 3 quizzes, 20 chat questions and 5 sets of study notes a day, tries capped at 3x", () => {
    expect(DAILY_LIMITS).toEqual({ flashcards: 15, mindmap: 3, quiz: 3, chat: 20, notes: 5 });
    expect(DAILY_ATTEMPTS).toEqual({ flashcards: 45, mindmap: 9, quiz: 9, chat: 60, notes: 15 });
  });

  it("gives each Groq model its own app-wide budget, under the free plan's daily limit", () => {
    expect(appBudgetFor("groq", "openai/gpt-oss-120b")).toEqual({ requests: 900, tokens: 180_000 });
    expect(appBudgetFor("groq", "openai/gpt-oss-20b")).toEqual({ requests: 900, tokens: 180_000 });
    expect(appBudgetFor("groq", "some/other-model")).toEqual(APP_BUDGET.groq);
    expect(appBudgetFor("cloudflare", "@cf/meta/llama-3.1-8b-instruct-fast")).toEqual(APP_BUDGET.cloudflare);
  });

  it("computes what's left and never goes below zero", () => {
    expect(quotaFrom("flashcards", 2, true)).toEqual({ kind: "flashcards", used: 2, limit: 15, left: 13, appAllowanceLeft: true });
    expect(quotaFrom("mindmap", 7, false).left).toBe(0);
  });

  it("labels the chip with a full sentence", () => {
    expect(quotaLabel(quotaFrom("flashcards", 2, true))).toBe("13 of 15 left today");
    expect(quotaLabel(quotaFrom("mindmap", 3, true))).toBe("0 of 3 left today");
  });
});
