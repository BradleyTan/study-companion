import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const { reviewCard, sessionOutlook, undoReview } = await import("./review");

async function cardWithHistory() {
  repo = demoRepo(crypto.randomUUID());
  const subject = await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" });
  const [card] = await repo.createFlashcards([{ subjectId: subject.id, front: "Q", back: "A", origin: "manual" }]);
  return card.id;
}

describe("review actions (QA)", () => {
  beforeEach(() => vi.useRealTimers());

  it("a retried undo removes only the grade it was for, not an older one", async () => {
    const id = await cardWithHistory();
    const k1 = crypto.randomUUID();
    const k2 = crypto.randomUUID();
    const first = await reviewCard({ flashcardId: id, rating: 3, clientKey: k1 });
    await reviewCard({ flashcardId: id, rating: 1, clientKey: k2 });
    expect(await repo.latestReviews(id, 5)).toHaveLength(2);

    const undone = await undoReview(id, k2);
    expect(undone.ok && undone.srs).toEqual(first.ok && first.srs);
    // The answer got lost and the review screen sends the same undo again.
    const retried = await undoReview(id, k2);
    expect(retried.ok).toBe(true);
    const left = await repo.latestReviews(id, 5);
    expect(left.map((r) => r.clientKey)).toEqual([k1]);
    expect((await repo.getFlashcard(id))!.srs).toEqual(first.ok && first.srs);
  });

  it("undoing a grade that never saved leaves earlier reviews alone", async () => {
    const id = await cardWithHistory();
    const k1 = crypto.randomUUID();
    await reviewCard({ flashcardId: id, rating: 3, clientKey: k1 });
    await undoReview(id, crypto.randomUUID());
    expect(await repo.latestReviews(id, 5)).toHaveLength(1);
  });

  it("undoing the first grade makes the card new again; a double-sent grade counts once", async () => {
    const id = await cardWithHistory();
    const k = crypto.randomUUID();
    await reviewCard({ flashcardId: id, rating: 4, clientKey: k });
    await reviewCard({ flashcardId: id, rating: 1, clientKey: k }); // double tap / retry: same key
    expect(await repo.latestReviews(id, 5)).toHaveLength(1);
    expect((await repo.getFlashcard(id))!.srs.reps).toBe(1);
    const r = await undoReview(id, k);
    expect(r.ok && r.srs.state).toBe(0);
    expect(await repo.countIntroducedSince(new Date(0).toISOString())).toBe(0);
  });

  it("rejects bad input", async () => {
    await cardWithHistory();
    expect((await reviewCard({ flashcardId: "x", rating: 3, clientKey: crypto.randomUUID() })).ok).toBe(false);
    expect((await reviewCard({ flashcardId: crypto.randomUUID(), rating: 5, clientKey: crypto.randomUUID() })).ok).toBe(false);
    expect((await undoReview(crypto.randomUUID(), "not-a-uuid")).ok).toBe(false);
  });

  it("a client key already used for one card never copies its schedule onto another", async () => {
    const a = await cardWithHistory();
    const subjectId = (await repo.getFlashcard(a))!.subjectId;
    const [b] = await repo.createFlashcards([{ subjectId, front: "Q2", back: "A2", origin: "manual" }]);
    const key = crypto.randomUUID();
    await reviewCard({ flashcardId: a, rating: 4, clientKey: key });
    const r = await reviewCard({ flashcardId: b.id, rating: 4, clientKey: key });
    expect(r.ok).toBe(false);
    expect((await repo.getFlashcard(b.id))!.srs.state).toBe(0);
  });

  it("the end-of-session outlook shares the new-card allowance across subjects like the banner", async () => {
    repo = demoRepo(crypto.randomUUID());
    const ids: string[] = [];
    for (const name of ["A", "B", "C"]) {
      const s = await repo.createSubject({ name, colour: "mint", emoji: "📘" });
      ids.push(s.id);
      await repo.createFlashcards(Array.from({ length: 15 }, (_, i) => ({ subjectId: s.id, front: `${name}${i}`, back: "x", origin: "manual" as const })));
    }
    const r = await sessionOutlook(ids[0]);
    const total = r.ok ? r.outlook.others.reduce((n, o) => n + o.due, 0) : -1;
    expect(total).toBeLessThanOrEqual(20);
  });
});

