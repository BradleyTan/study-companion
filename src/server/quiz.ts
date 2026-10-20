import "server-only";
import { band, type Band, type QuestionType, type QuizKind } from "@/lib/quiz/order";
import { GOT_IT_DAYS, sortOpen, topicKey } from "@/lib/quiz/weak";
import { passageHref, type CardSourceInfo } from "./cards";
import type { ChunkRow, Question, Quiz, QuizAnswer, QuizAttempt, Repo, WeakTopic } from "./repo/types";

// What the quiz screens see (quiz-builder.md, quiz.md, weak-topics.md). A question's answer,
// accepted answers and explanation only leave the server in feedback for a question the
// student has answered (or in results), never with the question itself.

/** A question as the quiz screen shows it before it is answered. */
export type PlayQuestion = { id: string; type: QuestionType; prompt: string; options: string[] | null; topic: string };

/** What the server says after an answer is checked. */
export type Feedback = {
  questionId: string;
  answerId: string;
  correct: boolean;
  typo: boolean;
  dontKnow: boolean;
  overridden: boolean;
  /** What the student answered (the option's text, or what they typed). */
  given: string;
  /** Multiple choice: the student's option and the right one, as shown in this attempt. */
  choice: number | null;
  correctChoice: number | null;
  /** The right option or the expected fill-in answer. */
  answer: string;
  explanation: string;
  quote: string | null;
  source: CardSourceInfo;
  topic: string;
  /** "I think my answer is right" (wrong fill-ins with something typed). */
  canOverride: boolean;
};

export type PlayView = {
  quizId: string;
  attemptId: string;
  title: string;
  kind: QuizKind;
  startedAt: string;
  questions: PlayQuestion[];
  feedback: Record<string, Feedback>;
  finished: boolean;
};

export type ResultRow = {
  questionId: string;
  type: QuestionType;
  prompt: string;
  /** In the question's own order (for editing). */
  options: string[] | null;
  correctIndex: number | null;
  answer: string;
  accepted: string[];
  explanation: string;
  quote: string | null;
  source: CardSourceInfo;
  topic: string;
  correct: boolean;
  dontKnow: boolean;
  overridden: boolean;
  given: string;
  edited: boolean;
};

export type ResultsView = {
  quizId: string;
  attemptId: string;
  title: string;
  score: number;
  total: number;
  minutes: number;
  band: Band;
  /** Open weak topics missed in this attempt ("Added to your weak topics"). */
  added: { key: string; name: string }[];
  /** Weak topics answered right here that are one right answer from clearing. */
  stronger: { key: string; name: string }[];
  rows: ResultRow[];
};

// ---- sources ---------------------------------------------------------------------

/** Where questions came from, with titles (one lookup per subject). */
export async function sourcesOf(repo: Repo, subjectId: string, items: { noteId: string | null; sourceId: string | null; chunkId: string | null; page: number | null }[]): Promise<CardSourceInfo[]> {
  const needNotes = items.some((i) => i.noteId);
  const needFiles = items.some((i) => i.sourceId);
  const [notes, files] = await Promise.all([needNotes ? repo.listNotes(subjectId) : [], needFiles ? repo.listSources(subjectId) : []]);
  const noteTitles = new Map(notes.map((n) => [n.id, n.title || "Untitled note"]));
  const fileNames = new Map(files.map((f) => [f.id, f.fileName]));
  return items.map((i) => {
    const href = passageHref(subjectId, { noteId: i.noteId, sourceId: i.sourceId, chunkId: i.chunkId });
    if (i.noteId && href && noteTitles.has(i.noteId)) return { kind: "note", title: noteTitles.get(i.noteId)!, href };
    if (i.sourceId && href && fileNames.has(i.sourceId)) return { kind: "file", title: fileNames.get(i.sourceId)!, page: i.page, href };
    return { kind: "deleted" };
  });
}

// ---- attempts ----------------------------------------------------------------------

/** Questions of an attempt that still count (not removed), in the attempt's order. */
export function liveSlots(attempt: QuizAttempt, questions: Map<string, Question>) {
  return attempt.order.filter((s) => { const q = questions.get(s.q); return q && !q.removedAt; });
}

export function feedbackOf(q: Question, slot: { o: number[] | null } | undefined, a: QuizAnswer, source: CardSourceInfo): Feedback {
  const shown = (i: number | null) => (i === null || !slot?.o ? i : slot.o.indexOf(i));
  const given = q.type === "mcq" ? (a.choice !== null && q.options ? q.options[a.choice] ?? "" : "") : a.given;
  return {
    questionId: q.id, answerId: a.id, correct: a.correct, typo: a.typo, dontKnow: a.dontKnow, overridden: a.overridden, given,
    choice: q.type === "mcq" ? shown(a.choice) : null,
    correctChoice: q.type === "mcq" ? shown(q.correctIndex) : null,
    answer: q.answer, explanation: q.explanation, quote: q.sourceQuote, source, topic: q.topic,
    canOverride: q.type === "fill" && !a.correct && !a.dontKnow && a.given.trim().length > 0,
  };
}

/** The score of an attempt: right answers among the questions that still count. */
export function scoreOf(attempt: QuizAttempt, questions: Map<string, Question>, answers: QuizAnswer[]) {
  const live = liveSlots(attempt, questions);
  const ids = new Set(live.map((s) => s.q));
  const mine = answers.filter((a) => a.attemptId === attempt.id && ids.has(a.questionId));
  return { total: live.length, answered: mine.length, score: mine.filter((a) => a.correct).length };
}

/** Finishes the attempt once every question that counts is answered; keeps a finished score current. */
export async function settleAttempt(repo: Repo, attempt: QuizAttempt, questions: Map<string, Question>, answers: QuizAnswer[]): Promise<boolean> {
  const s = scoreOf(attempt, questions, answers);
  const done = s.total > 0 && s.answered >= s.total;
  if (done && (!attempt.finishedAt || attempt.score !== s.score || attempt.total !== s.total)) {
    await repo.updateAttempt(attempt.id, { finishedAt: attempt.finishedAt ?? new Date().toISOString(), score: s.score, total: s.total });
  }
  return done;
}

export async function playView(repo: Repo, quiz: Quiz, attempt: QuizAttempt): Promise<PlayView> {
  const [questions, answers] = await Promise.all([repo.listQuestions({ quizId: quiz.id }), repo.listAnswers({ attemptIds: [attempt.id] })]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const slots = liveSlots(attempt, byId);
  const answered = answers.filter((a) => byId.has(a.questionId));
  const sources = await sourcesOf(repo, quiz.subjectId, answered.map((a) => byId.get(a.questionId)!));
  const feedback: Record<string, Feedback> = {};
  answered.forEach((a, i) => {
    const q = byId.get(a.questionId)!;
    if (!q.removedAt) feedback[q.id] = feedbackOf(q, slots.find((s) => s.q === q.id), a, sources[i]);
  });
  return {
    quizId: quiz.id, attemptId: attempt.id, title: quiz.title, kind: quiz.kind, startedAt: attempt.startedAt,
    questions: slots.map((s) => {
      const q = byId.get(s.q)!;
      return { id: q.id, type: q.type, prompt: q.prompt, topic: q.topic, options: q.options && s.o ? s.o.map((i) => q.options![i]) : q.options };
    }),
    feedback,
    finished: !!attempt.finishedAt,
  };
}

export async function resultsView(repo: Repo, quiz: Quiz, attempt: QuizAttempt): Promise<ResultsView> {
  const [questions, answers, topics] = await Promise.all([
    repo.listQuestions({ quizId: quiz.id }), repo.listAnswers({ attemptIds: [attempt.id] }), repo.listWeakTopics(quiz.subjectId),
  ]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const slots = liveSlots(attempt, byId);
  const answerOf = new Map(answers.map((a) => [a.questionId, a]));
  const live = slots.map((s) => byId.get(s.q)!);
  const sources = await sourcesOf(repo, quiz.subjectId, live);
  const s = scoreOf(attempt, byId, answers);
  const open = new Map(topics.filter((t) => !t.clearedAt).map((t) => [t.topicKey, t]));
  const added = new Map<string, string>();
  const stronger = new Map<string, string>();
  for (const q of live) {
    const a = answerOf.get(q.id);
    const t = open.get(topicKey(q.topic));
    if (!a || !t) continue;
    if (!a.correct) added.set(t.topicKey, t.topic);
    else if (t.rightStreak === 1) stronger.set(t.topicKey, t.topic);
  }
  for (const k of added.keys()) stronger.delete(k);
  const end = attempt.finishedAt ?? new Date().toISOString();
  return {
    quizId: quiz.id, attemptId: attempt.id, title: quiz.title, score: s.score, total: s.total,
    minutes: Math.max(1, Math.round((Date.parse(end) - Date.parse(attempt.startedAt)) / 60_000)),
    band: band(s.score, s.total),
    added: [...added].map(([key, name]) => ({ key, name })),
    stronger: [...stronger].map(([key, name]) => ({ key, name })),
    rows: live.map((q, i) => {
      const a = answerOf.get(q.id);
      return {
        questionId: q.id, type: q.type, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, answer: q.answer, accepted: q.accepted,
        explanation: q.explanation, quote: q.sourceQuote, source: sources[i], topic: q.topic, edited: q.edited,
        correct: !!a?.correct, dontKnow: !!a?.dontKnow, overridden: !!a?.overridden,
        given: q.type === "mcq" ? (a?.choice !== null && a?.choice !== undefined && q.options ? q.options[a.choice] ?? "" : "") : a?.given ?? "",
      };
    }),
  };
}

// ---- shelf, subject page, weak topics ----------------------------------------------

export type ShelfQuiz = {
  id: string;
  title: string;
  kind: QuizKind;
  questionCount: number;
  createdAt: string;
  best: { score: number; total: number } | null;
  tries: number;
  /** The latest attempt, when it isn't finished. */
  unfinished: { attemptId: string; answered: number; total: number } | null;
  /** The latest finished attempt ("See last results"). */
  lastFinished: string | null;
};

export type WeakSummary = { count: number; names: string[] };

/** The shelf: quizzes newest first, with best scores, tries and unfinished attempts. */
export async function shelf(repo: Repo, subjectId: string): Promise<{ quizzes: ShelfQuiz[]; weak: WeakSummary }> {
  const [quizzes, attempts, topics] = await Promise.all([repo.listQuizzes(subjectId), repo.listAttempts({ subjectId }), repo.listWeakTopics(subjectId)]);
  const ids = quizzes.map((q) => q.id);
  const questions = ids.length ? await repo.listQuestions({ quizIds: ids }) : [];
  const latest = new Map<string, QuizAttempt>();
  for (const a of attempts) if (!latest.has(a.quizId)) latest.set(a.quizId, a);
  const openAttempts = [...latest.values()].filter((a) => !a.finishedAt);
  const answers = openAttempts.length ? await repo.listAnswers({ attemptIds: openAttempts.map((a) => a.id) }) : [];
  const byQuiz = new Map<string, Map<string, Question>>();
  for (const q of questions) {
    const m = byQuiz.get(q.quizId) ?? new Map<string, Question>();
    m.set(q.id, q);
    byQuiz.set(q.quizId, m);
  }
  return {
    quizzes: quizzes.map((quiz) => {
      const qs = byQuiz.get(quiz.id) ?? new Map<string, Question>();
      const finished = attempts.filter((a) => a.quizId === quiz.id && a.finishedAt && a.total);
      const best = finished.reduce<{ score: number; total: number } | null>((b, a) => {
        const cur = { score: a.score ?? 0, total: a.total ?? 0 };
        return !b || cur.score / cur.total > b.score / b.total ? cur : b;
      }, null);
      const last = latest.get(quiz.id);
      const s = last && !last.finishedAt ? scoreOf(last, qs, answers) : null;
      return {
        id: quiz.id, title: quiz.title, kind: quiz.kind, createdAt: quiz.createdAt,
        questionCount: [...qs.values()].filter((q) => !q.removedAt).length,
        best, tries: finished.length,
        unfinished: last && s && !last.finishedAt ? { attemptId: last.id, answered: s.answered, total: s.total } : null,
        lastFinished: finished[0]?.id ?? null,
      };
    }),
    weak: weakSummary(topics),
  };
}

export function weakSummary(topics: WeakTopic[]): WeakSummary {
  const open = sortOpen(topics.filter((t) => !t.clearedAt));
  return { count: open.length, names: open.map((t) => t.topic) };
}

/** Subject page: the Quizzes tile line and the weak-topics strip. */
export async function subjectQuizSummary(repo: Repo, subjectId: string): Promise<{ quizzes: number; best: { score: number; total: number } | null; tries: number; unfinished: { answered: number; total: number } | null; weak: WeakSummary }> {
  const { quizzes, weak } = await shelf(repo, subjectId);
  const tries = quizzes.reduce((n, q) => n + q.tries, 0);
  const best = quizzes.reduce<{ score: number; total: number } | null>((b, q) => (q.best && (!b || q.best.score / q.best.total > b.score / b.total) ? q.best : b), null);
  const open = quizzes.find((q) => q.unfinished && q.unfinished.answered > 0)?.unfinished ?? null;
  return { quizzes: quizzes.length, best, tries, unfinished: open ? { answered: open.answered, total: open.total } : null, weak };
}

export type TopicSource = { key: string } & ({ kind: "note"; title: string; href: string } | { kind: "file"; title: string; page: number | null; href: string } | { kind: "deleted" });
export type TopicView = {
  id: string;
  topic: string;
  key: string;
  missCount: number;
  rightStreak: number;
  lastMissedAt: string | null;
  clearedAt: string | null;
  recent: boolean[];
  sources: TopicSource[];
};

/** The weak-topics page: open topics (most recent miss first) and those cleared in the last 60 days. */
export async function weakTopicsView(repo: Repo, subjectId: string, now = new Date()): Promise<{ open: TopicView[]; gotIt: TopicView[]; hasQuizzes: boolean; hasAttempts: boolean }> {
  const [topics, quizzes, attempts] = await Promise.all([repo.listWeakTopics(subjectId), repo.listQuizzes(subjectId), repo.listAttempts({ subjectId })]);
  const chunkIds = [...new Set(topics.flatMap((t) => t.chunkIds))];
  const chunks = chunkIds.length ? await repo.getChunks(chunkIds) : [];
  const byChunk = new Map<string, ChunkRow>(chunks.filter((c) => c.subjectId === subjectId).map((c) => [c.id, c]));
  const infos = await sourcesOf(repo, subjectId, chunks.map((c) => ({ noteId: c.noteId, sourceId: c.sourceId, chunkId: c.id, page: c.page })));
  const infoOf = new Map(chunks.map((c, i) => [c.id, infos[i]]));
  const view = (t: WeakTopic): TopicView => {
    const seen = new Set<string>();
    const sources: TopicSource[] = [];
    for (const id of t.chunkIds) {
      const c = byChunk.get(id);
      const info = c ? infoOf.get(id) : undefined;
      // One link per note, or per page of a file; gone passages show one "Source deleted" chip.
      const key = !c || !info || info.kind === "deleted" || info.kind === "manual" ? "deleted" : `${c.noteId ?? c.sourceId}|${c.page ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(key === "deleted" || !info || info.kind === "manual" || info.kind === "deleted" ? { key, kind: "deleted" } : { key, ...info });
    }
    return { id: t.id, topic: t.topic, key: t.topicKey, missCount: t.missCount, rightStreak: t.rightStreak, lastMissedAt: t.lastMissedAt, clearedAt: t.clearedAt, recent: t.recent, sources };
  };
  const cutoff = now.getTime() - GOT_IT_DAYS * 86_400_000;
  return {
    open: sortOpen(topics.filter((t) => !t.clearedAt)).map(view),
    gotIt: topics.filter((t) => t.clearedAt && Date.parse(t.clearedAt) >= cutoff).sort((a, b) => b.clearedAt!.localeCompare(a.clearedAt!)).map(view),
    hasQuizzes: quizzes.length > 0,
    hasAttempts: attempts.length > 0,
  };
}
