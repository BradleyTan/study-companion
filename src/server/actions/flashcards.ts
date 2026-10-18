"use server";
import { revalidatePath } from "next/cache";
import { inputHash } from "@/lib/ai/cache";
import { fitPassages } from "@/lib/ai/prompts";
import { aiMode } from "@/lib/ai/providers";
import { runAiTask } from "@/lib/ai/run";
import { normaliseFlashcardsWithStats } from "@/lib/ai/schemas";
import { flashcardTask, FLASHCARDS_MAX_CHARS, MIN_SOURCE_CHARS, toPassages, type CardCount } from "@/lib/ai/tasks";
import { normaliseFront } from "@/lib/ai/text";
import type { GeneratedCard } from "@/lib/ai/types";
import { DAILY_ATTEMPTS, DAILY_LIMITS, type Quota } from "@/lib/limits/ai";
import { editCardInput, id as idSchema, makeFlashcardsInput, newCardInput } from "@/lib/validation";
import { appBudget, quotaFor, studentDay } from "../ai";
import { dayContext, toDeckCards, type DeckCard } from "../cards";
import { sourceChunks, sourceOptions, type FileSeries, type SourceOptions } from "../source-select";
import type { ChunkRow } from "../repo/types";
import { getRepo } from "../session";
import { firstIssue, type ActionResult } from "./result";

/** Generous cap so a deck stays fast to load. */
const MAX_CARDS_PER_SUBJECT = 2000;
const MAX_CACHE_BYTES = 200_000;

export type MakeOptions = SourceOptions & { quota: Quota };

/** Sources and quota for the Make flashcards dialog. */
export async function loadMakeOptions(subjectId: string): Promise<ActionResult<MakeOptions>> {
  if (!idSchema.safeParse(subjectId).success) return { ok: false, error: "Subject not found." };
  const repo = await getRepo();
  if (!(await repo.getSubject(subjectId))) return { ok: false, error: "Subject not found." };
  const [opts, quota] = await Promise.all([sourceOptions(repo, subjectId, FLASHCARDS_MAX_CHARS), quotaFor(repo, "flashcards")]);
  return { ok: true, ...opts, quota };
}

export type { FileSeries };

export type MakeResult =
  | {
    status: "made"; cards: DeckCard[]; quota: Quota; requested: number; cached: boolean; series?: FileSeries;
    /** Generated cards not saved because the same card from this file is already in the deck. */
    skipped: number;
    /** Generated cards dropped by the quality and grounding checks (not shown unless few are left). */
    dropped: number;
  }
  /** Every generated card was already in the deck: nothing saved, the go given back. */
  | { status: "all_skipped"; sourceType: "note" | "file"; skipped: number; quota: Quota; series?: FileSeries }
  | { status: "too_short"; sourceType: "note" | "file"; quota: Quota }
  | { status: "limit"; quota: Quota }
  | { status: "allowance"; quota: Quota }
  | { status: "already"; count: number; quota: Quota; series?: FileSeries }
  | { status: "failed"; quota: Quota }
  /** Production build without an AI key. */
  | { status: "not_configured"; quota: Quota };

/**
 * Fronts of the AI cards already in this subject from the same note or file (not deleted),
 * normalised. Hand-written cards and other sources are never compared (flashcards.md
 * "Overlapping ranges"; notes too since 2026-10-17).
 */
function existingFronts(deck: { noteId: string | null; sourceId: string | null; front: string; origin: string }[], link: { noteId: string | null; sourceId: string | null }): Set<string> {
  const same = (c: { noteId: string | null; sourceId: string | null }) =>
    (link.sourceId !== null && c.sourceId === link.sourceId) || (link.noteId !== null && c.noteId === link.noteId);
  return new Set(deck.filter((c) => c.origin === "ai" && same(c)).map((c) => normaliseFront(c.front)));
}

/** Splits generated cards into new ones and ones already in the deck. Not exported: this file's exports are public actions. */
function splitDuplicates(cards: GeneratedCard[], have: Set<string>): { fresh: GeneratedCard[]; skipped: number } {
  const fresh = cards.filter((c) => !have.has(normaliseFront(c.front)));
  return { fresh, skipped: cards.length - fresh.length };
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
  const found = await sourceChunks(repo, subjectId, source, FLASHCARDS_MAX_CHARS);
  if (!found) return { ok: false, error: "That note or file isn't available any more." };
  if ("error" in found) return { ok: false, error: found.error };
  const series = found.series ? { series: found.series } : {};
  const quota = () => quotaFor(repo, "flashcards");

  const totalChars = found.chunks.reduce((n, c) => n + c.text.length, 0);
  if (totalChars < MIN_SOURCE_CHARS) return { ok: true, result: { status: "too_short", sourceType: source.type, quota: await quota() } };
  const deck = await repo.listFlashcards({ subjectId });
  if (deck.length >= MAX_CARDS_PER_SUBJECT) {
    return { ok: false, error: `A subject can hold up to ${MAX_CARDS_PER_SUBJECT} cards. Delete some first.` };
  }
  const have = existingFronts(deck, { noteId: found.noteId, sourceId: found.sourceId });

  const picked = fitPassages(found.chunks, FLASHCARDS_MAX_CHARS);
  const passages = toPassages(picked);
  const hash = inputHash("flashcards", picked.map((c) => c.contentHash), { count });
  const link = { noteId: found.noteId, sourceId: found.sourceId };
  const ctx = await dayContext(repo);

  // Same text, same options: never pay twice. (Never reuse the fake generator's output for real AI.)
  const mode = aiMode();
  const cached = await repo.getAiCache("flashcards", hash);
  if (cached && (cached.model !== "local" || mode === "local")) {
    // Only this subject's cards count: the same text can live in two subjects.
    const existing = (await repo.findFlashcardsByHash(hash)).filter((c) => c.subjectId === subjectId);
    if (existing.length) return { ok: true, result: { status: "already", count: existing.length, quota: await quota(), ...series } };
    const norm = normaliseFlashcardsWithStats(cached.output, passages, Math.min(count + 5, 25));
    if (norm && norm.cards.length) {
      const { fresh, skipped } = splitDuplicates(norm.cards, have);
      // Cached output costs nothing, so "didn't use up a go" holds.
      if (!fresh.length) return { ok: true, result: { status: "all_skipped", sourceType: source.type, skipped, quota: await quota(), ...series } };
      const saved = await repo.createFlashcards(cardsToSave(fresh, picked, subjectId, hash, link));
      revalidatePath(`/subjects/${subjectId}`);
      return { ok: true, result: { status: "made", cards: await toDeckCards(repo, saved, ctx), quota: await quota(), requested: count, cached: true, skipped, dropped: norm.dropped, ...series } };
    }
  }

  if (mode === "off") return { ok: true, result: { status: "not_configured", quota: await quota() } };
  const day = await studentDay(repo);
  if (!(await repo.reserveAi(day, "flashcards", DAILY_LIMITS.flashcards, DAILY_ATTEMPTS.flashcards))) return { ok: true, result: { status: "limit", quota: await quota() } };
  let ok = false;
  let settled = false;
  let tokens = { input: 0, output: 0 };
  try {
    const out = await runAiTask(flashcardTask(passages, count as CardCount), appBudget(repo));
    if (!out.ok) return { ok: true, result: { status: out.reason, quota: await quota() } };
    tokens = { input: out.inputTokens, output: out.outputTokens };
    const cacheIt = () => (JSON.stringify(out.raw).length <= MAX_CACHE_BYTES ? repo.putAiCache("flashcards", hash, out.model, out.raw) : Promise.resolve());
    const { fresh, skipped } = splitDuplicates(out.value.cards, have);
    if (!fresh.length) {
      // Every card is already in the deck: save nothing and give the go back (the finally below
      // settles it as failed, which still counts toward the tries cap). Cached, so asking again is free.
      await cacheIt();
      await repo.settleAi(day, "flashcards", false, tokens.input, tokens.output);
      settled = true; // only once it worked: if settling throws, the finally below tries again
      return { ok: true, result: { status: "all_skipped", sourceType: source.type, skipped, quota: await quota(), ...series } };
    }
    const saved = await repo.createFlashcards(cardsToSave(fresh, picked, subjectId, hash, link));
    if (!saved.length) return { ok: true, result: { status: "failed", quota: await quota() } };
    ok = true;
    await cacheIt();
    revalidatePath(`/subjects/${subjectId}`);
    // Settle before reading the quota back, so the chip shows the go just used.
    await repo.settleAi(day, "flashcards", true, tokens.input, tokens.output);
    return { ok: true, result: { status: "made", cards: await toDeckCards(repo, saved, ctx), quota: await quota(), requested: count, cached: false, skipped, dropped: out.value.dropped, ...series } };
  } finally {
    if (!ok && !settled) await repo.settleAi(day, "flashcards", false, tokens.input, tokens.output);
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

