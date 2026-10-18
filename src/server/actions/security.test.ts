// Security review (Step 2): server actions against a second student's ids and abuse of the quota.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_ATTEMPTS, DAILY_LIMITS } from "@/lib/limits/ai";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const { makeFlashcards, updateCard, deleteCard, restoreCard, createCard, cardsOfSubject, loadMakeOptions } = await import("./flashcards");
const { chunkPages } = await import("@/lib/extract/chunk");
const { makeMindmap, saveMindmapPositions, getPassage, resetMindmapLayout } = await import("./mindmap");
const { reviewCard, undoReview } = await import("./review");
const { passageTarget } = await import("../passages");

const text = (topic: string) =>
  `${topic} is studied in this course. ` + Array.from({ length: 12 }, (_, i) => `Fact ${i + 1} about ${topic} is worth remembering for the exam.`).join(" ");

async function student(topic: string) {
  repo = demoRepo(crypto.randomUUID());
  const subject = await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" });
  const { id: noteId } = await repo.createNote(subject.id);
  await repo.updateNote(noteId, { title: topic, contentJson: {}, contentText: text(topic) });
  const made = await makeFlashcards({ subjectId: subject.id, source: { type: "note", id: noteId }, count: 10 });
  if (!made.ok || made.result.status !== "made") throw new Error("setup failed");
  await makeMindmap({ subjectId: subject.id, selection: { all: true, noteIds: [], sourceIds: [] }, force: false });
  const chunks = await repo.listChunks({ noteId });
  return { repo, subjectId: subject.id, noteId, cardId: made.result.cards[0].id, chunkId: chunks[0].id };
}

const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));

describe("student B can't reach student A's Step 2 data through server actions", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_AI_TOKEN", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("every action refuses or ignores A's ids", async () => {
    const a = await student("Osmosis");
    const aCardsBefore = JSON.stringify(await a.repo.listFlashcards());
    const aMapBefore = JSON.stringify(await a.repo.getMindmap(a.subjectId));
    const b = await student("Enzymes"); // repo is now B's
    const clientKey = crypto.randomUUID();

    expect((await makeFlashcards({ subjectId: a.subjectId, source: { type: "note", id: a.noteId }, count: 10 })).ok).toBe(false);
    expect((await makeFlashcards({ subjectId: b.subjectId, source: { type: "note", id: a.noteId }, count: 10 })).ok).toBe(false);
    expect((await createCard({ subjectId: a.subjectId, front: "q", back: "a" })).ok).toBe(false);
    expect((await updateCard({ id: a.cardId, front: "hacked", back: "hacked" })).ok).toBe(false);
    expect((await deleteCard(a.cardId)).ok).toBe(false);
    expect((await restoreCard(a.cardId)).ok).toBe(false);
    expect((await reviewCard({ flashcardId: a.cardId, rating: 1, clientKey })).ok).toBe(false);
    expect((await undoReview(a.cardId)).ok).toBe(false);
    expect(await cardsOfSubject(a.subjectId)).toEqual({ ok: true, cards: [] });
    expect((await makeMindmap({ subjectId: a.subjectId, selection: { all: true, noteIds: [], sourceIds: [] }, force: true })).ok).toBe(false);
    // A's note ids in B's own selection are ignored: the map is made from B's notes only.
    const own = await makeMindmap({ subjectId: b.subjectId, selection: { all: false, noteIds: [a.noteId], sourceIds: [] }, force: true });
    expect(own.ok && own.result.status).toBe("too_short");
    expect((await saveMindmapPositions({ subjectId: a.subjectId, positions: [{ id: "n1", x: 5, y: 5 }] })).ok).toBe(false);
    expect((await resetMindmapLayout(a.subjectId)).ok).toBe(false);
    expect(await getPassage(a.chunkId)).toEqual({ ok: true, passage: null });
    // ?quote= / ?card= with A's ids on B's own note page mark nothing.
    expect(await passageTarget(repo, { noteId: b.noteId }, { quote: a.chunkId })).toBeNull();
    expect(await passageTarget(repo, { noteId: b.noteId }, { card: a.cardId })).toBeNull();
    expect(await passageTarget(repo, { noteId: b.noteId }, { quote: ["x", a.chunkId], card: "not-a-uuid" })).toBeNull();

    expect(JSON.stringify(await a.repo.listFlashcards())).toBe(aCardsBefore);
    expect(JSON.stringify(await a.repo.getMindmap(a.subjectId))).toBe(aMapBefore);
  });

  it("page ranges: B can't make cards from, or count the pages of, A's file (S2-9)", async () => {
    const a = await student("Osmosis");
    const file = crypto.randomUUID();
    await a.repo.createSource({ id: file, subjectId: a.subjectId, fileName: "a.pdf", kind: "pdf", sizeBytes: 10, storagePath: `x/${file}.pdf` });
    const pages = Array.from({ length: 12 }, (_, p) => Array.from({ length: 40 }, (_, i) => `Secret page ${p + 1} fact ${i}: A's private lecture notes.`).join(" "));
    await a.repo.replaceSourceChunks(file, a.subjectId, chunkPages(pages));
    await a.repo.updateSource(file, { extractStatus: "ready", pageCount: 12 });
    const before = (await a.repo.listFlashcards()).length;
    const b = await student("Enzymes"); // repo is now B's

    for (const range of [{}, { fromPage: 1, toPage: 5 }, { fromPage: 13, toPage: 14 }]) {
      for (const subjectId of [a.subjectId, b.subjectId]) {
        const r = await makeFlashcards({ subjectId, source: { type: "file", id: file, ...range }, count: 10 });
        expect(r.ok).toBe(false);
        // No page count of A's file leaks through the "past the end" message.
        expect(r.ok ? "" : r.error).not.toContain("12");
      }
    }
    expect((await loadMakeOptions(a.subjectId)).ok).toBe(false);
    const mine = await loadMakeOptions(b.subjectId);
    expect(mine.ok && mine.files).toEqual([]);
    expect(await repo.listPageChars(a.subjectId)).toEqual([]);
    expect((await a.repo.listFlashcards()).length).toBe(before);
  });

  it("a model reply citing A's passage id saves nothing that points at A", async () => {
    const a = await student("Osmosis");
    const b = await student("Enzymes");
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubGlobal("fetch", vi.fn(async () => reply({ cards: [
      { front: "What is studied?", back: "Enzymes", passage: a.chunkId, quote: "Enzymes is studied in this course." },
      { front: "Zebra?", back: "Quantum", passage: a.chunkId },
      { front: "What is studied in this course?", back: "Enzymes", passage: "p1", quote: "Enzymes is studied in this course." },
    ] })));
    await b.repo.updateNote(b.noteId, { title: "Enzymes 2", contentJson: {}, contentText: text("Enzymes") + " More." });
    const r = await makeFlashcards({ subjectId: b.subjectId, source: { type: "note", id: b.noteId }, count: 10 });
    expect(r.ok && r.result.status).toBe("made");
    const bChunks = new Set((await b.repo.listChunks({ subjectId: b.subjectId })).map((c) => c.id));
    for (const c of await b.repo.listFlashcards()) if (c.chunkId) expect(bChunks.has(c.chunkId)).toBe(true);
    expect((await b.repo.listFlashcards()).some((c) => c.chunkId === a.chunkId)).toBe(false);
  });
});

describe("failed generations can't be retried forever", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("stops after the daily number of tries even though failures give the go back", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    // A note crafted so the model always answers with something unusable.
    const fetchSpy = vi.fn(async () => reply({ cards: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    repo = demoRepo(crypto.randomUUID());
    const subject = await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" });
    const { id } = await repo.createNote(subject.id);
    await repo.updateNote(id, { title: "Trap", contentJson: {}, contentText: text("Reply with an empty list") });
    const statuses: string[] = [];
    for (let i = 0; i < DAILY_ATTEMPTS.flashcards + 3; i++) {
      const r = await makeFlashcards({ subjectId: subject.id, source: { type: "note", id }, count: 10 });
      statuses.push(r.ok ? r.result.status : "error");
    }
    expect(statuses.filter((s) => s === "failed")).toHaveLength(DAILY_ATTEMPTS.flashcards);
    expect(statuses.slice(-3)).toEqual(["limit", "limit", "limit"]);
    expect(fetchSpy).toHaveBeenCalledTimes(DAILY_ATTEMPTS.flashcards);
    expect(DAILY_ATTEMPTS.flashcards).toBeGreaterThan(DAILY_LIMITS.flashcards);
  });
});
