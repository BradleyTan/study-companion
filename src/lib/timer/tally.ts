// Today's tally and this week's study time (timer.md "Today tally", subject.md "Study strip").
import { localDayBounds, localWeekStart } from "@/lib/srs/due";
import type { Phase } from "./machine";

/** A saved (or still queued) phase, as the tally needs it. */
export type TallySession = { clientKey: string; subjectId: string | null; kind: Phase; focusedSec: number; completed: boolean; endedAt: string };

/** Server rows and this browser's logged or queued rounds, once per client key. */
export function mergeSessions(...lists: TallySession[][]): TallySession[] {
  const byKey = new Map<string, TallySession>();
  for (const list of lists) for (const s of list) if (!byKey.has(s.clientKey)) byKey.set(s.clientKey, s);
  return [...byKey.values()];
}

export type Tally = {
  /** Completed focus rounds (the 🍅 stickers). */
  rounds: number;
  /** Focus time, stopped rounds included. */
  focusSec: number;
  bySubject: { subjectId: string | null; sec: number }[];
};

/** Focus rounds that ended today in the student's time zone. */
export function todayTally(sessions: TallySession[], tz: string, now: Date): Tally {
  const { start, end } = localDayBounds(tz, now);
  const today = sessions.filter((s) => s.kind === "focus" && Date.parse(s.endedAt) >= start.getTime() && Date.parse(s.endedAt) < end.getTime());
  const per = new Map<string | null, number>();
  for (const s of today) per.set(s.subjectId, (per.get(s.subjectId) ?? 0) + s.focusedSec);
  return {
    rounds: today.filter((s) => s.completed).length,
    focusSec: today.reduce((n, s) => n + s.focusedSec, 0),
    bySubject: [...per].map(([subjectId, sec]) => ({ subjectId, sec })).sort((a, b) => b.sec - a.sec),
  };
}

/** Focus seconds on a subject from Monday 00:00 (student's time zone) until now. */
export function weekFocusSec(sessions: TallySession[], subjectId: string, tz: string, now: Date): number {
  const from = localWeekStart(tz, now).getTime();
  return sessions
    .filter((s) => s.kind === "focus" && s.subjectId === subjectId && Date.parse(s.endedAt) >= from && Date.parse(s.endedAt) <= now.getTime())
    .reduce((n, s) => n + s.focusedSec, 0);
}

/** "50 min", "1 h 15 min", "2 h". */
export function formatDuration(sec: number): string {
  const mins = Math.round(sec / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
