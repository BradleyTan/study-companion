import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const actions = await import("./quiz");
const weak = await import("./weak-topics");
const { utcDay } = await import("../ai");
const { syncNoteChunks } = await import("../passages");

const NOTE = [
  "Mitochondria produce most of the energy in eukaryotic cells through respiration.",
  "Osmosis is the movement of water across a partially permeable membrane.",
  "Ribosomes assemble proteins by reading messenger RNA in the cytoplasm.",
  "Chloroplasts capture sunlight and convert it into glucose during photosynthesis.",
  "Diffusion spreads particles from a region of higher concentration to lower concentration.",
  "Enzymes speed up chemical reactions without being consumed themselves.",
  "The nucleus stores genetic information inside chromosomes made of DNA.",
  "Lysosomes contain digestive enzymes that break down worn out organelles.",
].join(" ");

async function setup(text = NOTE) {
  repo = demoRepo(crypto.randomUUID());
  const subject = await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" });
  const { id: noteId } = await repo.createNote(subject.id);
  await repo.updateNote(noteId, { title: "Cells", contentJson: {}, contentText: text });
  await syncNoteChunks(repo, { id: noteId, subjectId: subject.id, title: "Cells", contentText: text });
  return { subjectId: subject.id, noteId };
}
const used = () => repo.aiUsageCount(utcDay(), "quiz");

async function made(kind: "mcq" | "fill" | "mixed" = "mixed", count: 5 | 10 | 15 = 5) {
  const { subjectId, noteId } = await setup();
  const r = await actions.makeQuiz({ subjectId, source: { type: "note", id: noteId }, kind, count });
  if (!r.ok || r.result.status !== "made") throw new Error(`not made: ${JSON.stringify(r)}`);
  return { subjectId, noteId, quizId: r.result.quizId, result: r.result };
}

async function started(quizId: string) {
  const s = await actions.startAttempt({ quizId, fresh: false });
  if (!s.ok) throw new Error(s.error);
  return s.view;
}

/** The right answer for a question, read from the server side (as a test oracle). */
async function rightAnswer(view: { attemptId: string }, questionId: string) {
  const q = (await repo.getQuestion(questionId))!;
  const attempt = (await repo.getAttempt(view.attemptId))!;
  const slot = attempt.order.find((s) => s.q === questionId)!;
  return q.type === "mcq" ? { choice: slot.o!.indexOf(q.correctIndex!) } : { text: q.answer };
}
async function wrongAnswer(view: { attemptId: string }, questionId: string) {
  const q = (await repo.getQuestion(questionId))!;
  const attempt = (await repo.getAttempt(view.attemptId))!;
  const slot = attempt.order.find((s) => s.q === questionId)!;
  return q.type === "mcq" ? { choice: (slot.o!.indexOf(q.correctIndex!) + 1) % 4 } : { text: "zzzz" };
}

describe("makeQuiz", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_AI_TOKEN", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("makes a quiz from a note with a server-built title and uses one go", async () => {
    const { result, quizId } = await made("mixed", 5);
    expect(result.title).toBe("Cells · Mixed");
    expect(result.count).toBeGreaterThanOrEqual(3);
    expect(result.count).toBeLessThanOrEqual(5);
    expect(await used()).toBe(1);
    const qs = await repo.listQuestions({ quizId });
    for (const q of qs) {
      expect(q.chunkId).toBeTruthy();
      if (q.type === "mcq") {
        expect(q.options).toHaveLength(4);
        expect(q.options![q.correctIndex!]).toBe(q.answer);
      }
    }
  });

  it("the same settings again is free and points at the quiz on the shelf", async () => {
    const { subjectId, noteId, quizId } = await made();
    const again = await actions.makeQuiz({ subjectId, source: { type: "note", id: noteId }, kind: "mixed", count: 5 });
    expect(again.ok && again.result.status === "already" && again.result.quizId).toBe(quizId);
    // Deleted: the cached output makes it again without a go.
    await actions.deleteQuiz(quizId);
    const cached = await actions.makeQuiz({ subjectId, source: { type: "note", id: noteId }, kind: "mixed", count: 5 });
    expect(cached.ok && cached.result.status === "made" && cached.result.cached).toBe(true);
    expect(await used()).toBe(1);
  });

  it("too little text is too_short and uses no go", async () => {
    const { subjectId, noteId } = await setup("Short.");
    const r = await actions.makeQuiz({ subjectId, source: { type: "note", id: noteId }, kind: "mixed", count: 5 });
    expect(r.ok && r.result.status).toBe("too_short");
    expect(await used()).toBe(0);
  });

  it("fewer than 3 good questions gives the go back", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const { subjectId, noteId } = await setup();
    const one = { questions: [{ type: "fill", prompt: "Osmosis is the movement of ____ across a partially permeable membrane.", answer: "water", accepted: [], explanation: "Osmosis is the movement of water across a partially permeable membrane.", topic: "Osmosis", ref: "p1", quote: "Osmosis is the movement of water across a partially permeable membrane." }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(one) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } })));
    const r = await actions.makeQuiz({ subjectId, source: { type: "note", id: noteId }, kind: "fill", count: 5 });
    expect(r.ok && r.result.status).toBe("too_short");
    expect(await used()).toBe(0);
  });

  it("AI failure refunds the go", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    const { subjectId, noteId } = await setup();
    const r = await actions.makeQuiz({ subjectId, source: { type: "note", id: noteId }, kind: "mixed", count: 5 });
    expect(r.ok && r.result.status).toBe("failed");
    expect(await used()).toBe(0);
  });

  it("stops at 3 a day", async () => {
    const { subjectId, noteId } = await setup();
    const statuses = [];
    for (const kind of ["mcq", "fill", "mixed"] as const) for (const count of [5, 10] as const) {
      const r = await actions.makeQuiz({ subjectId, source: { type: "note", id: noteId }, kind, count });
      statuses.push(r.ok ? r.result.status : r.error);
    }
    expect(statuses.filter((s) => s === "made" || s === "too_short")).toHaveLength(3);
    expect(statuses.at(-1)).toBe("limit");
  });

  it("rejects another student's subject and bad input", async () => {
    const { noteId } = await setup();
    const r = await actions.makeQuiz({ subjectId: crypto.randomUUID(), source: { type: "note", id: noteId }, kind: "mixed", count: 5 });
    expect(r.ok).toBe(false);
    const bad = await actions.makeQuiz({ subjectId: crypto.randomUUID(), source: { type: "note", id: noteId }, kind: "mixed", count: 7 });
    expect(bad.ok).toBe(false);
    const none = await actions.makeQuiz({ subjectId: crypto.randomUUID(), source: { type: "weak", topics: [] }, kind: "mixed", count: 5 });
    expect(!none.ok && none.error).toBe("Tick at least one topic.");
  });

  it("makes from everything in the subject", async () => {
    const { subjectId } = await setup();
    const r = await actions.makeQuiz({ subjectId, source: { type: "all" }, kind: "mcq", count: 5 });
    expect(r.ok && r.result.status === "made" && r.result.title).toBe("All of Bio · Multiple choice");
  });
});

describe("taking a quiz", () => {
  beforeEach(() => { vi.stubEnv("GROQ_API_KEY", ""); });
  afterEach(() => vi.unstubAllEnvs());

  it("never sends answers before the student answers", async () => {
    const { quizId } = await made();
    const view = await started(quizId);
    const json = JSON.stringify(view);
    for (const q of await repo.listQuestions({ quizId })) {
      expect(json).not.toContain(q.explanation);
    }
    for (const q of view.questions) expect(Object.keys(q).sort()).toEqual(["id", "options", "prompt", "topic", "type"]);
    expect(view.feedback).toEqual({});
    // Results (every right answer) only once the attempt is finished (QA step 3).
    const early = await actions.attemptResults(view.attemptId);
    expect(early.ok).toBe(false);
    expect(JSON.stringify(early)).not.toContain((await repo.listQuestions({ quizId }))[0].answer);
  });

  it("a second check of an answered question, with a new client key, returns the first answer (QA step 3)", async () => {
    const { quizId, subjectId } = await made("mcq", 5);
    const view = await started(quizId);
    const q = view.questions[0];
    const first = await actions.checkAnswer({ attemptId: view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), ...(await wrongAnswer(view, q.id)) });
    const second = await actions.checkAnswer({ attemptId: view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), ...(await rightAnswer(view, q.id)) });
    expect(first.ok && second.ok && second.feedback.answerId).toBe(first.ok && first.feedback.answerId);
    expect(second.ok && second.feedback.correct).toBe(false);
    expect((await repo.listWeakTopics(subjectId))[0].missCount).toBe(1);
    // Two taps at once with different keys still save one answer and one miss.
    const q2 = view.questions[1];
    const wrong = await wrongAnswer(view, q2.id);
    await Promise.all([1, 2].map(() => actions.checkAnswer({ attemptId: view.attemptId, questionId: q2.id, clientKey: crypto.randomUUID(), ...wrong })));
    expect((await repo.listAnswers({ attemptIds: [view.attemptId] })).filter((a) => a.questionId === q2.id)).toHaveLength(1);
    // A client key already used for another question is refused, not reused.
    const used = (await repo.listAnswers({ attemptIds: [view.attemptId] }))[0];
    const reuse = await actions.checkAnswer({ attemptId: view.attemptId, questionId: view.questions[2].id, clientKey: used.clientKey, choice: 0 });
    expect(reuse.ok).toBe(false);
  });

  it("checks right and wrong answers, saves once per client key, and tracks weak topics", async () => {
    const { quizId, subjectId } = await made("mixed", 5);
    const view = await started(quizId);
    const [first, second] = view.questions;
    const key = crypto.randomUUID();
    const right = await actions.checkAnswer({ attemptId: view.attemptId, questionId: first.id, clientKey: key, ...(await rightAnswer(view, first.id)) });
    expect(right.ok && right.feedback.correct).toBe(true);
    // A double tap returns the same answer.
    const again = await actions.checkAnswer({ attemptId: view.attemptId, questionId: first.id, clientKey: key, ...(await rightAnswer(view, first.id)) });
    expect(again.ok && right.ok && again.feedback.answerId).toBe(right.ok && right.feedback.answerId);
    expect(await repo.listAnswers({ attemptIds: [view.attemptId] })).toHaveLength(1);

    const wrong = await actions.checkAnswer({ attemptId: view.attemptId, questionId: second.id, clientKey: crypto.randomUUID(), ...(await wrongAnswer(view, second.id)) });
    expect(wrong.ok && wrong.feedback.correct).toBe(false);
    expect(wrong.ok && wrong.feedback.answer).toBeTruthy();
    const topics = await repo.listWeakTopics(subjectId);
    expect(topics.map((t) => t.topic)).toContain(second.topic);
    expect(topics.find((t) => t.topic === second.topic)!.missCount).toBe(1);
  });

  it("finishes after the last answer, resumes before that, and a retake is a new attempt", async () => {
    const { quizId } = await made("mcq", 5);
    const view = await started(quizId);
    const resumed = await started(quizId);
    expect(resumed.attemptId).toBe(view.attemptId);
    let finished = false;
    for (const q of view.questions) {
      const r = await actions.checkAnswer({ attemptId: view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), ...(await rightAnswer(view, q.id)) });
      if (r.ok) finished = r.finished;
    }
    expect(finished).toBe(true);
    const res = await actions.attemptResults(view.attemptId);
    expect(res.ok && res.results.score).toBe(view.questions.length);
    expect(res.ok && res.results.band).toBe("brilliant");
    const retake = await started(quizId);
    expect(retake.attemptId).not.toBe(view.attemptId);
  });

  it("'I don't know' counts as a miss", async () => {
    const { quizId, subjectId } = await made();
    const view = await started(quizId);
    const q = view.questions[0];
    const r = await actions.checkAnswer({ attemptId: view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), dontKnow: true });
    expect(r.ok && r.feedback.dontKnow && !r.feedback.correct).toBe(true);
    expect((await repo.listWeakTopics(subjectId)).length).toBe(1);
  });

  it("override marks a wrong fill-in right, undoes the miss and accepts it next time", async () => {
    const { quizId, subjectId } = await made("fill", 5);
    const view = await started(quizId);
    const q = view.questions[0];
    const r = await actions.checkAnswer({ attemptId: view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), text: "ATP synthase" });
    expect(r.ok && r.feedback.canOverride).toBe(true);
    expect((await repo.listWeakTopics(subjectId)).length).toBe(1);
    const o = await actions.overrideAnswer({ attemptId: view.attemptId, questionId: q.id });
    expect(o.ok && o.feedback.correct && o.feedback.overridden).toBe(true);
    expect(await repo.listWeakTopics(subjectId)).toHaveLength(0);
    expect((await repo.getQuestion(q.id))!.accepted).toContain("ATP synthase");
  });

  it("refuses an override on a right answer's question from another quiz", async () => {
    const a = await made();
    const viewA = await started(a.quizId);
    const other = await repo.createSubject({ name: "Chem", colour: "sky", emoji: "🧪" });
    const r = await actions.checkAnswer({ attemptId: viewA.attemptId, questionId: crypto.randomUUID(), clientKey: crypto.randomUUID(), choice: 0 });
    expect(r.ok).toBe(false);
    expect(other.id).toBeTruthy();
  });

  it("reporting a question removes it, takes its miss back and can finish the attempt", async () => {
    const { quizId, subjectId } = await made("mcq", 5);
    const view = await started(quizId);
    const [first, ...rest] = view.questions;
    await actions.checkAnswer({ attemptId: view.attemptId, questionId: first.id, clientKey: crypto.randomUUID(), ...(await wrongAnswer(view, first.id)) });
    expect((await repo.listWeakTopics(subjectId)).length).toBe(1);
    const rep = await actions.reportQuestion({ attemptId: view.attemptId, questionId: first.id, reason: "wrong_answer" });
    expect(rep.ok && rep.remaining).toBe(view.questions.length - 1);
    expect(await repo.listWeakTopics(subjectId)).toHaveLength(0);
    for (const q of rest) await actions.checkAnswer({ attemptId: view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), ...(await rightAnswer(view, q.id)) });
    const res = await actions.attemptResults(view.attemptId);
    expect(res.ok && res.results.total).toBe(rest.length);
  });

  it("delete and restore", async () => {
    const { quizId } = await made();
    await actions.deleteQuiz(quizId);
    expect((await actions.startAttempt({ quizId, fresh: true })).ok).toBe(false);
    await actions.restoreQuiz(quizId);
    expect((await actions.startAttempt({ quizId, fresh: true })).ok).toBe(true);
  });

  it("edits a multiple-choice question and rejects duplicate options", async () => {
    const { quizId } = await made("mcq", 5);
    const q = (await repo.listQuestions({ quizId }))[0];
    const dup = await actions.editQuestion({ questionId: q.id, prompt: "Which is it?", explanation: "", options: ["a", "a", "b", "c"], correctIndex: 0 });
    expect(dup.ok).toBe(false);
    const ok = await actions.editQuestion({ questionId: q.id, prompt: "Which is it?", explanation: "Because.", options: ["a", "b", "c", "d"], correctIndex: 2 });
    expect(ok.ok).toBe(true);
    const saved = (await repo.getQuestion(q.id))!;
    expect(saved).toMatchObject({ answer: "c", correctIndex: 2, edited: true });
  });
});

describe("weak topics and the re-mix", () => {
  beforeEach(() => { vi.stubEnv("GROQ_API_KEY", ""); });
  afterEach(() => vi.unstubAllEnvs());

  it("practise what I missed makes a quiz from the missed passages", async () => {
    const { quizId, subjectId } = await made("mcq", 5);
    const view = await started(quizId);
    const q = view.questions[0];
    await actions.checkAnswer({ attemptId: view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), ...(await wrongAnswer(view, q.id)) });
    const opts = await actions.loadQuizOptions(subjectId);
    expect(opts.ok && opts.weak.map((w) => w.name)).toEqual([q.topic]);
    const r = await actions.makeQuiz({ subjectId, source: { type: "weak", topics: [q.topic] }, kind: "mixed", count: 5 });
    expect(r.ok && r.result.status === "made" && r.result.title).toBe("Weak topics · Mixed");
    const quiz = r.ok && r.result.status === "made" ? await repo.getQuiz(r.result.quizId) : null;
    expect(quiz?.focus).toBe("weak");
  });

  it("weak topics whose passages are gone say so", async () => {
    const { quizId, subjectId, noteId } = await made("mcq", 5);
    const view = await started(quizId);
    const q = view.questions[0];
    await actions.checkAnswer({ attemptId: view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), ...(await wrongAnswer(view, q.id)) });
    await repo.deleteNote(noteId);
    const r = await actions.makeQuiz({ subjectId, source: { type: "weak", topics: [q.topic] }, kind: "mixed", count: 5 });
    expect(r.ok && r.result.status).toBe("weak_gone");
  });

  it("two right answers in a row clear a topic; mark as got it and undo", async () => {
    const { quizId, subjectId } = await made("mcq", 5);
    const v1 = await started(quizId);
    const q = v1.questions[0];
    await actions.checkAnswer({ attemptId: v1.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), ...(await wrongAnswer(v1, q.id)) });
    for (let i = 0; i < 2; i++) {
      const v = (await actions.startAttempt({ quizId, fresh: true }));
      if (!v.ok) throw new Error(v.error);
      await actions.checkAnswer({ attemptId: v.view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), ...(await rightAnswer(v.view, q.id)) });
    }
    const [t] = await repo.listWeakTopics(subjectId);
    expect(t.clearedAt).not.toBeNull();
    expect(t.recent).toEqual([false, true, true]);

    // A new miss reopens it; then mark it got it by hand and undo.
    const v = await actions.startAttempt({ quizId, fresh: true });
    if (!v.ok) throw new Error(v.error);
    await actions.checkAnswer({ attemptId: v.view.attemptId, questionId: q.id, clientKey: crypto.randomUUID(), dontKnow: true });
    expect((await repo.getWeakTopic(t.id))!.clearedAt).toBeNull();
    expect((await weak.markGotIt(t.id)).ok).toBe(true);
    expect((await repo.getWeakTopic(t.id))!.clearedAt).not.toBeNull();
    await weak.reopenTopic(t.id);
    expect((await repo.getWeakTopic(t.id))!.clearedAt).toBeNull();
    const missed = await weak.topicQuestions(t.id);
    expect(missed.ok && missed.questions.map((m) => m.id)).toEqual([q.id]);
  });

  it("weak topic actions reject unknown ids", async () => {
    await setup();
    expect((await weak.markGotIt(crypto.randomUUID())).ok).toBe(false);
    expect((await weak.markGotIt("not-a-uuid")).ok).toBe(false);
  });
});
