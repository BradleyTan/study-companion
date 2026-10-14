import { describe, expect, it } from "vitest";
import { chunkPages } from "@/lib/extract/chunk";
import { gradeCard } from "@/lib/srs/scheduler";
import { demoRepo } from "./demo";

const para = (s: string) => `${s} ${"filler words ".repeat(70)}`.trim(); // ~900 chars: one passage each

async function setup() {
  const repo = demoRepo(crypto.randomUUID());
  const subject = await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" });
  const { id: noteId } = await repo.createNote(subject.id);
  return { repo, subjectId: subject.id, noteId };
}

describe("demo repo: passages and cards", () => {
  it("keeps a card linked when another part of the note changes, and clears only the link when its passage goes", async () => {
    const { repo, subjectId, noteId } = await setup();
    await repo.replaceNoteChunks(noteId, subjectId, chunkPages([`${para("Alpha")}\n\n${para("Beta")}`], { paged: false }));
    const [alpha, beta] = await repo.listChunks({ noteId });
    const [card] = await repo.createFlashcards([{ subjectId, front: "Q", back: "A", origin: "ai", chunkId: beta.id, noteId, sourceQuote: "Beta" }]);

    // Edit the first paragraph: Beta's passage keeps its id.
    await repo.replaceNoteChunks(noteId, subjectId, chunkPages([`${para("Gamma")}\n\n${para("Beta")}`], { paged: false }));
    const after = await repo.listChunks({ noteId });
    expect(after.map((c) => c.id)).toContain(beta.id);
    expect(after.map((c) => c.id)).not.toContain(alpha.id);
    expect((await repo.getFlashcard(card.id))!.chunkId).toBe(beta.id);

    // Remove Beta: the card stays, with its quote, unlinked from the passage only.
    await repo.replaceNoteChunks(noteId, subjectId, chunkPages([para("Gamma")], { paged: false }));
    const kept = (await repo.getFlashcard(card.id))!;
    expect(kept.chunkId).toBeNull();
    expect(kept.noteId).toBe(noteId);
    expect(kept.sourceQuote).toBe("Beta");

    await repo.deleteNote(noteId);
    expect((await repo.getFlashcard(card.id))!.noteId).toBeNull();
  });

  it("won't link a card to another student's passage", async () => {
    const a = await setup();
    const b = await setup();
    await a.repo.replaceNoteChunks(a.noteId, a.subjectId, chunkPages(["Some text here."], { paged: false }));
    const [chunk] = await a.repo.listChunks({ noteId: a.noteId });
    await expect(b.repo.createFlashcards([{ subjectId: b.subjectId, front: "Q", back: "A", origin: "ai", chunkId: chunk.id }])).rejects.toThrow();
    expect(await b.repo.getChunks([chunk.id])).toEqual([]);
    expect(await b.repo.getFlashcard((await a.repo.createFlashcards([{ subjectId: a.subjectId, front: "Q", back: "A", origin: "manual" }]))[0].id)).toBeNull();
  });

  it("soft-deletes and restores cards without touching the schedule", async () => {
    const { repo, subjectId } = await setup();
    const [card] = await repo.createFlashcards([{ subjectId, front: "Q", back: "A", origin: "manual" }]);
    const srs = gradeCard(card.srs, 3, new Date());
    await repo.setFlashcardSrs(card.id, srs);
    await repo.setFlashcardDeleted(card.id, true);
    expect(await repo.listFlashcards({ subjectId })).toEqual([]);
    await repo.setFlashcardDeleted(card.id, false);
    await repo.updateFlashcardText(card.id, { front: "Q2", back: "A2" });
    const back = (await repo.getFlashcard(card.id))!;
    expect(back).toMatchObject({ front: "Q2", edited: true, deletedAt: null, srs });
  });

  it("makes review saves idempotent by client key and counts new cards met", async () => {
    const { repo, subjectId } = await setup();
    const [card] = await repo.createFlashcards([{ subjectId, front: "Q", back: "A", origin: "manual" }]);
    const now = new Date();
    const input = { flashcardId: card.id, subjectId, rating: 3 as const, prevState: 0 as const, reviewedAt: now.toISOString(), srs: gradeCard(card.srs, 3, now), clientKey: crypto.randomUUID() };
    const first = await repo.addCardReview(input);
    const again = await repo.addCardReview({ ...input, rating: 1 });
    expect(again.id).toBe(first.id);
    expect(await repo.latestReviews(card.id, 5)).toHaveLength(1);
    expect(await repo.countIntroducedSince(new Date(now.getTime() - 1000).toISOString())).toBe(1);
  });
});

describe("demo repo: AI quota", () => {
  it("reserves up to the limit, refunds failures and keeps students apart", async () => {
    const a = demoRepo(crypto.randomUUID());
    const b = demoRepo(crypto.randomUUID());
    expect(await a.reserveAi("2026-10-14", "mindmap", 2)).toBe(true);
    expect(await a.reserveAi("2026-10-14", "mindmap", 2)).toBe(true);
    expect(await a.reserveAi("2026-10-14", "mindmap", 2)).toBe(false);
    await a.settleAi("2026-10-14", "mindmap", false, 0, 0);
    expect(await a.aiUsageCount("2026-10-14", "mindmap")).toBe(1);
    expect(await a.aiUsageCount("2026-10-15", "mindmap")).toBe(0);
    expect(await b.aiUsageCount("2026-10-14", "mindmap")).toBe(0);
  });

  it("caches per student", async () => {
    const a = demoRepo(crypto.randomUUID());
    const b = demoRepo(crypto.randomUUID());
    await a.putAiCache("flashcards", "h", "m", { cards: [] });
    expect(await a.getAiCache("flashcards", "h")).toEqual({ model: "m", output: { cards: [] } });
    expect(await b.getAiCache("flashcards", "h")).toBeNull();
  });
});
