import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEAK_KEYWORD_SEARCHES, WEAK_TOPICS_MAX } from "@/lib/quiz/weak";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const weak = await import("./weak-topics");
const quiz = await import("./quiz");
const { utcDay } = await import("../ai");
const { syncNoteChunks } = await import("../passages");
const { weakTopicsView } = await import("../quiz");

const NOTE = [
  "Mitochondria produce most of the energy in eukaryotic cells through respiration.",
  "Osmosis is the movement of water across a partially permeable membrane.",
  "Ribosomes assemble proteins by reading messenger RNA in the cytoplasm.",
  "Chloroplasts capture sunlight and convert it into glucose during photosynthesis.",
  "Diffusion spreads particles from a region of higher concentration to lower concentration.",
  "Enzymes speed up chemical reactions without being consumed themselves.",
  "The nucleus stores genetic information inside chromosomes made of DNA.",
  "Lysosomes contain digestive enzymes that break down worn out organelles.",
].join(" ");

async function setup(withNote = true) {
  repo = demoRepo(crypto.randomUUID());
  const subject = await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" });
  if (withNote) {
    const { id: noteId } = await repo.createNote(subject.id);
    await repo.updateNote(noteId, { title: "Cells", contentJson: {}, contentText: NOTE });
    await syncNoteChunks(repo, { id: noteId, subjectId: subject.id, title: "Cells", contentText: NOTE });
  }
  return subject.id;
}
const used = () => repo.aiUsageCount(utcDay(), "quiz");

describe("addWeakTopic", () => {
  beforeEach(() => { vi.stubEnv("GROQ_API_KEY", ""); });
  afterEach(() => vi.unstubAllEnvs());

  it("adds a tidied topic with no misses, listed first as open", async () => {
    const subjectId = await setup();
    const r = await weak.addWeakTopic({ subjectId, topic: "  Krebs    cycle " });
    expect(r.ok && r.topic.topic).toBe("Krebs cycle");
    const row = await repo.findWeakTopic(subjectId, "krebs cycle");
    expect(row).toMatchObject({ missCount: 0, rightStreak: 0, clearedAt: null, chunkIds: [], recent: [] });
    expect(row?.lastMissedAt).toBeTruthy();
    const view = await weakTopicsView(repo, subjectId);
    expect(view.open.map((t) => t.topic)).toEqual(["Krebs cycle"]);
  });

  it("validates the topic", async () => {
    const subjectId = await setup(false);
    expect(await weak.addWeakTopic({ subjectId, topic: "   " })).toEqual({ ok: false, error: "Type a topic first." });
    expect(await weak.addWeakTopic({ subjectId, topic: "x".repeat(41) })).toEqual({ ok: false, error: "Keep it to 40 characters." });
    expect((await weak.addWeakTopic({ subjectId, topic: `${"x".repeat(38)}    y` })).ok).toBe(true);
    expect((await weak.addWeakTopic({ subjectId: "nope", topic: "Osmosis" })).ok).toBe(false);
    expect((await weak.addWeakTopic({ subjectId, topic: 42 })).ok).toBe(false);
    expect((await weak.addWeakTopic(null)).ok).toBe(false);
  });

  it("refuses an open duplicate and reopens a cleared one", async () => {
    const subjectId = await setup(false);
    const first = await weak.addWeakTopic({ subjectId, topic: "Osmosis" });
    if (!first.ok) throw new Error(first.error);
    expect(await weak.addWeakTopic({ subjectId, topic: " OSMOSIS " })).toEqual({ ok: false, error: "That's already on your list.", already: true });
    await weak.markGotIt(first.topic.id);
    const again = await weak.addWeakTopic({ subjectId, topic: "osmosis" });
    expect(again.ok && again.topic).toMatchObject({ id: first.topic.id, topic: "Osmosis", reopened: true });
    expect(await repo.getWeakTopic(first.topic.id)).toMatchObject({ clearedAt: null, rightStreak: 0 });
    expect((await repo.listWeakTopics(subjectId)).length).toBe(1);
  });

  it("rejects another student's subject", async () => {
    const subjectId = await setup(false);
    repo = demoRepo(crypto.randomUUID());
    expect(await weak.addWeakTopic({ subjectId, topic: "Osmosis" })).toEqual({ ok: false, error: "Subject not found." });
    expect(await repo.listWeakTopics(subjectId)).toEqual([]);
  });

  it(`stops at ${WEAK_TOPICS_MAX} topics per subject, but a cleared one can still reopen`, async () => {
    const subjectId = await setup(false);
    for (let i = 0; i < WEAK_TOPICS_MAX; i++) {
      await repo.saveWeakTopic(subjectId, { topic: `t${i}`, missCount: 1, rightStreak: 0, lastMissedAt: null, clearedAt: i === 0 ? "2026-10-01T00:00:00Z" : null, chunkIds: [], recent: [] });
    }
    const r = await weak.addWeakTopic({ subjectId, topic: "One more" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/500 weak topics/);
    expect((await weak.addWeakTopic({ subjectId, topic: "t0" })).ok).toBe(true);
  });
});

describe("practising a hand-added topic", () => {
  beforeEach(() => { vi.stubEnv("GROQ_API_KEY", ""); });
  afterEach(() => vi.unstubAllEnvs());

  it("finds passages that mention it and makes a quiz", async () => {
    const subjectId = await setup();
    await weak.addWeakTopic({ subjectId, topic: "Osmosis" });
    const r = await quiz.makeQuiz({ subjectId, source: { type: "weak", topics: ["Osmosis"] }, kind: "mixed", count: 5 });
    expect(r.ok && r.result.status).toBe("made");
    expect(await used()).toBe(1);
  });

  it("says the notes don't cover it, without using a go", async () => {
    const subjectId = await setup();
    await weak.addWeakTopic({ subjectId, topic: "Krebs cycle" });
    const r = await quiz.makeQuiz({ subjectId, source: { type: "weak", topics: ["Krebs cycle"] }, kind: "mixed", count: 5 });
    expect(r.ok && r.result.status).toBe("weak_no_notes");
    expect(await used()).toBe(0);
  });

  it("with no notes at all, says so too", async () => {
    const subjectId = await setup(false);
    await weak.addWeakTopic({ subjectId, topic: "Osmosis" });
    const r = await quiz.makeQuiz({ subjectId, source: { type: "weak", topics: ["Osmosis"] }, kind: "mixed", count: 5 });
    expect(r.ok && r.result.status).toBe("weak_no_notes");
    expect(await used()).toBe(0);
  });

  it(`looks up at most ${WEAK_KEYWORD_SEARCHES} hand-added topics per Practise click, with no AI`, async () => {
    const subjectId = await setup();
    const names = Array.from({ length: 60 }, (_, i) => `Zebra topic ${i}`);
    for (const topic of names) await weak.addWeakTopic({ subjectId, topic });
    const search = vi.spyOn(repo, "searchChunks");
    const r = await quiz.makeQuiz({ subjectId, source: { type: "weak", topics: names }, kind: "mixed", count: 5 });
    expect(r.ok && r.result.status).toBe("weak_no_notes");
    expect(search).toHaveBeenCalledTimes(WEAK_KEYWORD_SEARCHES);
    expect(await used()).toBe(0);
  });

  it("a later quiz miss on the same topic lands on the hand-added row", async () => {
    const subjectId = await setup();
    const made = await quiz.makeQuiz({ subjectId, source: { type: "all" }, kind: "mcq", count: 5 });
    if (!made.ok || made.result.status !== "made") throw new Error("not made");
    const s = await quiz.startAttempt({ quizId: made.result.quizId, fresh: false });
    if (!s.ok) throw new Error(s.error);
    const q = s.view.questions[0];
    const added = await weak.addWeakTopic({ subjectId, topic: `  ${q.topic.toUpperCase()} ` });
    if (!added.ok) throw new Error(added.error);
    const full = (await repo.getQuestion(q.id))!;
    const slot = (await repo.getAttempt(s.view.attemptId))!.order.find((x) => x.q === q.id)!;
    await quiz.checkAnswer({ attemptId: s.view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), choice: (slot.o!.indexOf(full.correctIndex!) + 1) % 4 });
    const rows = await repo.listWeakTopics(subjectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: added.topic.id, missCount: 1, recent: [false] });
    expect(rows[0].chunkIds.length).toBe(1);
  });
});
