"use server";
import { revalidatePath } from "next/cache";
import { gradeCard, newSrs, type SrsState } from "@/lib/srs/scheduler";
import { id as idSchema, reviewInput } from "@/lib/validation";
import { dayContext, subjectDue, upcoming } from "../cards";
import { getRepo } from "../session";
import { firstIssue, type ActionResult } from "./result";

/**
 * Saves one grade. The server is the source of truth: it recomputes the schedule with its
 * own clock. Retries with the same clientKey return the first save instead of grading twice.
 */
export async function reviewCard(raw: unknown): Promise<ActionResult<{ srs: SrsState }>> {
  const parsed = reviewInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { flashcardId, rating, clientKey } = parsed.data;
  const repo = await getRepo();
  const card = await repo.getFlashcard(flashcardId);
  if (!card || card.deletedAt) return { ok: false, error: "This card was deleted." };
  const now = new Date();
  const next = gradeCard(card.srs, rating, now);
  const saved = await repo.addCardReview({
    flashcardId, subjectId: card.subjectId, rating, prevState: card.srs.state, reviewedAt: now.toISOString(), srs: next, clientKey,
  });
  // On a retried save `saved` is the first one, so the card keeps that schedule.
  await repo.setFlashcardSrs(flashcardId, saved.srs);
  revalidatePath(`/subjects/${card.subjectId}`);
  return { ok: true, srs: saved.srs };
}

/** Undo: removes the card's last review and restores the schedule from before it. */
export async function undoReview(flashcardId: string): Promise<ActionResult<{ srs: SrsState }>> {
  if (!idSchema.safeParse(flashcardId).success) return { ok: false, error: "Card not found." };
  const repo = await getRepo();
  const card = await repo.getFlashcard(flashcardId);
  if (!card) return { ok: false, error: "Card not found." };
  const [last, previous] = await repo.latestReviews(flashcardId, 2);
  if (!last) return { ok: false, error: "Nothing to undo." };
  await repo.deleteCardReview(last.id);
  const restored = previous ? previous.srs : newSrs(new Date(card.createdAt));
  await repo.setFlashcardSrs(flashcardId, restored);
  revalidatePath(`/subjects/${card.subjectId}`);
  return { ok: true, srs: restored };
}

export type SessionOutlook = {
  tomorrow: number;
  nextDueAt: string | null;
  /** Other subjects with cards due today, most due first. */
  others: { id: string; name: string; due: number }[];
};

/** For the end-of-session summary and the "All caught up" state. */
export async function sessionOutlook(subjectId: string | null): Promise<ActionResult<{ outlook: SessionOutlook }>> {
  if (subjectId !== null && !idSchema.safeParse(subjectId).success) return { ok: false, error: "Subject not found." };
  const repo = await getRepo();
  const next = await upcoming(repo, subjectId);
  const [subjects, ctx] = await Promise.all([repo.listSubjects(), dayContext(repo)]);
  const others: SessionOutlook["others"] = [];
  for (const s of subjects) {
    if (s.id === subjectId) continue;
    const d = await subjectDue(repo, s.id, ctx);
    if (d.total > 0) others.push({ id: s.id, name: s.name, due: d.total });
  }
  others.sort((a, b) => b.due - a.due);
  return { ok: true, outlook: { tomorrow: next.tomorrow, nextDueAt: next.nextDueAt, others } };
}
