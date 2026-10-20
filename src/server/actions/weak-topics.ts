"use server";
import { revalidatePath } from "next/cache";
import { id as idSchema } from "@/lib/validation";
import { getRepo } from "../session";
import type { ActionResult } from "./result";

// Weak topics (weak-topics.md). Public endpoints: ids are validated and looked up through the
// student's own repo, so another student's topic is simply not found.

/** "Mark as got it": clears the topic by hand; a new miss reopens it. */
export async function markGotIt(topicId: string): Promise<ActionResult<{ clearedAt: string }>> {
  if (!idSchema.safeParse(topicId).success) return { ok: false, error: "Topic not found." };
  const repo = await getRepo();
  const t = await repo.getWeakTopic(topicId);
  if (!t) return { ok: false, error: "Topic not found." };
  const clearedAt = t.clearedAt ?? new Date().toISOString();
  if (!t.clearedAt) await repo.saveWeakTopic(t.subjectId, { ...t, clearedAt }, t.id);
  revalidatePath(`/subjects/${t.subjectId}`);
  return { ok: true, clearedAt };
}

/** Undo for "Mark as got it". */
export async function reopenTopic(topicId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(topicId).success) return { ok: false, error: "Topic not found." };
  const repo = await getRepo();
  const t = await repo.getWeakTopic(topicId);
  if (!t) return { ok: false, error: "Topic not found." };
  if (t.clearedAt) await repo.saveWeakTopic(t.subjectId, { ...t, clearedAt: null }, t.id);
  revalidatePath(`/subjects/${t.subjectId}`);
  return { ok: true };
}

export type MissedQuestion = { id: string; prompt: string; answer: string; explanation: string };

/** "See the questions": the missed prompts on this topic with their right answers (read-only). */
export async function topicQuestions(topicId: string): Promise<ActionResult<{ questions: MissedQuestion[] }>> {
  if (!idSchema.safeParse(topicId).success) return { ok: false, error: "Topic not found." };
  const repo = await getRepo();
  const t = await repo.getWeakTopic(topicId);
  if (!t) return { ok: false, error: "Topic not found." };
  const questions = (await repo.listQuestions({ subjectId: t.subjectId, topicKey: t.topicKey })).filter((q) => !q.removedAt);
  const answers = questions.length ? await repo.listAnswers({ questionIds: questions.map((q) => q.id) }) : [];
  const missed = new Set(answers.filter((a) => !a.correct).map((a) => a.questionId));
  return {
    ok: true,
    questions: questions.filter((q) => missed.has(q.id)).slice(0, 20).map((q) => ({ id: q.id, prompt: q.prompt, answer: q.answer, explanation: q.explanation })),
  };
}
