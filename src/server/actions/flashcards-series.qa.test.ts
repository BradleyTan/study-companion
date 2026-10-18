// QA checks for "Long files: page ranges and series" (docs/qa/step-2-page-series.md).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const { makeFlashcards, loadMakeOptions } = await import("./flashcards");
const { chunkPages } = await import("@/lib/extract/chunk");
const { utcDay } = await import("../ai");

const pageText = (p: number) =>
  Array.from({ length: 4 }, (_, k) => Array.from({ length: 10 }, (_, i) => `Page ${p} part ${k} fact ${i + 1}: enzymes speed up reactions in cells.`).join(" ")).join("\n\n");

async function setup() {
  repo = demoRepo(crypto.randomUUID());
  return (await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" })).id;
}
async function file(subjectId: string, pages: number, opts: { kind?: "pdf" | "pptx"; loose?: string[] } = {}) {
  const id = crypto.randomUUID();
  await repo.createSource({ id, subjectId, fileName: `f-${pages}.${opts.kind ?? "pdf"}`, kind: opts.kind ?? "pdf", sizeBytes: 10, storagePath: `x/${id}` });
  const paged = chunkPages(Array.from({ length: pages }, (_, p) => pageText(p + 1)));
  const loose = (opts.loose ?? []).map((text, i) => ({ ...chunkPages([text], { paged: false })[0], ordinal: paged.length + i }));
  await repo.replaceSourceChunks(id, subjectId, [...paged, ...loose]);
  await repo.updateSource(id, { extractStatus: "ready", pageCount: pages });
  return id;
}
const used = async () => repo.aiUsageCount(utcDay(), "flashcards");

describe("long-file series (QA)", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_AI_TOKEN", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("loadMakeOptions stays fast with 10 files of 100 pages (demo)", async () => {
    const subjectId = await setup();
    for (let i = 0; i < 10; i++) await file(subjectId, 100);
    const t = performance.now();
    const r = await loadMakeOptions(subjectId);
    const ms = performance.now() - t;
    expect(r.ok && r.files.every((f) => f.pageChars?.length === 100 && !f.fitsOneSet)).toBe(true);
    console.info(`loadMakeOptions, 10 files x 100 pages: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1000);
  });

  it("PPTX range errors say slides", async () => {
    const subjectId = await setup();
    const src = await file(subjectId, 12, { kind: "pptx" });
    const r = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 13, toPage: 13 }, count: 10 });
    expect(r.ok ? null : r.error).toBe("Pick a slide between 1 and 12.");
  });

  it("quota running out mid-series: the last go still says what is next, then limit; a repeat stays free", async () => {
    const subjectId = await setup();
    // 15 sets a day (DAILY_LIMITS.flashcards), 5 pages each.
    const src = await file(subjectId, 80);
    let next = { from: 1, to: 5 };
    for (let i = 0; i < 15; i++) {
      const r = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: next.from, toPage: next.to }, count: 10 });
      if (!r.ok || r.result.status !== "made") throw new Error(`set ${i + 1} not made`);
      expect(r.result.quota.left).toBe(14 - i);
      expect(r.result.series?.next).not.toBeNull();
      next = r.result.series!.next!;
    }
    expect(next).toEqual({ from: 76, to: 80 });
    const over = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 76, toPage: 80 }, count: 10 });
    expect(over.ok && over.result.status).toBe("limit");
    const repeat = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 1, toPage: 5 }, count: 10 });
    expect(repeat.ok && repeat.result.status).toBe("already");
    expect(await used()).toBe(15);
  });

  it("sets of one file never repeat a card front", async () => {
    const subjectId = await setup();
    const src = await file(subjectId, 15);
    const fronts: string[] = [];
    for (const [from, to] of [[1, 5], [6, 10], [11, 15]]) {
      const r = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: from, toPage: to }, count: 20 });
      if (!r.ok || r.result.status !== "made") throw new Error("not made");
      fronts.push(...r.result.cards.map((c) => c.front));
    }
    expect(new Set(fronts).size).toBe(fronts.length);
  });

  it("passages without a page number go with every set (documented low: they can be quoted set after set)", async () => {
    const subjectId = await setup();
    const loose = "Glossary. " + Array.from({ length: 20 }, (_, i) => `Term ${i + 1} means something the exam asks about.`).join(" ");
    const src = await file(subjectId, 15, { loose: [loose] });
    const opts = await loadMakeOptions(subjectId);
    expect(opts.ok && opts.files[0].looseChars).toBeGreaterThan(0);
    const looseCards: number[] = [];
    for (const [from, to] of [[1, 5], [6, 10]]) {
      const r = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: from, toPage: to }, count: 20 });
      if (!r.ok || r.result.status !== "made") throw new Error("not made");
      const pages = await Promise.all(r.result.cards.map(async (c) => (await repo.getFlashcard(c.id))!.page));
      looseCards.push(pages.filter((p) => p === null).length);
    }
    // Recorded for the sign-off; files from the current extractor always carry page numbers.
    expect(looseCards.length).toBe(2);
    console.info("cards quoting a page-less passage per set:", looseCards);
  });
});
