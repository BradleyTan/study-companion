import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const { makeFlashcards, deleteCard, loadMakeOptions } = await import("./flashcards");
const { chunkPages } = await import("@/lib/extract/chunk");
const { makeMindmap } = await import("./mindmap");

const text = (topic: string) =>
  `${topic} is studied in this course. ` + Array.from({ length: 12 }, (_, i) => `Fact ${i + 1} about ${topic} is worth remembering for the exam.`).join(" ");

async function subjectWithNote(topic = "Osmosis") {
  repo = demoRepo(crypto.randomUUID());
  const subject = await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" });
  const noteId = await addNote(subject.id, topic);
  return { subjectId: subject.id, noteId };
}
async function addNote(subjectId: string, topic: string) {
  const { id } = await repo.createNote(subjectId);
  await repo.updateNote(id, { title: topic, contentJson: {}, contentText: text(topic) });
  return id;
}
const used = async () => (await repo.aiUsageCount((await import("../ai")).utcDay(), "flashcards"));

describe("flashcard generation quota (QA)", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_AI_TOKEN", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("counts a success once, and the same text again is free", async () => {
    const { subjectId, noteId } = await subjectWithNote();
    const first = await makeFlashcards({ subjectId, source: { type: "note", id: noteId }, count: 10 });
    expect(first.ok && first.result.status).toBe("made");
    expect(await used()).toBe(1);
    const again = await makeFlashcards({ subjectId, source: { type: "note", id: noteId }, count: 10 });
    expect(again.ok && again.result.status).toBe("already");
    // Delete the cards: the cached output brings them back without using a go.
    if (first.ok && first.result.status === "made") for (const c of first.result.cards) await deleteCard(c.id);
    const cached = await makeFlashcards({ subjectId, source: { type: "note", id: noteId }, count: 10 });
    expect(cached.ok && cached.result.status === "made" && cached.result.cached).toBe(true);
    expect(await used()).toBe(1);
  });

  it("gives the go back when the AI fails", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    const { subjectId, noteId } = await subjectWithNote();
    const r = await makeFlashcards({ subjectId, source: { type: "note", id: noteId }, count: 10 });
    expect(r.ok && r.result.status).toBe("failed");
    expect(await used()).toBe(0);
  });

  it("stops at 5 a day", async () => {
    const { subjectId } = await subjectWithNote();
    const statuses: string[] = [];
    for (let i = 0; i < 6; i++) {
      const noteId = await addNote(subjectId, `Topic ${i}`);
      const r = await makeFlashcards({ subjectId, source: { type: "note", id: noteId }, count: 10 });
      statuses.push(r.ok ? r.result.status : r.error);
    }
    expect(statuses).toEqual(["made", "made", "made", "made", "made", "limit"]);
    expect(await used()).toBe(5);
  });

  it("in production without an AI key says so, makes nothing and uses no go", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { subjectId, noteId } = await subjectWithNote();
    const r = await makeFlashcards({ subjectId, source: { type: "note", id: noteId }, count: 10 });
    expect(r.ok && r.result.status).toBe("not_configured");
    const m = await makeMindmap({ subjectId, selection: { all: true, noteIds: [], sourceIds: [] }, force: false });
    expect(m.ok && m.result.status).toBe("not_configured");
    expect(await repo.listFlashcards({ subjectId })).toHaveLength(0);
    expect(await repo.getMindmap(subjectId)).toBeNull();
    expect(await used()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("won't make cards from another student's note", async () => {
    const { noteId } = await subjectWithNote();
    const other = await subjectWithNote("Mitosis"); // repo is now the second student's
    const r = await makeFlashcards({ subjectId: other.subjectId, source: { type: "note", id: noteId }, count: 10 });
    expect(r.ok).toBe(false);
  });

  it("empty notes and a single sentence are too short and cost nothing", async () => {
    const { subjectId } = await subjectWithNote();
    const { id: empty } = await repo.createNote(subjectId);
    const one = await repo.createNote(subjectId);
    await repo.updateNote(one.id, { title: "One", contentJson: {}, contentText: "Osmosis moves water." });
    for (const id of [empty, one.id]) {
      const r = await makeFlashcards({ subjectId, source: { type: "note", id }, count: 10 });
      expect(r.ok && r.result.status).toBe("too_short");
    }
    const m = await makeMindmap({ subjectId, selection: { all: false, noteIds: [one.id], sourceIds: [] }, force: false });
    expect(m.ok && m.result.status).toBe("too_short");
    expect(await used()).toBe(0);
  });

  it("non-English notes make cards whose quotes are real sentences from the note", async () => {
    repo = demoRepo(crypto.randomUUID());
    const subject = await repo.createSubject({ name: "Deutsch", colour: "mint", emoji: "🇩🇪" });
    const { id } = await repo.createNote(subject.id);
    const text = Array.from({ length: 8 }, (_, i) => `Die Mitochondrien Nummer ${i + 1} erzeugen Energie für die Zelle durch Zellatmung. 細胞は生命の基本単位です。`).join(" ");
    await repo.updateNote(id, { title: "Zellbiologie", contentJson: {}, contentText: text });
    const r = await makeFlashcards({ subjectId: subject.id, source: { type: "note", id }, count: 10 });
    expect(r.ok && r.result.status).toBe("made");
    if (r.ok && r.result.status === "made") {
      for (const c of r.result.cards) expect(`Zellbiologie ${text}`.replace(/\s+/g, " ")).toContain(c.quote!.replace(/\s+/g, " "));
    }
  });

  it("refuses page ranges over 20 pages and files that aren't ready", async () => {
    const { subjectId } = await subjectWithNote();
    const big = await makeFlashcards({ subjectId, source: { type: "file", id: crypto.randomUUID(), fromPage: 1, toPage: 21 }, count: 10 });
    expect(big.ok).toBe(false);
    const backwards = await makeFlashcards({ subjectId, source: { type: "file", id: crypto.randomUUID(), fromPage: 5, toPage: 2 }, count: 10 });
    expect(backwards.ok).toBe(false);
    const src = await repo.createSource({ id: crypto.randomUUID(), subjectId, fileName: "scan.pdf", kind: "pdf", sizeBytes: 10, storagePath: "x/scan.pdf" });
    await repo.updateSource(src.id, { extractStatus: "no_text", pageCount: 200 });
    const scanned = await makeFlashcards({ subjectId, source: { type: "file", id: src.id, fromPage: 1, toPage: 20 }, count: 10 });
    expect(scanned.ok).toBe(false);
    expect(await used()).toBe(0);
  });

  it("the same text in a second subject makes cards there (from the cache, free)", async () => {
    const { subjectId, noteId } = await subjectWithNote();
    expect((await makeFlashcards({ subjectId, source: { type: "note", id: noteId }, count: 10 })).ok).toBe(true);
    const other = await repo.createSubject({ name: "Chem", colour: "sky", emoji: "⚗️" });
    const copy = await addNote(other.id, "Osmosis");
    const r = await makeFlashcards({ subjectId: other.id, source: { type: "note", id: copy }, count: 10 });
    expect(r.ok && r.result.status).toBe("made");
    expect((await repo.listFlashcards({ subjectId: other.id })).length).toBeGreaterThan(0);
    expect(await used()).toBe(1);
  });

  it("refuses a range with only one end or past the end of the file", async () => {
    const { subjectId } = await subjectWithNote();
    const src = await longFile(subjectId, 12);
    const half = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 2 }, count: 10 });
    expect(half.ok).toBe(false);
    const past = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 13, toPage: 14 }, count: 10 });
    expect(past.ok ? null : past.error).toBe("Pick a page between 1 and 12.");
    expect(await used()).toBe(0);
  });
});

/** A ready lecture file whose pages each have ~2,600 characters (5 pages fit one set). */
async function longFile(subjectId: string, pages: number, opts: { kind?: "pdf" | "pptx"; blankFrom?: number } = {}) {
  const id = crypto.randomUUID();
  await repo.createSource({ id, subjectId, fileName: "long.pdf", kind: opts.kind ?? "pdf", sizeBytes: 10, storagePath: `x/${id}.pdf` });
  const texts = Array.from({ length: pages }, (_, p) => (opts.blankFrom && p + 1 >= opts.blankFrom ? "" :
    Array.from({ length: 4 }, (_, k) => Array.from({ length: 10 }, (_, i) => `Page ${p + 1} part ${k} fact ${i + 1}: enzymes speed up reactions in cells.`).join(" ")).join("\n\n")));
  await repo.replaceSourceChunks(id, subjectId, chunkPages(texts));
  await repo.updateSource(id, { extractStatus: "ready", pageCount: pages });
  return id;
}

describe("long files: page ranges and series (flashcards.md)", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_AI_TOKEN", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("loadMakeOptions sends per-page counts, never text", async () => {
    const { subjectId } = await subjectWithNote();
    const long = await longFile(subjectId, 12);
    const short = await longFile(subjectId, 2);
    const r = await loadMakeOptions(subjectId);
    if (!r.ok) throw new Error(r.error);
    const l = r.files.find((f) => f.id === long)!;
    expect(l.pageChars).toHaveLength(12);
    expect(l.pageChars!.every((n) => n > 2000 && n < 2800)).toBe(true);
    expect(l.looseChars).toBe(0);
    expect(l.fitsOneSet).toBe(false);
    expect(r.files.find((f) => f.id === short)!.fitsOneSet).toBe(true);
    expect(JSON.stringify(r.files)).not.toContain("enzymes");
  });

  it("makes a series: each set covers its range and points at the next", async () => {
    const { subjectId } = await subjectWithNote();
    const src = await longFile(subjectId, 12);
    const first = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 1, toPage: 5 }, count: 10 });
    if (!first.ok || first.result.status !== "made") throw new Error("not made");
    expect(first.result.series).toEqual({ range: { from: 1, to: 5 }, covered: true, pageCount: 12, next: { from: 6, to: 10 } });
    expect(await pagesOf(first.result.cards)).toSatisfy((ps: (number | null)[]) => ps.every((p) => p !== null && p >= 1 && p <= 5));

    const second = await makeFlashcards({ subjectId, source: { type: "file", id: src, ...rangeOf(first.result.series!.next!) }, count: 10 });
    if (!second.ok || second.result.status !== "made") throw new Error("not made");
    expect(second.result.series).toEqual({ range: { from: 6, to: 10 }, covered: true, pageCount: 12, next: { from: 11, to: 12 } });
    expect(await pagesOf(second.result.cards)).toSatisfy((ps: (number | null)[]) => ps.every((p) => p !== null && p >= 6 && p <= 10));

    const last = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 11, toPage: 12 }, count: 10 });
    expect(last.ok && last.result.status === "made" && last.result.series?.next).toBeNull();
    expect(await used()).toBe(3);

    // The same pages again: free, and still says what comes next.
    const again = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 1, toPage: 5 }, count: 10 });
    expect(again.ok && again.result.status).toBe("already");
    expect(again.ok && again.result.status === "already" && again.result.series?.next).toEqual({ from: 6, to: 10 });
    expect(await used()).toBe(3);
  });

  it("a range over the budget is sampled; trailing pages without text count as done", async () => {
    const { subjectId } = await subjectWithNote();
    const src = await longFile(subjectId, 12, { blankFrom: 9 });
    const wide = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 1, toPage: 8 }, count: 10 });
    expect(wide.ok && wide.result.status === "made" && wide.result.series).toEqual({ range: { from: 1, to: 8 }, covered: false, pageCount: 12, next: null });
  });

  it("a range past the last page is clamped to it", async () => {
    const { subjectId } = await subjectWithNote();
    const src = await longFile(subjectId, 12);
    const r = await makeFlashcards({ subjectId, source: { type: "file", id: src, fromPage: 11, toPage: 20 }, count: 10 });
    expect(r.ok && r.result.status === "made" && r.result.series?.range).toEqual({ from: 11, to: 12 });
  });

  it("a file that fits one set is made whole, without a range", async () => {
    const { subjectId } = await subjectWithNote();
    const src = await longFile(subjectId, 3);
    const r = await makeFlashcards({ subjectId, source: { type: "file", id: src }, count: 10 });
    expect(r.ok && r.result.status === "made" && r.result.series).toEqual({ range: { from: 1, to: 3 }, covered: true, pageCount: 3, next: null });
  });
});

const pagesOf = async (cards: { id: string }[]) => Promise.all(cards.map(async (c) => (await repo.getFlashcard(c.id))!.page));
const rangeOf = (r: { from: number; to: number }) => ({ fromPage: r.from, toPage: r.to });
