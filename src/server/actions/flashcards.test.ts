import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const { makeFlashcards, deleteCard } = await import("./flashcards");
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
});
