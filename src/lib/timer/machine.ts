// Study timer state machine (docs/design/screens/timer.md "Rules the developer must match").
// Pure functions of the state and `now` (ms since epoch): no ticks are counted, the time left is
// always `endsAt - now`, so a throttled background tab or a sleeping phone can't drift.

export type Phase = "focus" | "short_break" | "long_break";
export const PHASES: Phase[] = ["focus", "short_break", "long_break"];

export type TimerPrefs = {
  focusMin: number;
  shortMin: number;
  longMin: number;
  /** A long break after this many focus rounds in a row. */
  longEvery: number;
  /** Start the next phase by itself at the end. */
  autoStart: boolean;
  /** Focus mode (only the chime plays, calmer motion) during focus rounds. */
  focusQuiet: boolean;
};
export const DEFAULT_PREFS: TimerPrefs = { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStart: false, focusQuiet: true };

/** Stepper ranges (timer.md "Durations", settings.md). */
export const RANGES = {
  focusMin: { min: 5, max: 120, step: 5 },
  shortMin: { min: 1, max: 30, step: 1 },
  longMin: { min: 5, max: 60, step: 5 },
  longEvery: { min: 2, max: 8, step: 1 },
} as const;
export type DurationKey = keyof typeof RANGES;
export const PHASE_PREF: Record<Phase, Exclude<DurationKey, "longEvery">> = { focus: "focusMin", short_break: "shortMin", long_break: "longMin" };

/** "+5 min" never takes a phase past 180 minutes. */
export const MAX_PLANNED_SEC = 180 * 60;
export const ADD_SEC = 5 * 60;
/** Rounds with less running time than this are not saved. */
export const MIN_LOG_SEC = 60;
/** An end noticed later than this (phone asleep, tab closed) is silent: no chime, no auto-start. */
export const LATE_MS = 2 * 60 * 1000;
/** A gap longer than this between focus rounds starts a new run at round 1. */
export const RUN_GAP_MS = 60 * 60 * 1000;

/** Focus rounds completed in the current run (for the long break and the round dots). */
export type Run = { done: number; lastEndAt: number | null };
export const NEW_RUN: Run = { done: 0, lastEndAt: null };

type Active = {
  /** Also the log's client key, so a retried save logs once. */
  sessionId: string;
  phase: Phase;
  subjectId: string | null;
  plannedSec: number;
  /** When the phase was first started (ms). */
  startedAt: number;
  /** Running time before the current stretch (pauses excluded). */
  focusedMs: number;
  run: Run;
};
export type Running = Active & { status: "running"; endsAt: number; resumedAt: number };
export type Paused = Active & { status: "paused"; remainingMs: number };
export type EndInfo = {
  sessionId: string;
  phase: Phase;
  subjectId: string | null;
  endedAt: number;
  /** Noticed more than LATE_MS after the end: no chime, the panel says when it finished. */
  away: boolean;
  /** The tab that handled the end (the only one that chimes, notifies and logs). */
  handledBy: string;
};
export type Ended = { status: "ended"; ended: EndInfo; next: Phase; run: Run };
export type Idle = { status: "idle"; phase: Phase; run: Run };
export type TimerState = Idle | Running | Paused | Ended;

export const IDLE: Idle = { status: "idle", phase: "focus", run: NEW_RUN };

/** What gets saved for a phase that ended (study_sessions row). */
export type SessionLog = {
  clientKey: string;
  subjectId: string | null;
  kind: Phase;
  plannedSec: number;
  focusedSec: number;
  completed: boolean;
  startedAt: string;
  endedAt: string;
};

export const isActive = (s: TimerState): s is Running | Paused => s.status === "running" || s.status === "paused";

export function plannedFor(phase: Phase, prefs: TimerPrefs): number {
  return prefs[PHASE_PREF[phase]] * 60;
}

/** The run as it stands at `now`: a gap of over an hour since the last round starts over. */
export function currentRun(run: Run, now: number): Run {
  return run.lastEndAt !== null && now - run.lastEndAt > RUN_GAP_MS ? NEW_RUN : run;
}

export function remainingMs(s: TimerState, now: number, prefs: TimerPrefs): number {
  switch (s.status) {
    case "running": return Math.max(0, s.endsAt - now);
    case "paused": return Math.max(0, s.remainingMs);
    case "idle": return plannedFor(s.phase, prefs) * 1000;
    case "ended": return 0;
  }
}

/** Whole seconds shown, rounded up: 25:00 at the start, 0:00 only at the end. */
export const displaySec = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/** "25:00", "04:12" (ring digits). */
export function clock(sec: number, pad = true): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad ? String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
}

/** Share of the phase gone, 0..1 (the ring drains focus and fills breaks with it). */
export function elapsedFraction(s: TimerState, now: number, prefs: TimerPrefs): number {
  if (s.status === "ended") return 1;
  if (s.status === "idle") return 0;
  const total = s.plannedSec * 1000;
  return Math.min(1, Math.max(0, 1 - remainingMs(s, now, prefs) / total));
}

export function start(prev: TimerState, opts: { phase: Phase; subjectId: string | null; plannedSec: number; now: number; sessionId: string }): Running {
  const plannedSec = Math.min(MAX_PLANNED_SEC, Math.max(60, Math.round(opts.plannedSec)));
  return {
    status: "running",
    sessionId: opts.sessionId,
    phase: opts.phase,
    subjectId: opts.subjectId,
    plannedSec,
    startedAt: opts.now,
    focusedMs: 0,
    run: currentRun(prev.run, opts.now),
    endsAt: opts.now + plannedSec * 1000,
    resumedAt: opts.now,
  };
}

export function pause(s: Running, now: number): Paused {
  const at = Math.min(now, s.endsAt);
  const { endsAt, resumedAt, ...rest } = s;
  return { ...rest, status: "paused", remainingMs: Math.max(0, endsAt - at), focusedMs: s.focusedMs + Math.max(0, at - resumedAt) };
}

export function resume(s: Paused, now: number): Running {
  const { remainingMs: left, ...rest } = s;
  return { ...rest, status: "running", endsAt: now + left, resumedAt: now };
}

export const canAddFive = (s: TimerState) => isActive(s) && s.plannedSec < MAX_PLANNED_SEC;

/** "+5 min": adds to this phase only, up to 180 minutes in all. */
export function addFive<S extends Running | Paused>(s: S): S {
  const add = Math.max(0, Math.min(ADD_SEC, MAX_PLANNED_SEC - s.plannedSec));
  if (!add) return s;
  if (s.status === "running") return { ...s, plannedSec: s.plannedSec + add, endsAt: (s as Running).endsAt + add * 1000 };
  return { ...s, plannedSec: s.plannedSec + add, remainingMs: (s as Paused).remainingMs + add * 1000 };
}

export const isDue = (s: TimerState, now: number) => s.status === "running" && now >= s.endsAt;

function toLog(s: Running | Paused, focusedMs: number, endedAt: number, completed: boolean): SessionLog | null {
  const focusedSec = Math.min(s.plannedSec, Math.floor(focusedMs / 1000), Math.floor((endedAt - s.startedAt) / 1000));
  if (focusedSec < MIN_LOG_SEC) return null;
  return {
    clientKey: s.sessionId,
    subjectId: s.subjectId,
    kind: s.phase,
    plannedSec: s.plannedSec,
    focusedSec,
    completed,
    startedAt: new Date(s.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
  };
}

/** The phase after a completed one. */
export function nextPhase(ended: Phase, run: Run, prefs: TimerPrefs): Phase {
  if (ended !== "focus") return "focus";
  return run.done > 0 && run.done % prefs.longEvery === 0 ? "long_break" : "short_break";
}

/**
 * A running phase reached its end. The end is always `endsAt` (also when the page only wakes
 * up later), so the log and the tally never count time the student wasn't there.
 */
export function complete(s: Running, now: number, prefs: TimerPrefs, handledBy: string): { state: Ended; log: SessionLog | null; late: boolean } {
  const endedAt = s.endsAt;
  const late = now - endedAt >= LATE_MS;
  const log = toLog(s, s.focusedMs + Math.max(0, endedAt - s.resumedAt), endedAt, true);
  const run = s.phase === "focus" ? { done: s.run.done + 1, lastEndAt: endedAt } : s.run;
  return {
    state: { status: "ended", ended: { sessionId: s.sessionId, phase: s.phase, subjectId: s.subjectId, endedAt, away: late, handledBy }, next: nextPhase(s.phase, run, prefs), run },
    log,
    late,
  };
}

/** Running time so far (for "End this round? 12 min of Biology will be saved."). */
export function focusedSoFar(s: Running | Paused, now: number): number {
  return Math.floor((s.status === "running" ? s.focusedMs + Math.max(0, Math.min(now, s.endsAt) - s.resumedAt) : s.focusedMs) / 1000);
}

/** "Stop" (focus) or "Skip break" (break): saved as not completed when it ran a minute or more. */
export function stop(s: Running | Paused, now: number): { state: Idle; log: SessionLog | null } {
  const at = s.status === "running" ? Math.min(now, s.endsAt) : now;
  const log = toLog(s, focusedSoFar(s, now) * 1000, Math.max(at, s.startedAt + 1000), false);
  return { state: { status: "idle", phase: "focus", run: s.run }, log };
}

/** End card buttons. "Done for now" ends the run (back to round 1). */
export function afterEnd(s: Ended, choice: "skip_break" | "done"): Idle {
  return { status: "idle", phase: "focus", run: choice === "done" ? NEW_RUN : s.run };
}

export function selectPhase(s: Idle, phase: Phase): Idle {
  return { ...s, phase };
}

/** The subject dropped out (deleted while running): the round goes on as "No subject". */
export function setSubject<S extends TimerState>(s: S, subjectId: string | null): S {
  return isActive(s) ? { ...s, subjectId } : s;
}

/**
 * Round dots: `longEvery` dots, filled for rounds done in this run. During a long break (or on
 * the card after the round that earned it) every dot is filled.
 */
export function roundDots(s: TimerState, prefs: TimerPrefs, now: number): { filled: number; total: number; round: number } {
  const total = prefs.longEvery;
  const run = s.status === "idle" ? currentRun(s.run, now) : s.run;
  const r = run.done % total;
  const full = run.done > 0 && r === 0 && (
    (isActive(s) && s.phase === "long_break") || (s.status === "ended" && s.next === "long_break")
  );
  const filled = full ? total : r;
  return { filled, total, round: Math.min(total, r + 1) };
}
