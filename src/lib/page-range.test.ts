import { describe, expect, it } from "vitest";
import { FLASHCARDS_MAX_CHARS } from "./limits/ai";
import {
  defaultRange, fitPageRange, fitsOneSet, isCovered, nextRange, pageStats, pagesSpoken, pagesText, pagesTitle,
  rangeChars, rangeError, rangeHint, resumeFrom,
} from "./page-range";

const B = FLASHCARDS_MAX_CHARS;

describe("fitPageRange", () => {
  it("adds pages while they fit the budget", () => {
    expect(fitPageRange([4000, 4000, 4000, 4000, 4000], 0, 1, B)).toEqual({ from: 1, to: 3 });
    expect(fitPageRange([4000, 4000, 4000, 4000, 4000], 0, 4, B)).toEqual({ from: 4, to: 5 });
  });

  it("fills the budget exactly (≤, not <)", () => {
    expect(fitPageRange([7000, 7000, 1], 0, 1, B)).toEqual({ from: 1, to: 2 });
  });

  it("counts loose characters against every range", () => {
    expect(fitPageRange([4000, 4000, 4000], 3000, 1, B)).toEqual({ from: 1, to: 2 });
    expect(fitPageRange([4000, 4000, 4000], 3000, 2, B)).toEqual({ from: 2, to: 3 });
  });

  it("is always at least one page, even when that page alone is over the budget", () => {
    expect(fitPageRange([20_000, 100], 0, 1, B)).toEqual({ from: 1, to: 1 });
    expect(fitPageRange([100], 50_000, 1, B)).toEqual({ from: 1, to: 1 });
  });

  it("swallows pages with no text, even after an over-budget page", () => {
    expect(fitPageRange([5000, 0, 0, 5000, 0, 9000], 0, 1, B)).toEqual({ from: 1, to: 5 });
    expect(fitPageRange([20_000, 0, 0, 10], 0, 1, B)).toEqual({ from: 1, to: 3 });
  });

  it("never goes past 20 pages", () => {
    const tiny = new Array(50).fill(10);
    expect(fitPageRange(tiny, 0, 1, B)).toEqual({ from: 1, to: 20 });
    expect(fitPageRange(tiny, 0, 40, B)).toEqual({ from: 40, to: 50 });
    expect(fitPageRange(new Array(50).fill(0), 0, 3, B)).toEqual({ from: 3, to: 22 });
  });

  it("stops at the last page and clamps a bad start", () => {
    expect(fitPageRange([100, 100], 0, 1, B)).toEqual({ from: 1, to: 2 });
    expect(fitPageRange([100, 100], 0, 9, B)).toEqual({ from: 2, to: 2 });
    expect(fitPageRange([100, 100], 0, 0, B)).toEqual({ from: 1, to: 2 });
    expect(fitPageRange([], 0, 1, B)).toEqual({ from: 1, to: 1 });
  });

  it("uses the flashcard budget by default", () => {
    expect(fitPageRange([B, 1], 0, 1)).toEqual({ from: 1, to: 1 });
  });
});

describe("rangeChars, isCovered, fitsOneSet", () => {
  it("sums the range plus loose characters", () => {
    expect(rangeChars([1, 2, 4, 8], 100, { from: 2, to: 3 })).toBe(106);
    expect(rangeChars([1, 2], 0, { from: 1, to: 9 })).toBe(3);
  });
  it("a range is covered when it fits the budget", () => {
    expect(isCovered([7000, 7000], 0, { from: 1, to: 2 }, B)).toBe(true);
    expect(isCovered([7000, 7001], 0, { from: 1, to: 2 }, B)).toBe(false);
  });
  it("a file fits one set up to the budget", () => {
    expect(fitsOneSet(B)).toBe(true);
    expect(fitsOneSet(B + 1)).toBe(false);
  });
});

describe("nextRange", () => {
  const pages = [5000, 5000, 5000, 5000, 5000, 0, 0];
  it("fits from the page after", () => {
    expect(nextRange(pages, 0, 2, B)).toEqual({ from: 3, to: 4 });
    expect(nextRange(pages, 0, 4, B)).toEqual({ from: 5, to: 7 });
  });
  it("is null at the end, or when only empty pages are left", () => {
    expect(nextRange(pages, 0, 7, B)).toBeNull();
    expect(nextRange(pages, 0, 5, B)).toBeNull();
  });
  it("a whole long file is covered by a series of next ranges, every page once", () => {
    const file = Array.from({ length: 42 }, (_, i) => (i % 7 === 6 ? 0 : 1500 + ((i * 937) % 2500)));
    const seen: number[] = [];
    let r: { from: number; to: number } | null = fitPageRange(file, 300, 1, B);
    while (r) {
      expect(isCovered(file, 300, r, B)).toBe(true);
      for (let p = r.from; p <= r.to; p++) seen.push(p);
      r = nextRange(file, 300, r.to, B);
    }
    expect(seen[0]).toBe(1);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.at(-1)).toBeGreaterThanOrEqual(41); // page 42 has no text
  });
});

describe("pageStats", () => {
  it("counts characters per page and loose characters", () => {
    const s = pageStats([{ page: 1, text: "abc" }, { page: 1, text: "de" }, { page: 3, text: "f" }, { page: null, text: "xyz" }], 4);
    expect(s).toEqual({ pageChars: [5, 0, 1, 0], looseChars: 3, totalChars: 9 });
  });
  it("extends past a wrong page count", () => {
    expect(pageStats([{ page: 3, text: "ab" }], 1).pageChars).toEqual([0, 0, 2]);
  });
  it("has no page counts when no passage has a page", () => {
    expect(pageStats([{ page: null, text: "abc" }], 10)).toEqual({ pageChars: null, looseChars: 3, totalChars: 3 });
    expect(pageStats([], null).pageChars).toBeNull();
  });
});

describe("copy", () => {
  it("formats ranges with an en dash and spoken names with 'to'", () => {
    expect(pagesText({ from: 7, to: 12 })).toBe("pages 7–12");
    expect(pagesText({ from: 7, to: 7 })).toBe("page 7");
    expect(pagesText({ from: 1, to: 6 }, "slide")).toBe("slides 1–6");
    expect(pagesSpoken({ from: 7, to: 12 })).toBe("pages 7 to 12");
    expect(pagesTitle({ from: 7, to: 12 }, "slide")).toBe("Slides 7–12");
  });

  it("hints covered, sampled (with snap), long page, thin and unknown", () => {
    const pages = [4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 20_000, 50, 50];
    expect(rangeHint(pages, 0, { from: 1, to: 3 })).toEqual({ kind: "covered", text: "Covers every passage on pages 1–3." });
    expect(rangeHint(pages, 0, { from: 1, to: 6 })).toEqual({
      kind: "sampled", snap: { from: 1, to: 3 },
      text: "Long range: cards will come from across pages 1–6. Pick fewer pages to cover every passage.",
    });
    expect(rangeHint(pages, 0, { from: 9, to: 9 })).toEqual({ kind: "long_page", text: "Page 9 is long: cards will come from across it." });
    expect(rangeHint(pages, 0, { from: 9, to: 11 }).kind).toBe("sampled");
    expect(rangeHint(pages, 0, { from: 10, to: 11 })).toEqual({ kind: "thin", text: "These pages don't have much text. Add a page or two." });
    expect(rangeHint(null, 0, { from: 1, to: 20 }, "slide")).toEqual({ kind: "unknown", text: "Cards will come from across the slides you pick." });
    expect(rangeHint(pages, 0, { from: 2, to: 2 }, "slide").text).toBe("Covers every passage on slide 2.");
  });

  it("validates the fields in order, with the spec's messages", () => {
    expect(rangeError("1", "6", 42)).toBeNull();
    expect(rangeError("0", "6", 42)).toEqual({ field: "from", text: "Pick a page between 1 and 42." });
    expect(rangeError("", "6", 42)).toEqual({ field: "from", text: "Pick a page between 1 and 42." });
    expect(rangeError("1.5", "6", 42)?.field).toBe("from");
    expect(rangeError("1", "43", 42)).toEqual({ field: "to", text: "Pick a page between 1 and 42." });
    expect(rangeError("9", "6", 42)).toEqual({ field: "to", text: "The last page comes before the first." });
    expect(rangeError("1", "21", 42)).toEqual({ field: "to", text: "Up to 20 pages at a time." });
    expect(rangeError("1", "20", 42)).toBeNull();
    expect(rangeError("1", "21", 42, "slide")?.text).toBe("Up to 20 slides at a time.");
  });
});

describe("resumeFrom and defaultRange", () => {
  const pages = [5000, 5000, 5000, 5000, 0];
  it("starts after the furthest page made, else nothing to resume", () => {
    expect(resumeFrom(pages, 0, 5, 2)).toBe(3);
    expect(resumeFrom(pages, 0, 5, null)).toBeNull();
    expect(resumeFrom(pages, 0, 5, 4)).toBeNull(); // only an empty page left
    expect(resumeFrom(pages, 0, 5, 5)).toBeNull();
    expect(resumeFrom(pages, 0, 5, 0)).toBeNull();
    expect(resumeFrom(pages, 0, 5, Number.NaN)).toBeNull();
    expect(resumeFrom(null, 0, 30, 20)).toBe(21);
  });
  it("defaults to the fit, or up to 20 pages without page counts", () => {
    expect(defaultRange(pages, 0, 5, 1)).toEqual({ from: 1, to: 2 });
    expect(defaultRange(null, 0, 42, 1)).toEqual({ from: 1, to: 20 });
    expect(defaultRange(null, 0, 8, 1)).toEqual({ from: 1, to: 8 });
  });
});
