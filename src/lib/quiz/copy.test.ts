import { describe, expect, it } from "vitest";
import { bestScoreCopy } from "./copy";

describe("bestScoreCopy", () => {
  it("shows the best score from one right answer up", () => {
    expect(bestScoreCopy({ score: 3, total: 9 }, 2)).toEqual({ text: "Best 3/9", label: "Best score 3 out of 9" });
    expect(bestScoreCopy({ score: 1, total: 5 }, 1).text).toBe("Best 1/5");
  });
  it("never says Best 0", () => {
    expect(bestScoreCopy({ score: 0, total: 9 }, 1)).toEqual({ text: "Tried once · have another go", label: "Tried once · have another go" });
    expect(bestScoreCopy({ score: 0, total: 9 }, 3).text).toBe("Tried 3 times · have another go");
    // A best without a counted try (shouldn't happen) still reads "once".
    expect(bestScoreCopy({ score: 0, total: 9 }, 0).text).toBe("Tried once · have another go");
  });
});
