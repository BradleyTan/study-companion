"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { inputHash } from "@/lib/ai/cache";
import type { ChatTurn } from "@/lib/ai/prompts";
import { aiMode } from "@/lib/ai/providers";
import { runAiTask } from "@/lib/ai/run";
import { chatTask, toPassages } from "@/lib/ai/tasks";
import { collapse } from "@/lib/ai/text";
import { normaliseChatReply, type ChatReply } from "@/lib/chat/answer";
import { plainText } from "@/lib/chat/render";
import { isQuizMe } from "@/lib/chat/suggest";
import { CHAT_MAX_CHARS, DAILY_ATTEMPTS, DAILY_LIMITS, type Quota } from "@/lib/limits/ai";
import { askInput, chatFeedbackInput, id as idSchema, olderChatInput } from "@/lib/validation";
import { appBudget, quotaFor, studentDay } from "../ai";
import {
  CHAT_CAP, CHAT_KEEP, CHAT_PAGE, chatViews, citationsOf, closestCitations, lookupOf, NOT_COVERED, quizPassages, retrieve,
  type ChatMessageView, type RetrievalMode,
} from "../chat";
import type { ChatRow, ChunkRow, NewChatAnswer, Repo } from "../repo/types";
import { getRepo } from "../session";
import { firstIssue, type ActionResult } from "./result";

// Ask your notes (chat.md). Every export here is a public endpoint: arguments are validated
// with zod and every row is looked up through the student's own repo (RLS + pinned user id),
// so another student's subject or message simply isn't found.

const MAX_CACHE_BYTES = 50_000;
/** Earlier messages sent with a question, for follow-ups (chat.md: never more than 4). */
const HISTORY = 4;

export type AskResult =
  /** `mode` is null for a retried send that was answered before. */
  | { status: "answered"; question: ChatMessageView; answer: ChatMessageView; quota: Quota; mode: RetrievalMode | null }
  | { status: "limit" | "allowance" | "failed" | "not_configured" | "no_sources"; quota: Quota };

/** The last few messages, oldest first, as the model sees them (answers without citation marks). */
function turnsOf(rows: ChatRow[]): ChatTurn[] {
  return rows.map((r) => ({
    role: r.role === "user" ? "student" : "assistant",
    text: r.role === "user" ? r.content : [plainText(r.content), r.reveal ? `Answer: ${plainText(r.reveal)}` : ""].filter(Boolean).join("\n"),
  }));
}

/** Keeps the subject under the database's cap: the oldest questions (and their answers) go first. */
async function makeRoom(repo: Repo, subjectId: string) {
  const count = await repo.countChat(subjectId);
  if (count + 2 > CHAT_CAP) await repo.deleteOldestChat(subjectId, Math.ceil((count + 2 - CHAT_KEEP) / 2));
}

/**
 * Answers a question from this subject's notes and files only (chat.md "Answering rules").
 * Quota: one question per model call (reserved first, refunded on failure). A not-covered reply
 * found without the model, or a cached answer, gives the question back but counts as a try, so
 * the 60 tries a day also cap free retrieval. Nothing is saved unless an answer is shown.
 */
export async function askQuestion(raw: unknown): Promise<ActionResult<{ result: AskResult }>> {
  const parsed = askInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { subjectId, question, clientKey } = parsed.data;
  const repo = await getRepo();
  const subject = await repo.getSubject(subjectId);
  if (!subject) return { ok: false, error: "Subject not found." };
  const quota = () => quotaFor(repo, "chat");
  const status = async (s: Exclude<AskResult["status"], "answered">) => ({ ok: true as const, result: { status: s, quota: await quota() } });

  // A retried send (the first reply got lost) gets the same answer back, not a second go.
  const earlier = await repo.findChatExchange(clientKey);
  if (earlier) {
    if (earlier.question.subjectId !== subjectId || !earlier.answer) return { ok: false, error: "That question was already sent." };
    const [q, a] = await chatViews(repo, subjectId, [earlier.question, earlier.answer]);
    return { ok: true, result: { status: "answered", question: q, answer: a, quota: await quota(), mode: null } };
  }

  const [notes, files] = await Promise.all([repo.listNotes(subjectId), repo.listSources(subjectId)]);
  const readyFiles = new Set(files.filter((f) => f.extractStatus === "ready").map((f) => f.id));
  if (!notes.some((n) => n.chars > 0) && !readyFiles.size) return status("no_sources");
  const mode = aiMode();
  if (mode === "off") return status("not_configured");
  const lookup = lookupOf(notes, files);
  const quiz = isQuizMe(question);

  const day = await studentDay(repo);
  if (!(await repo.reserveAi(day, "chat", DAILY_LIMITS.chat, DAILY_ATTEMPTS.chat))) return status("limit");
  let settled = false;
  let tokens = { input: 0, output: 0 };
  // Settled once: used (the model ran) or given back (failed, cached, or not covered without the model).
  const settle = async (ok: boolean) => {
    if (settled) return;
    settled = true;
    await repo.settleAi(day, "chat", ok, tokens.input, tokens.output);
  };
  try {
    const history = (await repo.listChat(subjectId, { limit: HISTORY })).reverse();
    let found: { passages: ChunkRow[]; closest: ChunkRow[]; mode: RetrievalMode };
    if (quiz) {
      const all = (await repo.listChunks({ subjectId })).filter((c) => c.noteId || (c.sourceId && readyFiles.has(c.sourceId)));
      found = { passages: quizPassages(all), closest: [], mode: "keywords" };
    } else {
      found = await retrieve(repo, subjectId, question, readyFiles);
      // A follow-up ("what about the second one?") is searched together with the question before it.
      const previous = [...history].reverse().find((r) => r.role === "user")?.content;
      if (!found.passages.length && previous) {
        const again = await retrieve(repo, subjectId, `${previous} ${question}`, readyFiles);
        if (again.passages.length) found = again;
      }
    }

    const save = async (answer: NewChatAnswer) => {
      await makeRoom(repo, subjectId);
      const saved = await repo.addChatExchange(subjectId, { clientKey, question, answer, after: history.at(-1)?.createdAt });
      const [q, a] = await chatViews(repo, subjectId, [saved.question, saved.answer], lookup);
      fresh(subjectId);
      return { q, a };
    };
    const answered = async (answer: NewChatAnswer, modelRan: boolean) => {
      const { q, a } = await save(answer);
      await settle(modelRan);
      return { ok: true as const, result: { status: "answered" as const, question: q, answer: a, quota: await quota(), mode: found.mode } };
    };

    // Nothing close enough: no model call, and the question isn't used (the try is).
    if (!found.passages.length) {
      return await answered({ kind: "not_covered", content: NOT_COVERED, citations: closestCitations(found.closest, question, lookup), reveal: null }, false);
    }

    let chars = 0;
    const chunks = found.passages.filter((c) => (chars += c.text.length) <= CHAT_MAX_CHARS || c === found.passages[0]);
    const passages = toPassages(chunks);
    const turns = turnsOf(history);
    const historyKey = createHash("sha256").update(JSON.stringify(turns)).digest("hex");
    const hash = inputHash("chat", chunks.map((c) => c.contentHash), { q: collapse(question).toLowerCase(), h: historyKey, quiz });
    const toAnswer = (reply: ChatReply): NewChatAnswer => reply.kind === "answer"
      ? { kind: "answer", content: reply.content, reveal: reply.reveal, citations: citationsOf(reply.citations, chunks, lookup) }
      : { kind: "not_covered", content: NOT_COVERED, citations: closestCitations(chunks, question, lookup), reveal: null };

    // The same question about the same passages and conversation: never pay twice (and never
    // reuse the local generator's reply for real AI). A quiz question is never reused.
    const cached = quiz ? null : await repo.getAiCache("chat", hash);
    if (cached && (cached.model !== "local" || mode === "local")) {
      const reply = normaliseChatReply(cached.output, passages, { quiz });
      if (reply) return await answered(toAnswer(reply), false);
    }

    const out = await runAiTask(chatTask(passages, question, turns, { quiz, subjectName: subject.name }), appBudget(repo));
    if (!out.ok) {
      await settle(false);
      return await status(out.reason);
    }
    tokens = { input: out.inputTokens, output: out.outputTokens };
    if (!quiz && JSON.stringify(out.raw).length <= MAX_CACHE_BYTES) await repo.putAiCache("chat", hash, out.model, out.raw);
    // The model ran: a reply with nothing cited left becomes "not covered" and still uses the question.
    return await answered(toAnswer(out.value), true);
  } finally {
    await settle(false);
  }
}

/**
 * The browser keeps the chat page for Back; without this, Back from a cited passage would show the
 * chat as it was first loaded. The open chat keeps its own state (props only seed it).
 */
function fresh(subjectId: string) {
  revalidatePath(`/subjects/${subjectId}`);
  revalidatePath(`/subjects/${subjectId}/ask`);
}

/** Older messages, for "Show earlier messages". */
export async function loadOlderChat(raw: unknown): Promise<ActionResult<{ messages: ChatMessageView[]; hasOlder: boolean }>> {
  const parsed = olderChatInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  if (!(await repo.getSubject(parsed.data.subjectId))) return { ok: false, error: "Subject not found." };
  const rows = await repo.listChat(parsed.data.subjectId, { limit: CHAT_PAGE + 1, before: new Date(parsed.data.before).toISOString() });
  return { ok: true, messages: await chatViews(repo, parsed.data.subjectId, rows.slice(0, CHAT_PAGE).reverse()), hasOlder: rows.length > CHAT_PAGE };
}

/** "Clear chat": the subject's messages only; notes and files stay as they are. */
export async function clearChat(subjectId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(subjectId).success) return { ok: false, error: "Subject not found." };
  const repo = await getRepo();
  if (!(await repo.getSubject(subjectId))) return { ok: false, error: "Subject not found." };
  await repo.clearChat(subjectId);
  fresh(subjectId);
  return { ok: true };
}

/** "Not right?": saved on the answer (no further action in Phase 1). */
export async function sendChatFeedback(raw: unknown): Promise<ActionResult> {
  const parsed = chatFeedbackInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  const message = await repo.getChatMessage(parsed.data.messageId);
  if (!message || message.role !== "assistant") return { ok: false, error: "That answer isn't here any more." };
  await repo.setChatFeedback(message.id, parsed.data.feedback);
  return { ok: true };
}

export async function chatQuota(): Promise<Quota> {
  return quotaFor(await getRepo(), "chat");
}
