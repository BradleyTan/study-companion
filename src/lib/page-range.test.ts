import { describe, expect, it } from "vitest";
import { FLASHCARDS_MAX_CHARS } from "./limits/ai";
import {
  coverageText, coveredCount, defaultRange, effectiveCoverage, firstUnmade, fitPageRange, fitsOneSet, isCovered, lastTextPage, madeSoFarText,
  mergeRanges, modeOf, nextRange, overlapOf, pageStats, pageStatsFromCounts, pagesSpoken, pagesText, pagesTitle, parseCoverage, quickPicks,
  rangeChars, rangeError, rangeHint, refit, seriesNext, sizedRange,
} from "./page-range";
import { MAX_CARD_PAGES } from "./validation";

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

  it("never goes past 50 pages (MAX_CARD_PAGES)", () => {
    expect(MAX_CARD_PAGES).toBe(50);
    const tiny = new Array(120).fill(10);
    expect(fitPageRange(tiny, 0, 1, B)).toEqual({ from: 1, to: 50 });
    expect(fitPageRange(tiny, 0, 100, B)).toEqual({ from: 100, to: 120 });
    expect(fitPageRange(new Array(120).fill(0), 0, 3, B)).toEqual({ from: 3, to: 52 });
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

describe("pageStatsFromCounts (security review S2-9)", () => {
  it("matches pageStats on the same passages", () => {
    const chunks = [{ page: 1, text: "abc" }, { page: 1, text: "de" }, { page: 3, text: "f" }, { page: null, text: "xyz" }];
    expect(pageStatsFromCounts([{ page: 1, chars: 5 }, { page: 3, chars: 1 }, { page: null, chars: 3 }], 4)).toEqual(pageStats(chunks, 4));
  });
  it("never allocates for an absurd page number or page count", () => {
    expect(pageStatsFromCounts([{ page: 2_000_000_000, chars: 7 }, { page: 1, chars: 1 }], null)).toEqual({ pageChars: [1], looseChars: 7, totalChars: 8 });
    expect(pageStatsFromCounts([{ page: 1.5, chars: 2 }], null).pageChars).toBeNull();
    expect(pageStatsFromCounts([{ page: 1, chars: 1 }], 1e9).pageChars).toHaveLength(10_000);
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
      text: "Cards will be spread across pages 1–6, a quick tour of the lot.",
    });
    expect(rangeHint(pages, 0, { from: 9, to: 9 })).toEqual({ kind: "long_page", text: "Page 9 has lots of text, so cards will be spread across it." });
    expect(rangeHint(pages, 0, { from: 9, to: 11 }).kind).toBe("sampled");
    expect(rangeHint(pages, 0, { from: 10, to: 11 })).toEqual({ kind: "thin", text: "These pages don't have much text. Add a page or two." });
    expect(rangeHint(null, 0, { from: 1, to: 20 }, "slide")).toEqual({ kind: "unknown", text: "Cards will be spread across the slides you pick." });
    expect(rangeHint(pages, 0, { from: 2, to: 2 }, "slide").text).toBe("Covers every passage on slide 2.");
  });

  it("validates the fields in order, with the spec's messages", () => {
    expect(rangeError("1", "6", 42)).toBeNull();
    expect(rangeError("0", "6", 42)).toEqual({ field: "from", text: "Pick a page between 1 and 42." });
    expect(rangeError("", "6", 42)).toEqual({ field: "from", text: "Pick a page between 1 and 42." });
    expect(rangeError("1.5", "6", 42)?.field).toBe("from");
    expect(rangeError("1", "43", 42)).toEqual({ field: "to", text: "Pick a page between 1 and 42." });
    expect(rangeError("9", "6", 42)).toEqual({ field: "to", text: "The last page comes before the first." });
    expect(rangeError("1", "51", 60)).toEqual({ field: "to", text: "Up to 50 pages at a time." });
    expect(rangeError("1", "50", 60)).toBeNull();
    expect(rangeError("11", "60", 60)).toBeNull();
    expect(rangeError("15", "34", 42)).toBeNull(); // overlapping an earlier set is fine
    expect(rangeError("1", "51", 60, "slide")?.text).toBe("Up to 50 slides at a time.");
  });
});

describe("defaultRange and sizedRange", () => {
  const pages = [5000, 5000, 5000, 5000, 0];
  it("defaults to the fit, or up to 20 pages without page counts", () => {
    expect(defaultRange(pages, 0, 5, 1)).toEqual({ from: 1, to: 2 });
    expect(defaultRange(null, 0, 42, 1)).toEqual({ from: 1, to: 20 });
    expect(defaultRange(null, 0, 8, 1)).toEqual({ from: 1, to: 8 });
  });
  it("clamps a sized range to the file", () => {
    expect(sizedRange(21, 20, 42)).toEqual({ from: 21, to: 40 });
    expect(sizedRange(41, 20, 42)).toEqual({ from: 41, to: 42 });
    expect(sizedRange(99, 20, 42)).toEqual({ from: 42, to: 42 });
  });
});

// 42 pages of 2,450 characters: 5 pages fit one set.
const file42 = new Array(42).fill(2450);

describe("seriesNext (Next follows the size the student chose)", () => {
  it("a best-fit set continues by the fit rule", () => {
    expect(seriesNext(file42, 0, { from: 1, to: 5 }, 42)).toEqual({ from: 6, to: 10 });
  });
  it("any other set keeps its size: 1–20 → 21–40 → 41–42", () => {
    expect(seriesNext(file42, 0, { from: 1, to: 20 }, 42)).toEqual({ from: 21, to: 40 });
    expect(seriesNext(file42, 0, { from: 21, to: 40 }, 42)).toEqual({ from: 41, to: 42 });
    expect(seriesNext(file42, 0, { from: 41, to: 42 }, 42)).toBeNull();
  });
  it("an overlapping set continues from its end, clamped: 15–34 → 35–42", () => {
    expect(seriesNext(file42, 0, { from: 15, to: 34 }, 42)).toEqual({ from: 35, to: 42 });
  });
  it("a shorter-than-fit set keeps its size too", () => {
    expect(seriesNext(file42, 0, { from: 1, to: 3 }, 42)).toEqual({ from: 4, to: 6 });
  });
  it("is null when no later page has text", () => {
    const trailing = [...new Array(10).fill(2450), 0, 0];
    expect(seriesNext(trailing, 0, { from: 1, to: 10 }, 12)).toBeNull();
    expect(seriesNext(trailing, 0, { from: 1, to: 8 }, 12)).toEqual({ from: 9, to: 12 });
  });
  it("without page counts keeps the size until the last page", () => {
    expect(seriesNext(null, 0, { from: 1, to: 20 }, 42)).toEqual({ from: 21, to: 40 });
    expect(seriesNext(null, 0, { from: 30, to: 42 }, 42)).toBeNull();
  });
});

describe("quick picks", () => {
  it("offers Best fit, 20 pages and 50 pages on a long file, with spoken names", () => {
    const picks = quickPicks(new Array(60).fill(2450), 0, 60, 7);
    expect(picks.map((p) => [p.label, p.range])).toEqual([
      ["Best fit", { from: 7, to: 11 }], ["20 pages", { from: 7, to: 26 }], ["50 pages", { from: 7, to: 56 }],
    ]);
    expect(picks.map((p) => p.name)).toEqual(["Best fit: pages 7 to 11", "20 pages: pages 7 to 26", "50 pages: pages 7 to 56"]);
  });
  it("says All N pages when the file has 50 or fewer", () => {
    const picks = quickPicks(file42, 0, 42, 1);
    expect(picks.map((p) => p.label)).toEqual(["Best fit", "20 pages", "All 42 pages"]);
    expect(picks[2]).toMatchObject({ name: "All 42 pages", range: { from: 1, to: 42 } });
  });
  it("hides a pick equal to another (a 15-page file: Best fit and All 15 pages)", () => {
    expect(quickPicks(new Array(15).fill(2450), 0, 15, 1).map((p) => p.label)).toEqual(["Best fit", "All 15 pages"]);
    expect(quickPicks(new Array(60).fill(2450), 0, 60, 45).map((p) => p.label)).toEqual(["Best fit", "50 pages"]);
  });
  it("shows no row when only one pick would remain, and no Best fit without page counts", () => {
    expect(quickPicks([100, 100], 0, 2, 1)).toEqual([]);
    expect(quickPicks(null, 0, 60, 1).map((p) => p.label)).toEqual(["20 pages", "50 pages"]);
  });
  it("says slides for PPTX", () => {
    expect(quickPicks(file42, 0, 42, 1, "slide").map((p) => p.label)).toEqual(["Best fit", "20 slides", "All 42 slides"]);
  });
});

describe("refit and modeOf", () => {
  it("re-fits by the pressed pick when the first page changes", () => {
    expect(refit({ kind: "fit" }, file42, 0, 42, 15)).toEqual({ from: 15, to: 19 });
    expect(refit({ kind: "size", size: 20 }, file42, 0, 42, 15)).toEqual({ from: 15, to: 34 });
    expect(refit({ kind: "size", size: 50 }, file42, 0, 42, 15)).toEqual({ from: 15, to: 42 });
    expect(refit({ kind: "size", size: 7 }, null, 0, 42, 40)).toEqual({ from: 40, to: 42 });
  });
  it("a range equal to the fit is the fit, any other keeps its size", () => {
    expect(modeOf(file42, 0, { from: 6, to: 10 })).toEqual({ kind: "fit" });
    expect(modeOf(file42, 0, { from: 21, to: 40 })).toEqual({ kind: "size", size: 20 });
    expect(modeOf(null, 0, { from: 1, to: 20 })).toEqual({ kind: "size", size: 20 });
  });
});

describe("pages covered (union of ranges made)", () => {
  it("merges overlapping and touching ranges once", () => {
    expect(mergeRanges([[1, 20]], { from: 15, to: 34 })).toEqual([[1, 34]]);
    expect(mergeRanges([[1, 5]], { from: 6, to: 10 })).toEqual([[1, 10]]);
    expect(mergeRanges([[30, 40], [1, 5]], { from: 3, to: 8 })).toEqual([[1, 8], [30, 40]]);
    expect(coveredCount([[1, 8], [30, 40]])).toBe(19);
  });
  it("progress text: one run from page 1, else a count, sampled and all done", () => {
    expect(coverageText([[1, 34]], 42, "page", false)).toBe("Pages 1–34 of 42 done");
    expect(coverageText([[1, 6], [23, 42]], 42, "page", false)).toBe("26 of 42 pages done");
    expect(coverageText([[5, 30]], 42, "page", true)).toBe("26 of 42 pages done (some passages sampled)");
    expect(coverageText([[1, 20]], 42, "slide", true)).toBe("Slides 1–20 of 42 done (some passages sampled)");
    expect(coverageText([[1, 42]], 42, "page", true)).toBe("All 42 pages done. Nice work!");
  });
  it("counts pages after the last page with text as done once it is covered", () => {
    const pages = [...new Array(10).fill(2450), 0, 0];
    expect(lastTextPage(pages, 12)).toBe(10);
    expect(effectiveCoverage([[1, 10]], pages, 12)).toEqual([[1, 12]]);
    expect(effectiveCoverage([[1, 9]], pages, 12)).toEqual([[1, 9]]);
    expect(effectiveCoverage([[1, 99]], null, 12)).toEqual([[1, 12]]);
  });
  it("hint lines: made so far, and overlap with pages already made", () => {
    expect(madeSoFarText([], 42, "page")).toBeNull();
    expect(madeSoFarText([[1, 20]], 42, "page")).toBe("You've made cards from pages 1–20 so far.");
    expect(madeSoFarText([[1, 6], [23, 42]], 42, "page")).toBe("You've made cards from 26 of 42 pages so far.");
    expect(overlapOf([[1, 20]], { from: 21, to: 40 })).toBe("none");
    expect(overlapOf([[1, 20]], { from: 15, to: 34 })).toBe("some");
    expect(overlapOf([[1, 20]], { from: 3, to: 8 })).toBe("all");
  });
  it("default start: the first page not made that has text", () => {
    expect(firstUnmade([], file42, 42)).toBeNull();
    expect(firstUnmade([[1, 20]], file42, 42)).toBe(21);
    expect(firstUnmade([[2, 20]], file42, 42)).toBe(1);
    expect(firstUnmade([[1, 10]], [...new Array(10).fill(2450), 0, 0], 12)).toBeNull();
    expect(firstUnmade([[1, 42]], file42, 42)).toBeNull();
    expect(firstUnmade([[1, 20]], null, 42)).toBe(21);
  });
  it("parses stored coverage defensively", () => {
    expect(parseCoverage(null)).toEqual([]);
    expect(parseCoverage("not json")).toEqual([]);
    expect(parseCoverage('{"a":1}')).toEqual([]);
    expect(parseCoverage("[[15,34],[1,20],[\"x\",2],[5],[0,3],[9,2]]")).toEqual([[1, 34]]);
  });
});

describe("quiz budget and wording (quiz-builder.md: same pattern, own budget)", () => {
  const pages = [4000, 4000, 4000, 4000, 4000];
  it("fits ranges to the budget passed in", () => {
    expect(fitPageRange(pages, 0, 1, 12_000).to).toBe(3);
    expect(fitPageRange(pages, 0, 1).to).toBe(3); // 14,000: still 3 pages of 4,000
    expect(defaultRange(pages, 0, 5, 1, 8_000)).toEqual({ from: 1, to: 2 });
    expect(quickPicks(pages, 0, 5, 1, "page", 8_000)[0]).toMatchObject({ id: "fit", range: { from: 1, to: 2 } });
    expect(modeOf(pages, 0, { from: 1, to: 2 }, 8_000)).toEqual({ kind: "fit" });
    expect(refit({ kind: "fit" }, pages, 0, 5, 2, 8_000)).toEqual({ from: 2, to: 3 });
  });
  it("says questions instead of cards", () => {
    expect(rangeHint(pages, 0, { from: 1, to: 5 }, "page", 12_000, "Questions").text).toBe("Questions will be spread across pages 1–5, a quick tour of the lot.");
    expect(rangeHint(null, 0, { from: 1, to: 5 }, "slide", 12_000, "Questions").text).toBe("Questions will be spread across the slides you pick.");
    expect(rangeHint(pages, 0, { from: 1, to: 2 }, "page", 12_000, "Questions").text).toBe("Covers every passage on pages 1–2.");
  });
});
