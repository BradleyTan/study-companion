import "server-only";
import {
  buildQueue, countDue, dueBySubject, localDayBounds, NEW_CARDS_PER_DAY, newAllowanceLeft, safeTimeZone, type CardSchedule, type DueCount,
} from "@/lib/srs/due";
import type { SrsState } from "@/lib/srs/scheduler";
import type { SubjectColour } from "@/lib/subjects";
import type { Flashcard, Repo } from "./repo/types";

export type CardSourceInfo =
  | { kind: "manual" }
  | { kind: "deleted" }
  | { kind: "note"; title: string; href: string }
  | { kind: "file"; title: string; page: number | null; href: string };

/** A flashcard as the deck and review screens see it. */
export type DeckCard = {
  id: string;
  subjectId: string;
  front: string;
  back: string;
  quote: string | null;
  edited: boolean;
  createdAt: string;
  isNew: boolean;
  isDue: boolean;
  source: CardSourceInfo;
  /** Cards from the same passage share this, so the review queue keeps them apart. */
  quoteKey: string | null;
  srs: SrsState;
};

export type SubjectLite = { id: string; name: string; colour: SubjectColour; emoji: string };

/** The passage link shared by cards, mindmap nodes and (Step 3) quiz and chat citations. */
export function passageHref(subjectId: string, link: { noteId: string | null; sourceId: string | null; chunkId: string | null; cardId?: string }): string | null {
  const q = link.chunkId ? `?quote=${link.chunkId}` : link.cardId ? `?card=${link.cardId}` : "";
  if (link.noteId) return `/subjects/${subjectId}/notes/${link.noteId}${q}`;
  if (link.sourceId) return `/subjects/${subjectId}/sources/${link.sourceId}${q}`;
  return null;
}

export type DayContext = { now: Date; tz: string; dayStart: Date; dayEnd: Date; allowanceLeft: number };

export async function dayContext(repo: Repo, now = new Date()): Promise<DayContext> {
  const tz = safeTimeZone((await repo.getProfile()).timezone);
  const { start, end } = localDayBounds(tz, now);
  const introduced = await repo.countIntroducedSince(start.toISOString());
  return { now, tz, dayStart: start, dayEnd: end, allowanceLeft: newAllowanceLeft(introduced) };
}

export const toSchedule = (c: Flashcard): CardSchedule => ({
  id: c.id, subjectId: c.subjectId, state: c.srs.state, dueAt: c.srs.dueAt, createdAt: c.createdAt, quoteKey: c.chunkId ?? c.sourceQuote,
});

/** Adds source titles and links (one lookup per subject involved). */
export async function toDeckCards(repo: Repo, cards: Flashcard[], ctx: Pick<DayContext, "dayEnd">): Promise<DeckCard[]> {
  const subjects = [...new Set(cards.map((c) => c.subjectId))];
  const noteTitles = new Map<string, string>();
  const fileNames = new Map<string, string>();
  await Promise.all(subjects.map(async (sid) => {
    const needNotes = cards.some((c) => c.subjectId === sid && c.noteId);
    const needFiles = cards.some((c) => c.subjectId === sid && c.sourceId);
    const [notes, files] = await Promise.all([needNotes ? repo.listNotes(sid) : [], needFiles ? repo.listSources(sid) : []]);
    notes.forEach((n) => noteTitles.set(n.id, n.title || "Untitled note"));
    files.forEach((f) => fileNames.set(f.id, f.fileName));
  }));
  return cards.map((c) => {
    let source: CardSourceInfo;
    const href = passageHref(c.subjectId, { noteId: c.noteId, sourceId: c.sourceId, chunkId: c.chunkId, cardId: c.id });
    if (c.noteId && href) source = { kind: "note", title: noteTitles.get(c.noteId) ?? "Untitled note", href };
    else if (c.sourceId && href) source = { kind: "file", title: fileNames.get(c.sourceId) ?? "Lecture file", page: c.page, href };
    else source = c.origin === "manual" ? { kind: "manual" } : { kind: "deleted" };
    return {
      id: c.id, subjectId: c.subjectId, front: c.front, back: c.back, quote: c.sourceQuote, edited: c.edited, createdAt: c.createdAt,
      isNew: c.srs.state === 0,
      isDue: c.srs.state !== 0 && Date.parse(c.srs.dueAt) < ctx.dayEnd.getTime(),
      source, quoteKey: c.chunkId ?? c.sourceQuote, srs: c.srs,
    };
  });
}

/** Due-today counts for one subject (its session uses the same rule). */
export async function subjectDue(repo: Repo, subjectId: string, ctx?: DayContext): Promise<DueCount & { cards: number }> {
  const c = ctx ?? (await dayContext(repo));
  const cards = await repo.listFlashcards({ subjectId });
  return { ...countDue(cards.map(toSchedule), c.dayEnd, c.allowanceLeft), cards: cards.length };
}

/** Banner and subject chips on the Subjects page. */
export async function allDue(repo: Repo): Promise<{ total: number; bySubject: Map<string, number>; reviewedToday: boolean; day: string }> {
  const ctx = await dayContext(repo);
  const [cards, reviewed] = await Promise.all([repo.listFlashcards(), repo.countReviewsSince(ctx.dayStart.toISOString())]);
  return { ...dueBySubject(cards.map(toSchedule), ctx.dayEnd, ctx.allowanceLeft), reviewedToday: reviewed > 0, day: ctx.dayStart.toISOString() };
}

/** The cards for a review session, in order. */
export async function reviewQueue(repo: Repo, subjectId: string | null): Promise<DeckCard[]> {
  const ctx = await dayContext(repo);
  const cards = await repo.listFlashcards(subjectId ? { subjectId } : {});
  const order = buildQueue(cards.map(toSchedule), ctx.now, ctx.dayEnd, ctx.allowanceLeft).map((c) => c.id);
  const byId = new Map(cards.map((c) => [c.id, c]));
  return toDeckCards(repo, order.map((id) => byId.get(id)!), ctx);
}

/**
 * What's coming after today, for "Next up: 14 cards tomorrow" and "Nothing due for 3 days".
 * `tomorrow` = seen cards due tomorrow + new cards still waiting (up to a day's allowance).
 */
export async function upcoming(repo: Repo, subjectId: string | null): Promise<{ tomorrow: number; nextDueAt: string | null; laterDue: number }> {
  const ctx = await dayContext(repo);
  const cards = (await repo.listFlashcards(subjectId ? { subjectId } : {})).map(toSchedule);
  const tomorrowEnd = localDayBounds(ctx.tz, new Date(ctx.dayEnd.getTime() + 3_600_000)).end.getTime();
  const seen = cards.filter((c) => c.state !== 0);
  const dueTomorrow = seen.filter((c) => Date.parse(c.dueAt) >= ctx.dayEnd.getTime() && Date.parse(c.dueAt) < tomorrowEnd).length;
  const freshLeft = Math.max(0, cards.filter((c) => c.state === 0).length - ctx.allowanceLeft);
  const tomorrow = dueTomorrow + Math.min(freshLeft, NEW_CARDS_PER_DAY);
  const future = seen.map((c) => c.dueAt).filter((d) => Date.parse(d) >= ctx.dayEnd.getTime()).sort();
  return { tomorrow, nextDueAt: future[0] ?? null, laterDue: future.length };
}
