// "Due today" counts and the review queue. Pure functions, shared by the server
// (counts, queue) and the review screen (re-queueing cards graded Again).
import { SAME_SESSION_MS, type SrsStateNum } from "./scheduler";

/** New cards a student meets per day, across all subjects. */
export const NEW_CARDS_PER_DAY = 20;

// ---- time zones -------------------------------------------------------------

export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function zonedParts(tz: string, at: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Offset of `tz` from UTC at instant `at`, in ms (positive east of Greenwich). */
function tzOffset(tz: string, at: number): number {
  const p = zonedParts(tz, at);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The UTC instant of local midnight on the given local calendar date in `tz`. */
function localMidnight(tz: string, y: number, m: number, d: number): number {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffset(tz, guess);
  t = guess - tzOffset(tz, t); // second pass settles DST changes
  return t;
}

/** Local calendar day ("2026-10-14") in `tz`; used as the quota day. */
export function localDayKey(tz: string, now: Date): string {
  const p = zonedParts(safeTimeZone(tz), now.getTime());
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Start of today and start of tomorrow (exclusive end of today) in `tz`, as UTC instants. */
export function localDayBounds(tz: string, now: Date): { start: Date; end: Date } {
  const zone = safeTimeZone(tz);
  const p = zonedParts(zone, now.getTime());
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return {
    start: new Date(localMidnight(zone, p.y, p.m, p.d)),
    end: new Date(localMidnight(zone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())),
  };
}

// ---- counts -----------------------------------------------------------------

export type CardSchedule = {
  id: string;
  subjectId: string;
  state: SrsStateNum;
  dueAt: string;
  createdAt: string;
  /** Cards sharing a passage get the same key, so the queue can keep them apart. */
  quoteKey?: string | null;
};

const isNew = (c: CardSchedule) => c.state === 0;
const byDue = (a: CardSchedule, b: CardSchedule) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id);
const byCreated = (a: CardSchedule, b: CardSchedule) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Cards already seen that fall due before the end of the local day. */
export function isDueToday(c: CardSchedule, dayEnd: Date): boolean {
  return !isNew(c) && Date.parse(c.dueAt) < dayEnd.getTime();
}

export type DueCount = { due: number; fresh: number; total: number };

/**
 * Due today = seen cards due before the end of today + new cards, capped at what's left
 * of today's new-card allowance (review.md). For one subject, pass only its cards.
 */
export function countDue(cards: CardSchedule[], dayEnd: Date, newAllowanceLeft: number): DueCount {
  const due = cards.filter((c) => isDueToday(c, dayEnd)).length;
  const fresh = Math.min(cards.filter(isNew).length, Math.max(0, newAllowanceLeft));
  return { due, fresh, total: due + fresh };
}

/**
 * Per-subject counts for the Subjects banner, sharing the new-card allowance across subjects
 * (oldest new cards first) so the subject numbers add up to the banner total.
 */
export function dueBySubject(cards: CardSchedule[], dayEnd: Date, newAllowanceLeft: number): { total: number; bySubject: Map<string, number> } {
  const bySubject = new Map<string, number>();
  const add = (id: string) => bySubject.set(id, (bySubject.get(id) ?? 0) + 1);
  cards.filter((c) => isDueToday(c, dayEnd)).forEach((c) => add(c.subjectId));
  cards.filter(isNew).sort(byCreated).slice(0, Math.max(0, newAllowanceLeft)).forEach((c) => add(c.subjectId));
  let total = 0;
  bySubject.forEach((n) => (total += n));
  return { total, bySubject };
}

/** Allowance left today, from the number of new cards already met since local midnight. */
export function newAllowanceLeft(introducedToday: number): number {
  return Math.max(0, NEW_CARDS_PER_DAY - introducedToday);
}

// ---- queue -------------------------------------------------------------------

/**
 * Session queue (review.md): seen cards due now (oldest due first), then seen cards due
 * later today, then new cards oldest first up to the allowance. Cards from the same passage
 * are kept apart when another card can go between them.
 */
export function buildQueue(cards: CardSchedule[], now: Date, dayEnd: Date, newAllowance: number): CardSchedule[] {
  const t = now.getTime();
  const dueNow = cards.filter((c) => !isNew(c) && Date.parse(c.dueAt) <= t).sort(byDue);
  const later = cards.filter((c) => !isNew(c) && Date.parse(c.dueAt) > t && Date.parse(c.dueAt) < dayEnd.getTime()).sort(byDue);
  const fresh = cards.filter(isNew).sort(byCreated).slice(0, Math.max(0, newAllowance));
  return spreadByQuote([...dueNow, ...later, ...fresh]);
}

/** Greedy pass: when two neighbours share a passage, pull the next different card forward. */
export function spreadByQuote<T extends { quoteKey?: string | null }>(list: T[]): T[] {
  const out = [...list];
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1].quoteKey;
    if (!prev || out[i].quoteKey !== prev) continue;
    const j = out.findIndex((c, k) => k > i && c.quoteKey !== prev);
    if (j === -1) break; // nothing different left
    const [moved] = out.splice(j, 1);
    out.splice(i, 0, moved);
  }
  return out;
}

// ---- in-session re-queueing --------------------------------------------------

export type QueueItem = { id: string; availableAt: number };

/** After a grade: cards due again within 20 minutes come back later in this session. */
export function requeue(queue: QueueItem[], id: string, nextDueAt: string, now: Date): QueueItem[] {
  const rest = queue.filter((q) => q.id !== id);
  const due = Date.parse(nextDueAt);
  if (due - now.getTime() > SAME_SESSION_MS) return rest;
  return [...rest, { id, availableAt: due }];
}

/**
 * Index of the next card to show: the first one that's available now, or, when everything
 * left is waiting (e.g. only cards graded Again), the one that's due soonest.
 */
export function pickNext(queue: QueueItem[], now: Date): number {
  if (!queue.length) return -1;
  const ready = queue.findIndex((q) => q.availableAt <= now.getTime());
  if (ready !== -1) return ready;
  let best = 0;
  queue.forEach((q, i) => { if (q.availableAt < queue[best].availableAt) best = i; });
  return best;
}
