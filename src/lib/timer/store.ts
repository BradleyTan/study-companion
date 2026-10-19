// Timer persistence (timer.md): the state lives in localStorage so a reload, a closed tab or a
// sleeping phone picks up where the clock is, every tab of the app sees the same timer (through
// the `storage` event), and exactly one tab handles an end. Rounds that couldn't be saved wait in
// a queue in localStorage and are retried on the next load or when the browser is back online.
import { z } from "zod";
import { complete, type Running, type SessionLog, type TimerPrefs, type TimerState } from "./machine";

export const TIMER_KEY = "studynest:timer";
export const QUEUE_KEY = "studynest:timer:queue";
/** Notifications switched on in this browser ("on"); settings.md: per browser, not the profile. */
export const NOTIFY_KEY = "studynest:timer:notify";
/** "Not now" on the nudge: hidden until this time (ms). */
export const NUDGE_KEY = "studynest:timer:nudge";
/** Set after the first completed focus round: the nudge may show from then on. */
export const NUDGE_READY_KEY = "studynest:timer:nudge-ready";
export const LAST_SUBJECT_KEY = "studynest:timer:subject";
export const NUDGE_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
/** After this many failed retries the tally says a round is waiting to be saved. */
export const STUCK_TRIES = 3;
const QUEUE_MAX = 200;

/** The parts of `localStorage` used here (a Map-backed fake in tests). */
export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

const phase = z.enum(["focus", "short_break", "long_break"]);
const ms = z.number().finite().nonnegative();
const run = z.object({ done: z.int().min(0).max(10_000), lastEndAt: ms.nullable() });
const active = {
  sessionId: z.uuid(),
  phase,
  subjectId: z.uuid().nullable(),
  plannedSec: z.int().min(60).max(180 * 60),
  startedAt: ms,
  focusedMs: ms,
  run,
};
const stateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle"), phase, run }),
  z.object({ status: z.literal("running"), ...active, endsAt: ms, resumedAt: ms }),
  z.object({ status: z.literal("paused"), ...active, remainingMs: ms }),
  z.object({
    status: z.literal("ended"),
    ended: z.object({ sessionId: z.uuid(), phase, subjectId: z.uuid().nullable(), endedAt: ms, away: z.boolean(), handledBy: z.string().max(64) }),
    next: phase,
    run,
  }),
]);

/** Stored state, or null when missing or not ours (a hand-edited or older value is ignored). */
export function parseTimer(raw: string | null): TimerState | null {
  if (!raw) return null;
  try {
    const r = stateSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function readTimer(kv: KV): TimerState | null {
  try { return parseTimer(kv.getItem(TIMER_KEY)); } catch { return null; }
}

export function writeTimer(kv: KV, s: TimerState) {
  try { kv.setItem(TIMER_KEY, JSON.stringify(s)); } catch {}
}

/**
 * Claims the end of `sessionId` for this tab. Only succeeds when the stored timer is still that
 * session, running and due: the first tab writes the ended state (with its id), so every other
 * tab finds it already ended and only shows the card. Callers run this inside a Web Lock when
 * the browser has them, which makes the read-then-write atomic across tabs; without locks, the
 * read-back afterwards catches a tab that wrote in between, and the log's client key keeps a
 * double save harmless.
 */
export function claimEnd(kv: KV, sessionId: string, tabId: string, now: number, prefs: TimerPrefs): ReturnType<typeof complete> | null {
  const cur = readTimer(kv);
  if (!cur || cur.status !== "running" || cur.sessionId !== sessionId || now < cur.endsAt) return null;
  const done = complete(cur as Running, now, prefs, tabId);
  writeTimer(kv, done.state);
  const back = readTimer(kv);
  if (!back || back.status !== "ended" || back.ended.handledBy !== tabId || back.ended.sessionId !== sessionId) return null;
  return done;
}

// ---- retry queue ----------------------------------------------------------------------

export type QueueItem = { log: SessionLog; tries: number };

const logSchema = z.object({
  clientKey: z.uuid(),
  subjectId: z.uuid().nullable(),
  kind: phase,
  plannedSec: z.int(),
  focusedSec: z.int(),
  completed: z.boolean(),
  startedAt: z.string().max(40),
  endedAt: z.string().max(40),
});
const queueSchema = z.array(z.object({ log: logSchema, tries: z.int().min(0) })).max(QUEUE_MAX * 2);

export function readQueue(kv: KV): QueueItem[] {
  try {
    const raw = kv.getItem(QUEUE_KEY);
    if (!raw) return [];
    const r = queueSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}

function writeQueue(kv: KV, q: QueueItem[]) {
  try {
    if (q.length) kv.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)));
    else kv.removeItem(QUEUE_KEY);
  } catch {}
}

/** Adds a round to the queue (once per client key). */
export function enqueue(kv: KV, log: SessionLog): QueueItem[] {
  const q = readQueue(kv);
  if (!q.some((i) => i.log.clientKey === log.clientKey)) q.push({ log, tries: 0 });
  writeQueue(kv, q);
  return q;
}

/** "saved": in the database (or already was); "rejected": the server will never take it (dropped). Throwing means try again later. */
export type SaveOutcome = "saved" | "rejected";

/**
 * Tries to save every queued round. Saved and rejected rounds leave the queue; a round whose save
 * threw stays with one more try counted. The queue is read again before writing, so rounds another
 * tab added meanwhile are kept.
 */
export async function flushQueue(kv: KV, save: (log: SessionLog) => Promise<SaveOutcome>): Promise<{ saved: SessionLog[]; pending: QueueItem[] }> {
  const items = readQueue(kv);
  const done = new Set<string>();
  const failed = new Set<string>();
  const saved: SessionLog[] = [];
  for (const it of items) {
    try {
      const out = await save(it.log);
      done.add(it.log.clientKey);
      if (out === "saved") saved.push(it.log);
    } catch {
      failed.add(it.log.clientKey);
    }
  }
  const pending = readQueue(kv)
    .filter((i) => !done.has(i.log.clientKey))
    .map((i) => (failed.has(i.log.clientKey) ? { ...i, tries: i.tries + 1 } : i));
  writeQueue(kv, pending);
  return { saved, pending };
}
