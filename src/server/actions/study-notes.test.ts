import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const readWebPage = vi.fn();
vi.mock("../web-page", async (orig) => ({ ...(await orig<typeof import("../web-page")>()), readWebPage: (...a: unknown[]) => readWebPage(...a) }));
const { makeStudyNotes, loadNotesOptions } = await import("./study-notes");
const { WebPageError } = await import("../web-page");
const { chunkPages } = await import("@/lib/extract/chunk");
const { utcDay } = await import("../ai");

const lecture = [
  "Osmosis is the movement of water across a partially permeable membrane.",
  "Water moves from a dilute solution to a more concentrated solution.",
  "Diffusion is the net movement of particles from high to low concentration.",
  "Active transport uses energy from ATP to move ions against a gradient.",
  "The sodium-potassium pump moves 3 sodium ions out and 2 potassium ions in.",
].join(" ");

async function setup() {
  repo = demoRepo(crypto.randomUUID());
  const subject = await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" });
  const { id: noteId } = await repo.createNote(subject.id);
  await repo.updateNote(noteId, { title: "Transport", contentJson: {}, contentText: lecture });
  return { subjectId: subject.id, noteId };
}
const used = () => repo.aiUsageCount(utcDay(), "notes");

describe("make study notes", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_AI_TOKEN", "");
    readWebPage.mockReset();
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("makes notes from a note and saves them as a new note with passages; the same text again is free", async () => {
    const { subjectId, noteId } = await setup();
    const r = await makeStudyNotes({ subjectId, source: { type: "note", id: noteId } });
    if (!r.ok || r.result.status !== "made") throw new Error(JSON.stringify(r));
    expect(r.result.title).toBe("Study notes: Transport");
    expect(r.result.points).toBeGreaterThanOrEqual(3);
    expect(r.result.cached).toBe(false);
    const note = (await repo.getNote(r.result.noteId))!;
    expect(note.subjectId).toBe(subjectId);
    expect(note.contentText).toContain("✨ Study notes made from Transport.");
    expect(note.contentText).toContain("Osmosis is the movement of water across a partially permeable membrane.");
    expect((note.contentJson as { content: { type: string }[] }).content.some((b) => b.type === "bulletList")).toBe(true);
    expect((await repo.listChunks({ noteId: note.id })).length).toBeGreaterThan(0);
    expect(await used()).toBe(1);

    const again = await makeStudyNotes({ subjectId, source: { type: "note", id: noteId } });
    expect(again.ok && again.result.status === "made" && again.result.cached).toBe(true);
    expect(await used()).toBe(1);
  });

  it("makes notes from a page range of a file and says which pages on the first line", async () => {
    const { subjectId } = await setup();
    const id = crypto.randomUUID();
    await repo.createSource({ id, subjectId, fileName: "Lecture 3.pdf", kind: "pdf", sizeBytes: 10, storagePath: `x/${id}.pdf` });
    await repo.replaceSourceChunks(id, subjectId, chunkPages(Array.from({ length: 30 }, (_, p) => `${lecture} Page ${p + 1} adds that membranes are made of phospholipids.`.repeat(3))));
    await repo.updateSource(id, { extractStatus: "ready", pageCount: 30 });
    const r = await makeStudyNotes({ subjectId, source: { type: "file", id, fromPage: 2, toPage: 4 } });
    if (!r.ok || r.result.status !== "made") throw new Error(JSON.stringify(r));
    expect((await repo.getNote(r.result.noteId))!.contentText).toContain("made from Lecture 3.pdf, pages 2–4.");
    expect(await makeStudyNotes({ subjectId, source: { type: "file", id, fromPage: 1, toPage: 60 } })).toMatchObject({ ok: false });
  });

  it("a short note is too short and uses no go", async () => {
    const { subjectId } = await setup();
    const { id } = await repo.createNote(subjectId);
    await repo.updateNote(id, { title: "Hi", contentJson: {}, contentText: "Too short." });
    const r = await makeStudyNotes({ subjectId, source: { type: "note", id } });
    expect(r.ok && r.result.status).toBe("too_short");
    expect(await used()).toBe(0);
  });

  it("another student's note or subject is not found", async () => {
    const { noteId } = await setup();
    const mine = repo;
    repo = demoRepo(crypto.randomUUID());
    const other = await repo.createSubject({ name: "Chem", colour: "mint", emoji: "🧬" });
    expect(await makeStudyNotes({ subjectId: other.id, source: { type: "note", id: noteId } })).toMatchObject({ ok: false });
    repo = mine;
    expect(await makeStudyNotes({ subjectId: other.id, source: { type: "note", id: noteId } })).toMatchObject({ ok: false, error: "Subject not found." });
    expect(await makeStudyNotes({ subjectId: "nope", source: { type: "note", id: noteId } })).toMatchObject({ ok: false });
  });

  it("makes notes from a web page, citing the link, and only after reserving the go", async () => {
    const { subjectId } = await setup();
    const page = { title: "Membrane transport - Wiki", text: lecture, url: "https://en.wikipedia.org/wiki/Membrane_transport" };
    let usedWhenRead = -1;
    readWebPage.mockImplementationOnce(async () => { usedWhenRead = await used(); return page; }).mockResolvedValueOnce(page);
    const r = await makeStudyNotes({ subjectId, source: { type: "web", url: "en.wikipedia.org/wiki/Membrane_transport" } });
    if (!r.ok || r.result.status !== "made") throw new Error(JSON.stringify(r));
    expect(readWebPage).toHaveBeenCalledWith("en.wikipedia.org/wiki/Membrane_transport");
    expect(usedWhenRead).toBe(1); // the go was reserved before the page was read
    const note = (await repo.getNote(r.result.noteId))!;
    expect(note.title).toBe("Study notes: Membrane transport - Wiki");
    expect(note.contentText).toContain("made from https://en.wikipedia.org/wiki/Membrane_transport.");
    expect(await used()).toBe(1);

    // Same page text again: no new go.
    const again = await makeStudyNotes({ subjectId, source: { type: "web", url: "https://en.wikipedia.org/wiki/Membrane_transport" } });
    expect(again.ok && again.result.status === "made" && again.result.cached).toBe(true);
    expect(await used()).toBe(1);
  });

  it("a bad or blocked link is refused before anything is fetched or counted", async () => {
    const { subjectId } = await setup();
    for (const [url, reason] of [["http://localhost:3000/", "blocked"], ["ftp://x.org/a", "bad_url"], ["http://169.254.169.254/latest", "blocked"]] as const) {
      const r = await makeStudyNotes({ subjectId, source: { type: "web", url } });
      expect(r.ok && r.result.status === "web_error" && r.result.reason).toBe(reason);
    }
    expect(readWebPage).not.toHaveBeenCalled();
    expect(await used()).toBe(0);
    expect(await makeStudyNotes({ subjectId, source: { type: "web", url: "" } })).toMatchObject({ ok: false });
    expect(await makeStudyNotes({ subjectId, source: { type: "web", url: `https://a.org/${"x".repeat(3000)}` } })).toMatchObject({ ok: false });
  });

  it("a page that can't be read, or has too little text, gives the go back", async () => {
    const { subjectId } = await setup();
    readWebPage.mockRejectedValueOnce(new WebPageError("pdf"));
    const r = await makeStudyNotes({ subjectId, source: { type: "web", url: "https://example.com/a.pdf" } });
    expect(r.ok && r.result.status === "web_error" && r.result.reason).toBe("pdf");
    readWebPage.mockResolvedValueOnce({ title: "", text: "Sign in to continue.", url: "https://example.com/" });
    const s = await makeStudyNotes({ subjectId, source: { type: "web", url: "https://example.com/" } });
    expect(s.ok && s.result.status === "too_short" && s.result.sourceType).toBe("web");
    expect(await used()).toBe(0);
  });

  it("stops at the daily limit", async () => {
    const { subjectId } = await setup();
    for (let i = 0; i < 5; i++) {
      readWebPage.mockResolvedValueOnce({ title: `Page ${i}`, text: `${lecture} Version ${i} of this page explains osmosis again.`, url: `https://example.com/${i}` });
      const r = await makeStudyNotes({ subjectId, source: { type: "web", url: `https://example.com/${i}` } });
      expect(r.ok && r.result.status).toBe("made");
    }
    const r = await makeStudyNotes({ subjectId, source: { type: "web", url: "https://example.com/6" } });
    expect(r.ok && r.result.status === "limit" && r.result.quota.left).toBe(0);
    expect(readWebPage).toHaveBeenCalledTimes(5);
  });

  it("loadNotesOptions lists notes and files with the notes quota, never file text", async () => {
    const { subjectId, noteId } = await setup();
    const r = await loadNotesOptions(subjectId);
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.map((n) => n.id)).toEqual([noteId]);
    expect(r.quota).toMatchObject({ kind: "notes", limit: 5, left: 5 });
    expect(JSON.stringify(r)).not.toContain("partially permeable");
  });
});
