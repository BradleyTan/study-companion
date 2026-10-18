"use server";
import { revalidatePath } from "next/cache";
import { inputHash } from "@/lib/ai/cache";
import { fitPassages } from "@/lib/ai/prompts";
import { aiMode } from "@/lib/ai/providers";
import { MIN_GOOD_QUESTIONS, normaliseQuizWithStats } from "@/lib/ai/quiz";
import { runAiTask } from "@/lib/ai/run";
import { MIN_SOURCE_CHARS, quizTask, toPassages } from "@/lib/ai/tasks";
import type { GeneratedQuestion } from "@/lib/ai/types";
import { DAILY_ATTEMPTS, DAILY_LIMITS, QUIZ_MAX_CHARS, type Quota } from "@/lib/limits/ai";
import { matchFill, normaliseAnswer } from "@/lib/quiz/match";
import { attemptOrder, KIND_LABEL, permutation, quizTitle, type QuizKind } from "@/lib/quiz/order";
import { applyMiss, applyRight, sortOpen, topicKey, undoMiss, type WeakPrev } from "@/lib/quiz/weak";
import {
  attemptQuestionInput, checkAnswerInput, editQuestionInput, id as idSchema, makeQuizInput, reportQuestionInput, startAttemptInput,
} from "@/lib/validation";
import { appBudget, quotaFor, studentDay } from "../ai";
import { feedbackOf, playView, resultsView, settleAttempt, sourcesOf, type Feedback, type PlayView, type ResultsView } from "../quiz";
import type { ChunkRow, NewQuestion, Question, QuizAnswer, QuizAttempt, Repo } from "../repo/types";
import { getRepo } from "../session";
import { sourceChunks, sourceOptions, type SourceOptions } from "../source-select";
import { firstIssue, type ActionResult } from "./result";

// Quizzes (quiz-builder.md, quiz.md). Every export here is a public endpoint: arguments are
// validated with zod and every row is looked up through the student's own repo (RLS + pinned
// user id), so another student's ids simply aren't found.

const MAX_QUIZZES_PER_SUBJECT = 200;
/** The database stops at 50 attempts per quiz; older attempts are pruned before that. */
const KEEP_ATTEMPTS = 45;
const MAX_CACHE_BYTES = 200_000;
/** Existing topic names sent to the model so the same idea keeps one name. */
const MAX_PROMPT_TOPICS = 60;
const ACCEPTED_DB_MAX = 10;

export type QuizMakeOptions = SourceOptions & {
  quota: Quota;
  subjectName: string;
  /** Open weak topics, most recent miss first. */
  weak: { name: string; key: string; missCount: number }[];
};

/** Sources, open weak topics and quota for the Make a quiz dialog. */
export async function loadQuizOptions(subjectId: string): Promise<ActionResult<QuizMakeOptions>> {
  if (!idSchema.safeParse(subjectId).success) return { ok: false, error: "Subject not found." };
  const repo = await getRepo();
  const subject = await repo.getSubject(subjectId);
  if (!subject) return { ok: false, error: "Subject not found." };
  const [opts, quota, topics] = await Promise.all([sourceOptions(repo, subjectId, QUIZ_MAX_CHARS), quotaFor(repo, "quiz"), repo.listWeakTopics(subjectId)]);
  const weak = sortOpen(topics.filter((t) => !t.clearedAt)).map((t) => ({ name: t.topic, key: t.topicKey, missCount: t.missCount }));
  return { ok: true, ...opts, quota, subjectName: subject.name, weak };
}

export type QuizMadeFrom = { kind: "note" | "file" | "all" | "weak"; name: string; range: string | null; kindLabel: string };

export type MakeQuizResult =
  | { status: "made"; quizId: string; title: string; count: number; requested: number; cached: boolean; from: QuizMadeFrom; quota: Quota }
  | { status: "already"; quizId: string; quota: Quota }
  | { status: "too_short" | "limit" | "allowance" | "failed" | "not_configured" | "weak_gone"; quota: Quota };

type Picked = { chunks: ChunkRow[]; from: QuizMadeFrom; sourceIds: string[]; pageFrom: number | null; pageTo: number | null; focus: string[] };

const rangeLabel = (unit: "page" | "slide", from: number, to: number) => (from === to ? `${unit} ${from}` : `${unit}s ${from}–${to}`);

/** The passages a quiz is made from, per source type. */
async function pickPassages(repo: Repo, subjectId: string, subjectName: string, source: ReturnType<typeof makeQuizInput.parse>["source"], kind: QuizKind): Promise<Picked | { error: string } | "weak_gone" | null> {
  const kindLabel = KIND_LABEL[kind];
  if (source.type === "all") {
    // Everything: every note and ready file, sampled evenly (same spread as the mindmap's "All sources").
    const [files, chunks] = await Promise.all([repo.listSources(subjectId), repo.listChunks({ subjectId })]);
    const ready = new Set(files.filter((f) => f.extractStatus === "ready").map((f) => f.id));
    const list = chunks
      .filter((c) => c.noteId || (c.sourceId && ready.has(c.sourceId)))
      .sort((a, b) => Number(!!a.sourceId) - Number(!!b.sourceId) || (a.noteId ?? a.sourceId!).localeCompare(b.noteId ?? b.sourceId!) || a.ordinal - b.ordinal);
    return { chunks: list, from: { kind: "all", name: subjectName, range: null, kindLabel }, sourceIds: [], pageFrom: null, pageTo: null, focus: [] };
  }
  if (source.type === "weak") {
    const keys = new Set(source.topics.map(topicKey));
    const topics = (await repo.listWeakTopics(subjectId)).filter((t) => !t.clearedAt && keys.has(t.topicKey));
    if (!topics.length) return "weak_gone";
    const ids = [...new Set(topics.flatMap((t) => t.chunkIds))];
    const chunks = ids.length ? (await repo.getChunks(ids)).filter((c) => c.subjectId === subjectId) : [];
    if (!chunks.length) return "weak_gone";
    chunks.sort((a, b) => (a.noteId ?? a.sourceId ?? "").localeCompare(b.noteId ?? b.sourceId ?? "") || a.ordinal - b.ordinal);
    return { chunks, from: { kind: "weak", name: "your weak topics", range: null, kindLabel }, sourceIds: [], pageFrom: null, pageTo: null, focus: topics.map((t) => t.topic) };
  }
  const found = await sourceChunks(repo, subjectId, source, QUIZ_MAX_CHARS);
  if (!found || "error" in found) return found;
  const ranged = source.type === "file" && source.fromPage !== undefined && found.series;
  const range = ranged && found.series ? rangeLabel(found.unit, found.series.range.from, found.series.range.to) : null;
  return {
    chunks: found.chunks,
    from: { kind: source.type, name: found.name, range, kindLabel },
    sourceIds: [found.noteId ?? found.sourceId!],
    pageFrom: ranged && found.series ? found.series.range.from : null,
    pageTo: ranged && found.series ? found.series.range.to : null,
    focus: [],
  };
}

/** Topic names already in use in this subject (weak topics first), for the prompt. */
async function knownTopics(repo: Repo, subjectId: string): Promise<string[]> {
  const [topics, quizzes] = await Promise.all([repo.listWeakTopics(subjectId), repo.listQuizzes(subjectId)]);
  const recent = quizzes.slice(0, 30).map((q) => q.id);
  const questions = recent.length ? await repo.listQuestions({ quizIds: recent }) : [];
  const out = new Map<string, string>();
  for (const name of [...sortOpen(topics).map((t) => t.topic), ...questions.map((q) => q.topic)]) {
    const k = topicKey(name);
    if (k && !out.has(k)) out.set(k, name.trim());
    if (out.size >= MAX_PROMPT_TOPICS) break;
  }
  return [...out.values()];
}

/** Saved questions: links from the student's own passages, MCQ options shuffled by the server. */
function toNewQuestions(list: GeneratedQuestion[], chunks: ChunkRow[]): NewQuestion[] {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return list.filter((q) => byId.has(q.chunkId)).map((q, ordinal) => {
    const c = byId.get(q.chunkId)!;
    let options: string[] | null = null;
    let correctIndex: number | null = null;
    if (q.type === "mcq" && q.options && q.correctIndex !== null) {
      // The model's order is never trusted, so the answer isn't always B.
      const order = permutation(q.options.length);
      options = order.map((i) => q.options![i]);
      correctIndex = order.indexOf(q.correctIndex);
    }
    return {
      ordinal, type: q.type, prompt: q.prompt, options, correctIndex, answer: q.answer, accepted: q.type === "fill" ? q.accepted : [],
      explanation: q.explanation, topic: q.topic, sourceQuote: q.quote, chunkId: c.id, noteId: c.noteId, sourceId: c.sourceId, page: c.page,
    };
  });
}

/**
 * Makes a quiz from one note, a page range of one file, everything, or the passages behind
 * ticked weak topics. Quota (quiz-builder.md): one go per new quiz; the same settings again
 * are free; fewer than 3 good questions counts as "too little text" and gives the go back.
 */
export async function makeQuiz(raw: unknown): Promise<ActionResult<{ result: MakeQuizResult }>> {
  const parsed = makeQuizInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { subjectId, source, kind, count } = parsed.data;
  const repo = await getRepo();
  const subject = await repo.getSubject(subjectId);
  if (!subject) return { ok: false, error: "Subject not found." };
  const quota = () => quotaFor(repo, "quiz");
  const result = async (r: { status: "too_short" | "limit" | "allowance" | "failed" | "not_configured" | "weak_gone" }) => ({ ok: true as const, result: { ...r, quota: await quota() } });

  const picked = await pickPassages(repo, subjectId, subject.name, source, kind);
  if (!picked) return { ok: false, error: "That note or file isn't available any more." };
  if (picked === "weak_gone") return result({ status: "weak_gone" });
  if ("error" in picked) return { ok: false, error: picked.error };
  const totalChars = picked.chunks.reduce((n, c) => n + c.text.length, 0);
  if (totalChars < MIN_SOURCE_CHARS) return result({ status: "too_short" });

  const chunks = fitPassages(picked.chunks, QUIZ_MAX_CHARS);
  const passages = toPassages(chunks);
  const focusKeys = picked.focus.map(topicKey).sort();
  const hash = inputHash("quiz", chunks.map((c) => c.contentHash), { count, kind, focus: focusKeys.join("|") });

  const shelfCopy = await repo.findQuizByHash(subjectId, hash);
  if (shelfCopy) return { ok: true, result: { status: "already", quizId: shelfCopy.id, quota: await quota() } };

  // Soft-deleted quizzes past their Undo still count toward the cap until purged.
  await repo.purgeDeletedQuizzes(subjectId, new Date(Date.now() - 60_000).toISOString());
  if ((await repo.countQuizzes(subjectId)) >= MAX_QUIZZES_PER_SUBJECT) {
    return { ok: false, error: `A subject can hold up to ${MAX_QUIZZES_PER_SUBJECT} quizzes. Delete some first.` };
  }
  const topics = await knownTopics(repo, subjectId);
  const title = quizTitle({ kind: picked.from.kind, name: picked.from.name, range: picked.from.range }, kind);
  const save = async (list: GeneratedQuestion[]) => {
    const questions = toNewQuestions(list, chunks);
    if (questions.length < MIN_GOOD_QUESTIONS) return null;
    const { quiz } = await repo.createQuiz({
      subjectId, title, kind, focus: source.type === "weak" ? "weak" : "all", requested: count,
      sourceIds: picked.sourceIds, pageFrom: picked.pageFrom, pageTo: picked.pageTo, inputHash: hash,
    }, questions);
    revalidatePath(`/subjects/${subjectId}`);
    return { quiz, count: questions.length };
  };

  // Same passages and settings: never pay twice (and never reuse the local generator's output for real AI).
  const mode = aiMode();
  const cached = await repo.getAiCache("quiz", hash);
  if (cached && (cached.model !== "local" || mode === "local")) {
    const norm = normaliseQuizWithStats(cached.output, passages, { kind, max: count, topics: [...topics, ...picked.focus] });
    const saved = norm ? await save(norm.questions) : null;
    if (saved) return { ok: true, result: { status: "made", quizId: saved.quiz.id, title, count: saved.count, requested: count, cached: true, from: picked.from, quota: await quota() } };
  }

  if (mode === "off") return result({ status: "not_configured" });
  const day = await studentDay(repo);
  if (!(await repo.reserveAi(day, "quiz", DAILY_LIMITS.quiz, DAILY_ATTEMPTS.quiz))) return result({ status: "limit" });
  let ok = false;
  let tokens = { input: 0, output: 0 };
  try {
    const out = await runAiTask(quizTask(passages, { count, kind, topics, focus: picked.focus }), appBudget(repo));
    if (!out.ok) return result({ status: out.reason });
    tokens = { input: out.inputTokens, output: out.outputTokens };
    if (JSON.stringify(out.raw).length <= MAX_CACHE_BYTES) await repo.putAiCache("quiz", hash, out.model, out.raw);
    // Weak questions were dropped, never replaced: under 3 good ones is "too little text" (go refunded below).
    const saved = await save(out.value.questions);
    if (!saved) return result({ status: "too_short" });
    ok = true;
    await repo.settleAi(day, "quiz", true, tokens.input, tokens.output);
    return { ok: true, result: { status: "made", quizId: saved.quiz.id, title, count: saved.count, requested: count, cached: false, from: picked.from, quota: await quota() } };
  } finally {
    if (!ok) await repo.settleAi(day, "quiz", false, tokens.input, tokens.output);
  }
}

export async function quizQuota(): Promise<Quota> {
  return quotaFor(await getRepo(), "quiz");
}

// ---- taking a quiz ----------------------------------------------------------------

/** The quiz, if it is the student's and on the shelf. */
async function liveQuiz(repo: Repo, quizId: string) {
  const quiz = await repo.getQuiz(quizId);
  return quiz && !quiz.deletedAt ? quiz : null;
}

/**
 * Starts an attempt (called by the quiz screen on arrival, never by rendering the page, so a
 * prefetch can't make rows). Without `fresh` it resumes the latest unfinished attempt.
 */
export async function startAttempt(raw: unknown): Promise<ActionResult<{ view: PlayView }>> {
  const parsed = startAttemptInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  const quiz = await liveQuiz(repo, parsed.data.quizId);
  if (!quiz) return { ok: false, error: "This quiz isn't here any more." };
  const attempts = await repo.listAttempts({ quizId: quiz.id });
  if (!parsed.data.fresh && attempts[0] && !attempts[0].finishedAt) return { ok: true, view: await playView(repo, quiz, attempts[0]) };
  const questions = (await repo.listQuestions({ quizId: quiz.id })).filter((q) => !q.removedAt);
  if (!questions.length) return { ok: false, error: "Every question in this quiz was taken out." };
  // Keep well under the database's 50 attempts per quiz: the oldest go first (weak topics stay).
  if (attempts.length >= KEEP_ATTEMPTS) await repo.deleteAttempts(attempts.slice(KEEP_ATTEMPTS - 1).map((a) => a.id));
  const attempt = await repo.createAttempt({ quizId: quiz.id, subjectId: quiz.subjectId, order: attemptOrder(questions, attempts.length > 0) });
  return { ok: true, view: await playView(repo, quiz, attempt) };
}

/** An attempt and one of its questions, both the student's and belonging together. */
async function attemptQuestion(repo: Repo, attemptId: string, questionId: string) {
  const [attempt, question] = await Promise.all([repo.getAttempt(attemptId), repo.getQuestion(questionId)]);
  if (!attempt || !question || question.quizId !== attempt.quizId) return null;
  const slot = attempt.order.find((s) => s.q === question.id);
  return slot ? { attempt, question, slot } : null;
}

async function questionsMap(repo: Repo, quizId: string) {
  return new Map((await repo.listQuestions({ quizId })).map((q) => [q.id, q]));
}

export type CheckResult = { feedback: Feedback; finished: boolean };

async function feedbackFor(repo: Repo, q: Question, slot: { o: number[] | null }, a: QuizAnswer): Promise<Feedback> {
  const [source] = await sourcesOf(repo, q.subjectId, [q]);
  return feedbackOf(q, slot, a, source);
}

/**
 * Checks one answer and saves it at once. The client key makes a double tap (or a retry after
 * a lost reply) return the first result instead of answering twice. Weak topics move only when
 * the answer is new.
 */
export async function checkAnswer(raw: unknown): Promise<ActionResult<CheckResult>> {
  const parsed = checkAnswerInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  const repo = await getRepo();
  const found = await attemptQuestion(repo, input.attemptId, input.questionId);
  if (!found) return { ok: false, error: "That question isn't in this quiz." };
  const { attempt, question: q, slot } = found;
  if (q.removedAt) return { ok: false, error: "That question was taken out of this quiz." };
  const quiz = await liveQuiz(repo, attempt.quizId);
  if (!quiz) return { ok: false, error: "This quiz isn't here any more." };

  const earlier = (await repo.listAnswers({ attemptIds: [attempt.id] })).find((a) => a.questionId === q.id);
  if (earlier) return { ok: true, feedback: await feedbackFor(repo, q, slot, earlier), finished: !!attempt.finishedAt };

  let correct = false;
  let typo = false;
  let choice: number | null = null;
  let given = "";
  const dontKnow = !!input.dontKnow;
  if (!dontKnow) {
    if (q.type === "mcq") {
      if (input.choice === undefined || !q.options) return { ok: false, error: "Pick an answer." };
      // The client sends the option as shown; map it back to the question's own order.
      choice = slot.o ? slot.o[input.choice] ?? null : input.choice;
      if (choice === null) return { ok: false, error: "Pick an answer." };
      correct = choice === q.correctIndex;
      given = q.options[choice] ?? "";
    } else {
      given = (input.text ?? "").trim();
      if (!given) return { ok: false, error: "Type an answer." };
      const m = matchFill(given, q.answer, q.accepted);
      correct = m.correct;
      typo = m.typo;
    }
  }

  // Weak topics (weak-topics.md "Tracking rules"): a miss counts, a right answer helps an open topic.
  const key = topicKey(q.topic);
  const current = await repo.findWeakTopic(q.subjectId, key);
  const now = new Date().toISOString();
  let weakPrev: WeakPrev | null = null;
  let nextTopic = null;
  if (!correct) {
    const miss = applyMiss(current, q.topic, q.chunkId, now);
    weakPrev = miss.prev;
    nextTopic = miss.next;
  } else {
    nextTopic = applyRight(current, now);
  }

  const { answer, created } = await repo.addAnswer({
    attemptId: attempt.id, questionId: q.id, subjectId: q.subjectId, clientKey: input.clientKey,
    given: given.slice(0, 300), choice, dontKnow, correct, typo, overridden: false, weakPrev,
  });
  if (answer.questionId !== q.id || answer.attemptId !== attempt.id) return { ok: false, error: "That answer was already used. Reload the quiz." };
  if (created && nextTopic) await repo.saveWeakTopic(q.subjectId, nextTopic, current?.id);

  const [questions, answers] = await Promise.all([questionsMap(repo, quiz.id), repo.listAnswers({ attemptIds: [attempt.id] })]);
  // No revalidatePath here: the quiz screen keeps its own state, and a refresh would remount it.
  const finished = await settleAttempt(repo, attempt, questions, answers);
  return { ok: true, feedback: await feedbackFor(repo, q, slot, answer), finished };
}

/** Takes a miss back out of weak topics (override or a reported question). */
async function undoWeakMiss(repo: Repo, q: Question, a: QuizAnswer) {
  if (!a.weakPrev) return;
  const topic = await repo.findWeakTopic(q.subjectId, topicKey(q.topic));
  if (!topic) return;
  const next = undoMiss(topic, a.weakPrev);
  if (next) await repo.saveWeakTopic(q.subjectId, next, topic.id);
  else await repo.deleteWeakTopic(topic.id);
}

/**
 * "I think my answer is right" (quiz.md): wrong fill-ins only. Counts it right, takes the miss
 * back out of weak topics, and accepts that answer next time.
 */
export async function overrideAnswer(raw: unknown): Promise<ActionResult<CheckResult>> {
  const parsed = attemptQuestionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  const found = await attemptQuestion(repo, parsed.data.attemptId, parsed.data.questionId);
  if (!found) return { ok: false, error: "That question isn't in this quiz." };
  const { attempt, question: q, slot } = found;
  const a = (await repo.listAnswers({ attemptIds: [attempt.id] })).find((x) => x.questionId === q.id);
  if (!a) return { ok: false, error: "Answer the question first." };
  if (a.overridden || a.correct) return { ok: true, feedback: await feedbackFor(repo, q, slot, a), finished: !!attempt.finishedAt };
  if (q.type !== "fill" || a.dontKnow || !a.given.trim()) return { ok: false, error: "Only typed answers can be counted as right." };

  await repo.updateAnswer(a.id, { correct: true, overridden: true });
  await undoWeakMiss(repo, q, a);
  const norm = normaliseAnswer(a.given);
  if (q.accepted.length < ACCEPTED_DB_MAX && normaliseAnswer(q.answer) !== norm && !q.accepted.some((x) => normaliseAnswer(x) === norm)) {
    await repo.updateQuestion(q.id, { accepted: [...q.accepted, a.given.trim().slice(0, 60)] });
  }
  const [questions, answers] = await Promise.all([questionsMap(repo, q.quizId), repo.listAnswers({ attemptIds: [attempt.id] })]);
  const finished = await settleAttempt(repo, attempt, questions, answers);
  const updated = answers.find((x) => x.id === a.id) ?? { ...a, correct: true, overridden: true };
  return { ok: true, feedback: await feedbackFor(repo, questions.get(q.id) ?? q, slot, updated), finished };
}

/**
 * "Report a problem": takes the question out of this quiz (not scored). A miss it caused in
 * this attempt is taken back out of weak topics, since the question itself was the problem.
 */
export async function reportQuestion(raw: unknown): Promise<ActionResult<{ finished: boolean; remaining: number }>> {
  const parsed = reportQuestionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  const found = await attemptQuestion(repo, parsed.data.attemptId, parsed.data.questionId);
  if (!found) return { ok: false, error: "That question isn't in this quiz." };
  const { attempt, question: q } = found;
  if (!q.removedAt) {
    await repo.updateQuestion(q.id, { removedAt: new Date().toISOString() });
    const a = (await repo.listAnswers({ attemptIds: [attempt.id] })).find((x) => x.questionId === q.id);
    if (a && !a.correct) await undoWeakMiss(repo, q, a);
  }
  return settleAfterChange(repo, attempt);
}

async function settleAfterChange(repo: Repo, attempt: QuizAttempt): Promise<ActionResult<{ finished: boolean; remaining: number }>> {
  const [questions, answers] = await Promise.all([questionsMap(repo, attempt.quizId), repo.listAnswers({ attemptIds: [attempt.id] })]);
  const finished = await settleAttempt(repo, attempt, questions, answers);
  const remaining = [...questions.values()].filter((q) => !q.removedAt).length;
  return { ok: true, finished, remaining };
}

/** Results of a finished attempt (the quiz screen swaps to them after the last answer). */
export async function attemptResults(attemptId: string): Promise<ActionResult<{ results: ResultsView }>> {
  if (!idSchema.safeParse(attemptId).success) return { ok: false, error: "Results not found." };
  const repo = await getRepo();
  const attempt = await repo.getAttempt(attemptId);
  const quiz = attempt ? await liveQuiz(repo, attempt.quizId) : null;
  if (!attempt || !quiz) return { ok: false, error: "Results not found." };
  return { ok: true, results: await resultsView(repo, quiz, attempt) };
}

// ---- shelf and results actions ------------------------------------------------------

export async function deleteQuiz(quizId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(quizId).success) return { ok: false, error: "Quiz not found." };
  const repo = await getRepo();
  const quiz = await repo.getQuiz(quizId);
  if (!quiz) return { ok: false, error: "Quiz not found." };
  await repo.setQuizDeleted(quiz.id, true);
  revalidatePath(`/subjects/${quiz.subjectId}`);
  return { ok: true };
}

/** Undo for delete. */
export async function restoreQuiz(quizId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(quizId).success) return { ok: false, error: "Quiz not found." };
  const repo = await getRepo();
  const quiz = await repo.getQuiz(quizId);
  if (!quiz) return { ok: false, error: "That quiz is gone for good." };
  await repo.setQuizDeleted(quiz.id, false);
  revalidatePath(`/subjects/${quiz.subjectId}`);
  return { ok: true };
}

/** "Edit question" on the results list: saves to the quiz (chip "Edited"). */
export async function editQuestion(raw: unknown): Promise<ActionResult> {
  const parsed = editQuestionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  const repo = await getRepo();
  const q = await repo.getQuestion(input.questionId);
  if (!q || !(await liveQuiz(repo, q.quizId))) return { ok: false, error: "That question isn't here any more." };
  if (q.type === "mcq") {
    if (!input.options || input.correctIndex === undefined) return { ok: false, error: "Fill in every option and pick the right one." };
    if (new Set(input.options.map(normaliseAnswer)).size !== 4) return { ok: false, error: "Make the four options different." };
    await repo.updateQuestion(q.id, { prompt: input.prompt, explanation: input.explanation, options: input.options, correctIndex: input.correctIndex, answer: input.options[input.correctIndex], edited: true });
  } else {
    if (!input.answer) return { ok: false, error: "Add the answer." };
    const accepted = [...new Set((input.accepted ?? []).filter((a) => normaliseAnswer(a) && normaliseAnswer(a) !== normaliseAnswer(input.answer!)))];
    await repo.updateQuestion(q.id, { prompt: input.prompt, explanation: input.explanation, answer: input.answer, accepted, edited: true });
  }
  return { ok: true };
}

/** "Remove from quiz" on the results list: not scored next time. */
export async function removeQuestion(raw: unknown): Promise<ActionResult<{ finished: boolean; remaining: number }>> {
  const parsed = attemptQuestionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  const found = await attemptQuestion(repo, parsed.data.attemptId, parsed.data.questionId);
  if (!found) return { ok: false, error: "That question isn't in this quiz." };
  if (!found.question.removedAt) await repo.updateQuestion(found.question.id, { removedAt: new Date().toISOString() });
  return settleAfterChange(repo, found.attempt);
}
