import { describe, expect, it } from "vitest";
import { DAILY_ATTEMPTS, DAILY_LIMITS, quotaFrom, quotaLabel } from "./ai";

describe("AI quotas", () => {
  it("matches the plan: 15 flashcard sets and 3 mindmaps a day, tries capped at 3x", () => {
    expect(DAILY_LIMITS).toEqual({ flashcards: 15, mindmap: 3 });
    expect(DAILY_ATTEMPTS).toEqual({ flashcards: 45, mindmap: 9 });
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
