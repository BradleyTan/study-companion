import { describe, expect, it } from "vitest";
import { DAILY_LIMITS, quotaFrom, quotaLabel } from "./ai";

describe("AI quotas", () => {
  it("matches the plan: 5 flashcard sets and 3 mindmaps a day", () => {
    expect(DAILY_LIMITS).toEqual({ flashcards: 5, mindmap: 3 });
  });

  it("computes what's left and never goes below zero", () => {
    expect(quotaFrom("flashcards", 2, true)).toEqual({ kind: "flashcards", used: 2, limit: 5, left: 3, appAllowanceLeft: true });
    expect(quotaFrom("mindmap", 7, false).left).toBe(0);
  });

  it("labels the chip with a full sentence", () => {
    expect(quotaLabel(quotaFrom("flashcards", 2, true))).toBe("3 of 5 left today");
    expect(quotaLabel(quotaFrom("mindmap", 3, true))).toBe("0 of 3 left today");
  });
});
