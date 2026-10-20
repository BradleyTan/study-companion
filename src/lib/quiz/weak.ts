// Weak-topic tracking (weak-topics.md "Tracking rules"). Pure: the server reads the topic's
// row, applies one of these and writes the result back.

/**
 * A topic matches case-insensitively and trimmed, per subject. Must equal the database's
 * generated `topic_key` (lower(btrim(topic)); stored topics already have single spaces), or a
 * lookup misses the row and the insert hits the unique key: no NFKC here ("Ca²⁺" stays "ca²⁺").
 */
export function topicKey(topic: string): string {
  return topic.replace(/\s+/g, " ").trim().toLowerCase();
}

export const TOPIC_MAX = 40;
/** The database stops at 500 weak topics per subject (trigger); the server checks first. */
export const WEAK_TOPICS_MAX = 500;

/** A typed topic name: control characters become spaces, runs of spaces collapse, ends trimmed. */
export function cleanTopic(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * "+ Add weak topic": the row to save for a topic the student adds by hand. A new topic has no
 * misses and no passages yet, and sorts first (lastMissedAt = now). An open one is left alone
 * ("already"); a cleared one comes back with its streak reset, keeping its history.
 */
export function addManual(cur: WeakState | null, topic: string, now: string): { status: "added" | "reopened"; next: WeakState } | { status: "already" } {
  if (!cur) return { status: "added", next: { topic, missCount: 0, rightStreak: 0, lastMissedAt: now, clearedAt: null, chunkIds: [], recent: [] } };
  if (!cur.clearedAt) return { status: "already" };
  return { status: "reopened", next: { ...cur, rightStreak: 0, lastMissedAt: now, clearedAt: null } };
}
/** Most recent passages remembered per topic (practice quizzes pull these). */
export const TOPIC_CHUNKS_MAX = 10;
/** Dots in the "Recent tries" row. */
export const RECENT_MAX = 5;
/** Right answers in a row that clear a topic. */
export const CLEAR_STREAK = 2;
/** Cleared topics older than this are hidden from the "Got it" list (still stored). */
export const GOT_IT_DAYS = 60;

export type WeakState = {
  topic: string;
  missCount: number;
  rightStreak: number;
  lastMissedAt: string | null;
  clearedAt: string | null;
  chunkIds: string[];
  /** Oldest → newest, true = right. */
  recent: boolean[];
};

/** What a miss changed, kept on the answer so "I was right" can undo exactly that miss. */
export type WeakPrev = { existed: boolean; rightStreak: number; clearedAt: string | null; lastMissedAt: string | null };

const pushRecent = (list: boolean[], v: boolean) => [...list, v].slice(-RECENT_MAX);

/**
 * A wrong answer or "I don't know": miss + 1, streak back to 0, a cleared topic comes back,
 * and the question's passage is remembered (most recent first, at most 10).
 */
export function applyMiss(cur: WeakState | null, topic: string, chunkId: string | null, now: string): { next: WeakState; prev: WeakPrev } {
  const prev: WeakPrev = cur
    ? { existed: true, rightStreak: cur.rightStreak, clearedAt: cur.clearedAt, lastMissedAt: cur.lastMissedAt }
    : { existed: false, rightStreak: 0, clearedAt: null, lastMissedAt: null };
  const chunks = chunkId ? [chunkId, ...(cur?.chunkIds ?? []).filter((c) => c !== chunkId)] : cur?.chunkIds ?? [];
  return {
    prev,
    next: {
      topic: cur?.topic ?? topic,
      missCount: (cur?.missCount ?? 0) + 1,
      rightStreak: 0,
      lastMissedAt: now,
      clearedAt: null,
      chunkIds: chunks.slice(0, TOPIC_CHUNKS_MAX),
      recent: pushRecent(cur?.recent ?? [], false),
    },
  };
}

/**
 * A right answer: only an open topic changes (streak + 1, cleared at 2 in a row). Null when
 * nothing changes (no topic, or it is already cleared).
 */
export function applyRight(cur: WeakState | null, now: string): WeakState | null {
  if (!cur || cur.clearedAt) return null;
  const streak = cur.rightStreak + 1;
  return { ...cur, rightStreak: streak, clearedAt: streak >= CLEAR_STREAK ? now : null, recent: pushRecent(cur.recent, true) };
}

/**
 * "I think my answer is right" takes the miss back: miss − 1 and the streak, cleared state and
 * last-missed time as they were before it; that try's ✗ becomes a ✓. Null = delete the row (no
 * misses left).
 */
export function undoMiss(cur: WeakState, prev: WeakPrev): WeakState | null {
  const missCount = Math.max(0, cur.missCount - 1);
  // A topic the student added by hand existed before its first miss: it stays, with no misses.
  if (missCount === 0 && !prev.existed) return null;
  const at = cur.recent.lastIndexOf(false);
  const recent = at >= 0 ? cur.recent.map((v, i) => (i === at ? true : v)) : cur.recent;
  // Right answers or "Mark as got it" since that miss: they stand. Restoring the state from
  // before the miss would wipe that progress (and reopen a topic the student has cleared).
  if (cur.rightStreak > 0 || cur.clearedAt) return { ...cur, missCount, recent };
  return { ...cur, missCount, rightStreak: prev.rightStreak, clearedAt: prev.clearedAt, lastMissedAt: prev.lastMissedAt ?? cur.lastMissedAt, recent };
}

/** Open list order: most recent miss first, ties by more misses. */
export function sortOpen<T extends Pick<WeakState, "lastMissedAt" | "missCount">>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.lastMissedAt ?? "").localeCompare(a.lastMissedAt ?? "") || b.missCount - a.missCount);
}

/** "Last 5 tries: missed, missed, right, missed, right". */
export function recentText(recent: boolean[]): string {
  if (!recent.length) return "No tries yet";
  return `Last ${recent.length} ${recent.length === 1 ? "try" : "tries"}: ${recent.map((r) => (r ? "right" : "missed")).join(", ")}`;
}

/** Topic names spoken in a list: "Krebs cycle, Osmosis +1" style (top `n`, then "+N"). */
export function topNames(names: string[], n = 2): { shown: string; more: number } {
  return { shown: names.slice(0, n).join(", "), more: Math.max(0, names.length - n) };
}
