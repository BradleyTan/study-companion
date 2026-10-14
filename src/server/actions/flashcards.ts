"use server";
import { revalidatePath } from "next/cache";
import { inputHash } from "@/lib/ai/cache";
import { fitPassages } from "@/lib/ai/prompts";
import { runAiTask } from "@/lib/ai/run";
import { normaliseFlashcards } from "@/lib/ai/schemas";
import { flashcardTask, FLASHCARDS_MAX_CHARS, MIN_SOURCE_CHARS, toPassages, type CardCount } from "@/lib/ai/tasks";
import type { GeneratedCard } from "@/lib/ai/types";
import { DAILY_LIMITS, type Quota } from "@/lib/limits/ai";
import { editCardInput, id as idSchema, makeFlashcardsInput, newCardInput } from "@/lib/validation";
import { appBudget, quotaFor, studentDay } from "../ai";
import { dayContext, toDeckCards, type DeckCard } from "../cards";
import { syncNoteChunks } from "../passages";
import type { ChunkRow, Repo } from "../repo/types";
import { getRepo } from "../session";
import { firstIssue, type ActionResult } from "./result";

/** Generous cap so a deck stays fast to load. */
const MAX_CARDS_PER_SUBJECT = 2000;
const MAX_CACHE_BYTES = 200_000;

export type MakeOptions = {
  notes: { id: string; title: string; chars: number; updatedAt: string }[];
  files: { id: string; name: string; kind: "pdf" | "pptx"; pageCount: number | null; status: string }[];
  quota: Quota;
};

/** Sources and quota for the Make flashcards dialog. */
export async function loadMakeOptions(subjectId: string): Promise<ActionResult<MakeOptions>> {
  if (!idSchema.safeParse(subjectId).success) return { ok: false, error: "Subject not found." };
  const repo = await getRepo();
  if (!(await repo.getSubject(subjectId))) return { ok: false, error: "Subject not found." };
  const [notes, files, quota] = await Promise.all([repo.listNotes(subjectId), repo.listSources(subjectId), quotaFor(repo, "flashcards")]);
  return {
    ok: true,
    notes: notes.map((n) => ({ id: n.id, title: n.title || "Untitled note", chars: n.chars, updatedAt: n.updatedAt })),
    files: files.map((f) => ({ id: f.id, name: f.fileName, kind: f.kind, pageCount: f.pageCount, status: f.extractStatus })),
    quota,
  };
}

export type MakeResult =
  | { status: "made"; cards: DeckCard[]; quota: Quota; requested: number; cached: boolean }
  | { status: "too_short"; sourceType: "note" | "file"; quota: Quota }
  | { status: "limit"; quota: Quota }
  | { status: "allowance"; quota: Quota }
  | { status: "already"; count: number; quota: Quota }
  | { status: "failed"; quota: Quota };

async function sourceChunks(repo: Repo, subjectId: string, source: { type: "note"; id: string } | { type: "file"; id: string; fromPage: number; toPage: number }) {
  if (source.type === "note") {
    const note = await repo.getNote(source.id);
    if (!note || note.subjectId !== subjectId) return null;
    await syncNoteChunks(repo, note); // make sure passages match the latest text
    return { chunks: await repo.listChunks({ noteId: note.id }), noteId: note.id, sourceId: null };
  }
  const file = await repo.getSource(source.id);
  if (!file || file.subjectId !== subjectId || file.extractStatus !== "ready") return null;
  const chunks = (await repo.listChunks({ sourceId: file.id })).filter((c) => c.page === null || (c.page >= source.fromPage && c.page <= source.toPage));
  return { chunks, noteId: null, sourceId: file.id };
}

function cardsToSave(cards: GeneratedCard[], chunks: ChunkRow[], subjectId: string, hash: string, link: { noteId: string | null; sourceId: string | null }) {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return cards.filter((c) => byId.has(c.chunkId)).map((c) => ({
    subjectId, front: c.front, back: c.back, origin: "ai" as const, sourceQuote: c.quote, chunkId: c.chunkId,
    noteId: link.noteId, sourceId: link.sourceId, page: byId.get(c.chunkId)!.page, inputHash: hash,
  }));
}

/**
 * Makes flashcards from one note or a page range of one file. Quota rules (flashcards.md):
 * only successful, non-cached generations count; the same text again is free.
 */
export async function makeFlashcards(raw: unknown): Promise<ActionResult<{ result: MakeResult }>> {
  const parsed = makeFlashcardsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { subjectId, source, count } = parsed.data;
  const repo = await getRepo();
  if (!(await repo.getSubject(subjectId))) return { ok: false, error: "Subject not found." };
  const found = await sourceChunks(repo, subjectId, source);
  if (!found) return { ok: false, error: "That note or file isn't available any more." };
  const quota = () => quotaFor(repo, "flashcards");

  const totalChars = found.chunks.reduce((n, c) => n + c.text.length, 0);
  if (totalChars < MIN_SOURCE_CHARS) return { ok: true, result: { status: "too_short", sourceType: source.type, quota: await quota() } };
  if ((await repo.listFlashcards({ subjectId })).length >= MAX_CARDS_PER_SUBJECT) {
    return { ok: false, error: `A subject can hold up to ${MAX_CARDS_PER_SUBJECT} cards. Delete some first.` };
  }

  const picked = fitPassages(found.chunks, FLASHCARDS_MAX_CHARS);
  const passages = toPassages(picked);
  const hash = inputHash("flashcards", picked.map((c) => c.contentHash), { count });
  const link = { noteId: found.noteId, sourceId: found.sourceId };
  const ctx = await dayContext(repo);

  // Same text, same options: never pay twice.
  const cached = await repo.getAiCache("flashcards", hash);
  if (cached) {
    const existing = await repo.findFlashcardsByHash(hash);
    if (existing.length) return { ok: true, result: { status: "already", count: existing.length, quota: await quota() } };
    const cards = normaliseFlashcards(cached.output, passages, Math.min(count + 5, 25));
    if (cards && cards.length) {
      const saved = await repo.createFlashcards(cardsToSave(cards, picked, subjectId, hash, link));
      revalidatePath(`/subjects/${subjectId}`);
      return { ok: true, result: { status: "made", cards: await toDeckCards(repo, saved, ctx), quota: await quota(), requested: count, cached: true } };
    }
  }

  const day = await studentDay(repo);
  if (!(await repo.reserveAi(day, "flashcards", DAILY_LIMITS.flashcards))) return { ok: true, result: { status: "limit", quota: await quota() } };
  let ok = false;
  let tokens = { input: 0, output: 0 };
  try {
    const out = await runAiTask(flashcardTask(passages, count as CardCount), appBudget(repo));
    if (!out.ok) return { ok: true, result: { status: out.reason === "allowance" ? "allowance" : "failed", quota: await quota() } };
    tokens = { input: out.inputTokens, output: out.outputTokens };
    const saved = await repo.createFlashcards(cardsToSave(out.value, picked, subjectId, hash, link));
    if (!saved.length) return { ok: true, result: { status: "failed", quota: await quota() } };
    ok = true;
    if (JSON.stringify(out.raw).length <= MAX_CACHE_BYTES) await repo.putAiCache("flashcards", hash, out.model, out.raw);
    revalidatePath(`/subjects/${subjectId}`);
    // Settle before reading the quota back, so the chip shows the go just used.
    await repo.settleAi(day, "flashcards", true, tokens.input, tokens.output);
    return { ok: true, result: { status: "made", cards: await toDeckCards(repo, saved, ctx), quota: await quota(), requested: count, cached: false } };
  } finally {
    if (!ok) await repo.settleAi(day, "flashcards", false, tokens.input, tokens.output);
  }
}

export async function cardQuota(): Promise<Quota> {
  return quotaFor(await getRepo(), "flashcards");
}

/** Cards a generation made, for "Show those cards". */
export async function cardsOfSubject(subjectId: string): Promise<ActionResult<{ cards: DeckCard[] }>> {
  if (!idSchema.safeParse(subjectId).success) return { ok: false, error: "Subject not found." };
  const repo = await getRepo();
  const ctx = await dayContext(repo);
  return { ok: true, cards: await toDeckCards(repo, await repo.listFlashcards({ subjectId }), ctx) };
}

export async function createCard(raw: unknown): Promise<ActionResult<{ card: DeckCard }>> {
  const parsed = newCardInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  if (!(await repo.getSubject(parsed.data.subjectId))) return { ok: false, error: "Subject not found." };
  if ((await repo.listFlashcards({ subjectId: parsed.data.subjectId })).length >= MAX_CARDS_PER_SUBJECT) {
    return { ok: false, error: `A subject can hold up to ${MAX_CARDS_PER_SUBJECT} cards. Delete some first.` };
  }
  const [saved] = await repo.createFlashcards([{ ...parsed.data, origin: "manual" }]);
  revalidatePath(`/subjects/${parsed.data.subjectId}`);
  return { ok: true, card: (await toDeckCards(repo, [saved], await dayContext(repo)))[0] };
}

export async function updateCard(raw: unknown): Promise<ActionResult<{ card: DeckCard }>> {
  const parsed = editCardInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  const card = await repo.getFlashcard(parsed.data.id);
  if (!card || card.deletedAt) return { ok: false, error: "This card was deleted." };
  // Fixing a typo must not reset the review schedule.
  await repo.updateFlashcardText(card.id, { front: parsed.data.front, back: parsed.data.back });
  const updated = (await repo.getFlashcard(card.id))!;
  return { ok: true, card: (await toDeckCards(repo, [updated], await dayContext(repo)))[0] };
}

export async function deleteCard(cardId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(cardId).success) return { ok: false, error: "Card not found." };
  const repo = await getRepo();
  const card = await repo.getFlashcard(cardId);
  if (!card) return { ok: false, error: "Card not found." };
  await repo.setFlashcardDeleted(card.id, true);
  revalidatePath(`/subjects/${card.subjectId}`);
  return { ok: true };
}

/** Undo for delete: brings the card back with its schedule untouched. */
export async function restoreCard(cardId: string): Promise<ActionResult<{ card: DeckCard }>> {
  if (!idSchema.safeParse(cardId).success) return { ok: false, error: "Card not found." };
  const repo = await getRepo();
  const card = await repo.getFlashcard(cardId);
  if (!card) return { ok: false, error: "Card not found." };
  await repo.setFlashcardDeleted(card.id, false);
  revalidatePath(`/subjects/${card.subjectId}`);
  return { ok: true, card: (await toDeckCards(repo, [{ ...card, deletedAt: null }], await dayContext(repo)))[0] };
}

