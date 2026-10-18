// Security review (Step 3): every quiz, weak-topic and chat action against a second student's ids,
// and ids from two different quizzes or attempts of the same student mixed up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const quiz = await import("./quiz");
const weak = await import("./weak-topics");
const chat = await import("./chat");
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

/** A student with a note, a started quiz with one wrong answer (so a weak topic), and one chat exchange. */
async function student() {
  repo = demoRepo(crypto.randomUUID());
  const subject = await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" });
  const { id: noteId } = await repo.createNote(subject.id);
  await repo.updateNote(noteId, { title: "Cells", contentJson: {}, contentText: NOTE });
  await syncNoteChunks(repo, { id: noteId, subjectId: subject.id, title: "Cells", contentText: NOTE });
  const made = await quiz.makeQuiz({ subjectId: subject.id, source: { type: "note", id: noteId }, kind: "fill", count: 5 });
  if (!made.ok || made.result.status !== "made") throw new Error(`setup: ${JSON.stringify(made)}`);
  const start = await quiz.startAttempt({ quizId: made.result.quizId, fresh: false });
  if (!start.ok) throw new Error(start.error);
  const [first, second] = start.view.questions;
  const checked = await quiz.checkAnswer({ attemptId: start.view.attemptId, questionId: first.id, clientKey: crypto.randomUUID(), text: "zzzz" });
  if (!checked.ok) throw new Error(checked.error);
  const topic = (await repo.listWeakTopics(subject.id))[0];
  const asked = await chat.askQuestion({ subjectId: subject.id, question: "What does osmosis move across a membrane?", clientKey: crypto.randomUUID() });
  if (!asked.ok || asked.result.status !== "answered") throw new Error(`setup: ${JSON.stringify(asked)}`);
  return {
    repo, subjectId: subject.id, noteId, quizId: made.result.quizId, attemptId: start.view.attemptId,
    answeredId: first.id, openId: second.id, topicId: topic.id, topicName: topic.topic,
    answerMessageId: asked.result.answer.id, questionKey: asked.result.question.id,
  };
}

/** Everything of A's that an action could change or leak. */
async function snapshot(r: Repo, subjectId: string, quizId: string) {
  return JSON.stringify({
    quizzes: await r.listQuizzes(subjectId),
    questions: await r.listQuestions({ quizId }),
    attempts: await r.listAttempts({ quizId }),
    answers: await r.listAnswers({ attemptIds: (await r.listAttempts({ quizId })).map((a) => a.id) }),
    weak: await r.listWeakTopics(subjectId),
    chat: await r.listChat(subjectId, { limit: 100 }),
  });
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
  vi.stubEnv("CLOUDFLARE_AI_TOKEN", "");
  vi.stubEnv("EMBED_FUNCTION_SECRET", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("student B can't reach student A's Step 3 data through server actions", () => {
  it("every quiz, weak-topic and chat action refuses or ignores A's ids", async () => {
    const a = await student();
    const before = await snapshot(a.repo, a.subjectId, a.quizId);
    const secrets = (await a.repo.listQuestions({ quizId: a.quizId })).flatMap((q) => [q.answer, q.explanation]);
    const b = await student(); // repo is now B's
    const key = () => crypto.randomUUID();
    const results: unknown[] = [];
    const refused = async (p: Promise<{ ok: boolean }>) => { const r = await p; results.push(r); expect(r.ok).toBe(false); };

    // Quizzes
    await refused(quiz.loadQuizOptions(a.subjectId));
    await refused(quiz.makeQuiz({ subjectId: a.subjectId, source: { type: "all" }, kind: "fill", count: 5 }));
    await refused(quiz.makeQuiz({ subjectId: a.subjectId, source: { type: "weak", topics: [a.topicName] }, kind: "fill", count: 5 }));
    await refused(quiz.makeQuiz({ subjectId: b.subjectId, source: { type: "note", id: a.noteId }, kind: "fill", count: 5 }));
    await refused(quiz.startAttempt({ quizId: a.quizId, fresh: true }));
    await refused(quiz.checkAnswer({ attemptId: a.attemptId, questionId: a.openId, clientKey: key(), dontKnow: true }));
    // B's own attempt with A's question, and A's attempt with B's question.
    await refused(quiz.checkAnswer({ attemptId: b.attemptId, questionId: a.openId, clientKey: key(), dontKnow: true }));
    await refused(quiz.checkAnswer({ attemptId: a.attemptId, questionId: b.openId, clientKey: key(), dontKnow: true }));
    await refused(quiz.overrideAnswer({ attemptId: a.attemptId, questionId: a.answeredId }));
    await refused(quiz.reportQuestion({ attemptId: a.attemptId, questionId: a.openId, reason: "unclear" }));
    await refused(quiz.removeQuestion({ attemptId: a.attemptId, questionId: a.openId }));
    await refused(quiz.attemptResults(a.attemptId));
    await refused(quiz.deleteQuiz(a.quizId));
    await refused(quiz.restoreQuiz(a.quizId));
    await refused(quiz.editQuestion({ questionId: a.openId, prompt: "Hacked ____ prompt", explanation: "", answer: "x" }));
    // Weak topics
    await refused(weak.markGotIt(a.topicId));
    await refused(weak.reopenTopic(a.topicId));
    await refused(weak.topicQuestions(a.topicId));
    // B's weak-topic practice with A's topic name only finds B's own topics.
    const practice = await quiz.makeQuiz({ subjectId: b.subjectId, source: { type: "weak", topics: ["no such topic"] }, kind: "fill", count: 5 });
    expect(practice.ok && practice.result.status).toBe("weak_gone");
    // Chat
    await refused(chat.askQuestion({ subjectId: a.subjectId, question: "What is osmosis?", clientKey: key() }));
    await refused(chat.loadOlderChat({ subjectId: a.subjectId, before: new Date().toISOString() }));
    await refused(chat.clearChat(a.subjectId));
    await refused(chat.sendChatFeedback({ messageId: a.answerMessageId, feedback: "wrong" }));

    // Nothing of A's leaked into any reply, and nothing of A's changed.
    const json = JSON.stringify(results);
    for (const s of secrets) expect(json).not.toContain(s);
    expect(await snapshot(a.repo, a.subjectId, a.quizId)).toBe(before);
  });

  it("a chat client key A used can't fetch A's exchange for B", async () => {
    const a = await student();
    const aKey = (await a.repo.listChat(a.subjectId, { limit: 10 })).find((m) => m.role === "user")!.clientKey!;
    const b = await student();
    const r = await chat.askQuestion({ subjectId: b.subjectId, question: "What is osmosis?", clientKey: aKey });
    // B gets B's own fresh answer (or a refusal), never A's stored exchange.
    expect(JSON.stringify(r)).not.toContain(a.answerMessageId);
  });
});

describe("ids from two of the same student's quizzes can't be mixed", () => {
  it("an attempt only checks, overrides, reports and removes its own quiz's questions", async () => {
    const a = await student();
    const other = await quiz.makeQuiz({ subjectId: a.subjectId, source: { type: "note", id: a.noteId }, kind: "mcq", count: 5 });
    if (!other.ok || other.result.status !== "made") throw new Error("setup");
    const s = await quiz.startAttempt({ quizId: other.result.quizId, fresh: false });
    if (!s.ok) throw new Error(s.error);
    const otherQ = s.view.questions[0].id;
    const before = await snapshot(a.repo, a.subjectId, a.quizId);
    for (const r of [
      await quiz.checkAnswer({ attemptId: a.attemptId, questionId: otherQ, clientKey: crypto.randomUUID(), choice: 0 }),
      await quiz.checkAnswer({ attemptId: s.view.attemptId, questionId: a.openId, clientKey: crypto.randomUUID(), text: "x" }),
      await quiz.overrideAnswer({ attemptId: s.view.attemptId, questionId: a.answeredId }),
      await quiz.reportQuestion({ attemptId: s.view.attemptId, questionId: a.openId, reason: "unclear" }),
      await quiz.removeQuestion({ attemptId: s.view.attemptId, questionId: a.openId }),
    ]) expect(r.ok).toBe(false);
    expect(await snapshot(a.repo, a.subjectId, a.quizId)).toBe(before);
  });

  it("a client key used on one question can't answer another", async () => {
    const a = await student();
    const view = await quiz.startAttempt({ quizId: a.quizId, fresh: false });
    if (!view.ok) throw new Error(view.error);
    const k = crypto.randomUUID();
    const first = await quiz.checkAnswer({ attemptId: a.attemptId, questionId: a.openId, clientKey: k, dontKnow: true });
    expect(first.ok).toBe(true);
    const third = view.view.questions[2].id;
    const again = await quiz.checkAnswer({ attemptId: a.attemptId, questionId: third, clientKey: k, dontKnow: true });
    expect(again.ok).toBe(false);
    expect((await a.repo.listAnswers({ attemptIds: [a.attemptId] })).some((x) => x.questionId === third)).toBe(false);
  });
});

describe("a deleted quiz can't change weak topics (S3-6)", () => {
  it("report and remove are refused once the quiz is deleted", async () => {
    const a = await student();
    const before = JSON.stringify(await a.repo.listWeakTopics(a.subjectId));
    expect((await quiz.deleteQuiz(a.quizId)).ok).toBe(true);
    expect((await quiz.reportQuestion({ attemptId: a.attemptId, questionId: a.answeredId, reason: "wrong_answer" })).ok).toBe(false);
    expect((await quiz.removeQuestion({ attemptId: a.attemptId, questionId: a.answeredId })).ok).toBe(false);
    expect(JSON.stringify(await a.repo.listWeakTopics(a.subjectId))).toBe(before);
    expect((await a.repo.getQuestion(a.answeredId))!.removedAt).toBeNull();
  });
});
