"use server";
import { revalidatePath } from "next/cache";
import { addManual, topicKey, WEAK_TOPICS_MAX } from "@/lib/quiz/weak";
import { addWeakTopicInput, id as idSchema } from "@/lib/validation";
import { getRepo } from "../session";
import { firstIssue, type ActionResult } from "./result";

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

const FULL = `This subject has ${WEAK_TOPICS_MAX} weak topics, the most it can hold. Mark some as got it, then try again.`;

export type AddedTopic = { id: string; topic: string; lastMissedAt: string; reopened: boolean };
export type AddWeakTopicResult = { ok: true; topic: AddedTopic } | { ok: false; error: string; already?: true };

/**
 * "+ Add weak topic" (polish.md): a topic the student already finds tricky, with no misses yet.
 * Same topic (case-insensitive, spaces tidied) already open: refused; cleared: reopened. Later
 * quiz misses on it land on the same row (matched by topic key).
 */
export async function addWeakTopic(raw: unknown): Promise<AddWeakTopicResult> {
  const parsed = addWeakTopicInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { subjectId, topic } = parsed.data;
  const repo = await getRepo();
  if (!(await repo.getSubject(subjectId))) return { ok: false, error: "Subject not found." };
  const now = new Date().toISOString();
  const cur = await repo.findWeakTopic(subjectId, topicKey(topic));
  const step = addManual(cur, topic, now);
  if (step.status === "already") return { ok: false, error: "That's already on your list.", already: true };
  if (!cur && (await repo.listWeakTopics(subjectId)).length >= WEAK_TOPICS_MAX) return { ok: false, error: FULL };
  let saved;
  try {
    saved = await repo.saveWeakTopic(subjectId, step.next, cur?.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/weak topic limit/.test(msg)) return { ok: false, error: FULL };
    // Added twice at once (two tabs): the unique key caught the second insert.
    if (!cur && (await repo.findWeakTopic(subjectId, topicKey(topic)))) return { ok: false, error: "That's already on your list.", already: true };
    return { ok: false, error: "Couldn't add that. Try again." };
  }
  revalidatePath(`/subjects/${subjectId}`);
  return { ok: true, topic: { id: saved.id, topic: saved.topic, lastMissedAt: saved.lastMissedAt ?? now, reopened: step.status === "reopened" } };
}
