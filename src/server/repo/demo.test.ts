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
    expect(await a.reserveAi("2026-10-14", "mindmap", 2, 10)).toBe(true);
    expect(await a.reserveAi("2026-10-14", "mindmap", 2, 10)).toBe(true);
    expect(await a.reserveAi("2026-10-14", "mindmap", 2, 10)).toBe(false);
    await a.settleAi("2026-10-14", "mindmap", false, 0, 0);
    expect(await a.aiUsageCount("2026-10-14", "mindmap")).toBe(1);
    expect(await a.aiUsageCount("2026-10-15", "mindmap")).toBe(0);
    expect(await b.aiUsageCount("2026-10-14", "mindmap")).toBe(0);
  });

  it("caps tries, failed ones included", async () => {
    const a = demoRepo(crypto.randomUUID());
    for (let i = 0; i < 3; i++) {
      expect(await a.reserveAi("2026-10-14", "flashcards", 5, 3)).toBe(true);
      await a.settleAi("2026-10-14", "flashcards", false, 0, 0);
    }
    expect(await a.reserveAi("2026-10-14", "flashcards", 5, 3)).toBe(false);
    expect(await a.aiUsageCount("2026-10-14", "flashcards")).toBe(0);
  });

  it("caches per student", async () => {
    const a = demoRepo(crypto.randomUUID());
    const b = demoRepo(crypto.randomUUID());
    await a.putAiCache("flashcards", "h", "m", { cards: [] });
    expect(await a.getAiCache("flashcards", "h")).toEqual({ model: "m", output: { cards: [] } });
    expect(await b.getAiCache("flashcards", "h")).toBeNull();
  });
});

describe("demo repo: ask your notes", () => {
  const answer = { kind: "answer" as const, content: "Alpha. [1]", citations: [], reveal: null };

  it("keeps each student's chat and passages to themselves", async () => {
    const a = await setup();
    await a.repo.replaceNoteChunks(a.noteId, a.subjectId, chunkPages([para("Mitochondria make ATP.")], { paged: false }));
    const { question } = await a.repo.addChatExchange(a.subjectId, { clientKey: crypto.randomUUID(), question: "What makes ATP?", answer });
    const b = demoRepo(crypto.randomUUID());
    expect(await b.listChat(a.subjectId, { limit: 50 })).toEqual([]);
    expect(await b.getChatMessage(question.id)).toBeNull();
    expect(await b.searchChunks(a.subjectId, "mitochondria", 10)).toEqual([]);
    await b.setChatFeedback(question.id, "wrong");
    await b.clearChat(a.subjectId);
    expect(await a.repo.countChat(a.subjectId)).toBe(2);
    await expect(b.addChatExchange(a.subjectId, { clientKey: crypto.randomUUID(), question: "x", answer })).rejects.toThrow();
    expect((await a.repo.searchChunks(a.subjectId, "What do mitochondria make?", 10)).length).toBe(1);
    expect(await a.repo.embeddingCounts(a.subjectId)).toEqual({ total: 1, embedded: 0 });
  });

  it("orders a question before its answer, refuses a reused client key, exports and cascades", async () => {
    const { repo, subjectId } = await setup();
    const key = crypto.randomUUID();
    const first = await repo.addChatExchange(subjectId, { clientKey: key, question: "One?", answer });
    const second = await repo.addChatExchange(subjectId, { clientKey: crypto.randomUUID(), question: "Two?", answer, after: first.answer.createdAt });
    expect(second.question.createdAt > first.answer.createdAt).toBe(true);
    expect((await repo.listChat(subjectId, { limit: 10 })).map((m) => m.content)).toEqual(["Alpha. [1]", "Two?", "Alpha. [1]", "One?"]);
    await expect(repo.addChatExchange(subjectId, { clientKey: key, question: "Again?", answer })).rejects.toThrow();
    expect((await repo.findChatExchange(key))?.answer?.id).toBe(first.answer.id);
    expect((await repo.exportAll()).chatMessages).toHaveLength(4);
    await repo.deleteOldestChat(subjectId, 1);
    expect((await repo.listChat(subjectId, { limit: 10 })).map((m) => m.content)).toEqual(["Alpha. [1]", "Two?"]);
    await repo.deleteSubject(subjectId);
    expect(await repo.countChat(subjectId)).toBe(0);
  });
});
