import { describe, expect, it } from "vitest";
import * as copy from "./copy";
import {
  addFive, afterEnd, canAddFive, clock, complete, currentRun, DEFAULT_PREFS, displaySec, elapsedFraction, IDLE, isDue, LATE_MS, MAX_PLANNED_SEC, nextPhase, pause,
  remainingMs, resume, roundDots, start, stop, type Running, type SessionLog, type TimerState,
} from "./machine";
import { claimEnd, enqueue, flushQueue, parseTimer, QUEUE_KEY, readQueue, readTimer, STUCK_TRIES, TIMER_KEY, writeTimer, type KV } from "./store";
import { defaultSubjectId, subjectFromPath } from "./subject";
import { formatDuration, mergeSessions, todayTally, weekFocusSec, type TallySession } from "./tally";

const T0 = Date.parse("2026-10-19T09:00:00Z");
const MIN = 60_000;
const SID = "0d000000-0000-4000-8000-000000000001";
const BIO = "5a000000-0000-4000-8000-000000000001";
const prefs = DEFAULT_PREFS;

const focus = (now = T0, from: TimerState = IDLE, sessionId = SID): Running =>
  start(from, { phase: "focus", subjectId: BIO, plannedSec: 25 * 60, now, sessionId });

function memoryKV(): KV & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe("wall-clock timing", () => {
  it("shows 25:00 at the start and 00:00 only at the end (rounds up)", () => {
    const s = focus();
    expect(clock(displaySec(remainingMs(s, T0, prefs)))).toBe("25:00");
    expect(clock(displaySec(remainingMs(s, T0 + 1, prefs)))).toBe("25:00");
    expect(clock(displaySec(remainingMs(s, T0 + 1000, prefs)))).toBe("24:59");
    expect(clock(displaySec(remainingMs(s, T0 + 25 * MIN - 1, prefs)))).toBe("00:01");
    expect(clock(displaySec(remainingMs(s, T0 + 25 * MIN, prefs)))).toBe("00:00");
    expect(clock(displaySec(remainingMs(s, T0 + 90 * MIN, prefs)))).toBe("00:00");
  });

  it("time left is endsAt - now, however rarely it is looked at (background tab)", () => {
    const s = focus();
    // A hidden tab may only wake once a minute; the answer only depends on the clock.
    expect(remainingMs(s, T0 + 10 * MIN + 500, prefs)).toBe(15 * MIN - 500);
    expect(isDue(s, T0 + 25 * MIN - 1)).toBe(false);
    expect(isDue(s, T0 + 25 * MIN)).toBe(true);
  });

  it("pause keeps the time left and excludes the pause from focused time", () => {
    const s = focus();
    const p = pause(s, T0 + 5 * MIN);
    expect(p.remainingMs).toBe(20 * MIN);
    expect(p.focusedMs).toBe(5 * MIN);
    // An hour of pause changes nothing.
    expect(remainingMs(p, T0 + 65 * MIN, prefs)).toBe(20 * MIN);
    const r = resume(p, T0 + 65 * MIN);
    expect(r.endsAt).toBe(T0 + 85 * MIN);
    const done = complete(r, r.endsAt, prefs, "tab");
    expect(done.log?.focusedSec).toBe(25 * 60);
    expect(done.log?.endedAt).toBe(new Date(T0 + 85 * MIN).toISOString());
  });

  it("the ring drains as time passes", () => {
    const s = focus();
    expect(elapsedFraction(s, T0, prefs)).toBe(0);
    expect(elapsedFraction(s, T0 + 12.5 * MIN, prefs)).toBeCloseTo(0.5);
    expect(elapsedFraction(s, T0 + 30 * MIN, prefs)).toBe(1);
  });

  it("+5 min adds to the running phase only, up to 180 minutes", () => {
    let s: Running = start(IDLE, { phase: "focus", subjectId: null, plannedSec: 120 * 60, now: T0, sessionId: SID });
    s = addFive(s);
    expect(s.plannedSec).toBe(125 * 60);
    expect(s.endsAt).toBe(T0 + 125 * MIN);
    for (let i = 0; i < 20; i++) s = addFive(s);
    expect(s.plannedSec).toBe(MAX_PLANNED_SEC);
    expect(s.endsAt).toBe(T0 + 180 * MIN);
    expect(canAddFive(s)).toBe(false);
    const p = addFive(pause(focus(), T0 + MIN));
    expect(p.remainingMs).toBe(29 * MIN);
  });
});

describe("phase transitions", () => {
  it("logs ended_at = endsAt when the page wakes late, and is silent after 2 minutes", () => {
    const s = focus();
    const onTime = complete(s, s.endsAt + 500, prefs, "tab");
    expect(onTime.late).toBe(false);
    const late = complete(s, s.endsAt + 3 * 60 * MIN, prefs, "tab");
    expect(late.late).toBe(true);
    expect(late.state.ended.away).toBe(true);
    expect(late.log).toMatchObject({ clientKey: SID, kind: "focus", plannedSec: 1500, focusedSec: 1500, completed: true, subjectId: BIO, endedAt: new Date(s.endsAt).toISOString() });
    expect(complete(s, s.endsAt + LATE_MS - 1, prefs, "tab").late).toBe(false);
  });

  it("a long break comes after every 4th focus round in a run", () => {
    let st: TimerState = IDLE;
    const nexts: string[] = [];
    let now = T0;
    for (let i = 0; i < 8; i++) {
      const s = focus(now, st, crypto.randomUUID());
      const done = complete(s, s.endsAt, prefs, "tab");
      nexts.push(done.state.next);
      st = done.state;
      now = s.endsAt + 5 * MIN;
    }
    expect(nexts).toEqual(["short_break", "short_break", "short_break", "long_break", "short_break", "short_break", "short_break", "long_break"]);
    expect(nextPhase("short_break", { done: 3, lastEndAt: null }, prefs)).toBe("focus");
    expect(nextPhase("focus", { done: 3, lastEndAt: null }, { ...prefs, longEvery: 3 })).toBe("long_break");
  });

  it("a gap of over an hour or Done for now starts the run again", () => {
    const first = complete(focus(), T0 + 25 * MIN, prefs, "tab").state;
    expect(first.run.done).toBe(1);
    expect(currentRun(first.run, T0 + 25 * MIN + 59 * MIN).done).toBe(1);
    expect(focus(T0 + 25 * MIN + 61 * MIN, first).run.done).toBe(0);
    expect(afterEnd(first, "done").run.done).toBe(0);
    expect(afterEnd(first, "skip_break").run.done).toBe(1);
  });

  it("stopping saves the running time as not completed, and nothing under a minute", () => {
    const s = focus();
    expect(stop(s, T0 + 59_000).log).toBeNull();
    const out = stop(s, T0 + 12 * MIN + 30_000);
    expect(out.state).toMatchObject({ status: "idle", phase: "focus" });
    expect(out.log).toMatchObject({ completed: false, focusedSec: 12 * 60 + 30, endedAt: new Date(T0 + 12.5 * MIN).toISOString() });
    // Paused: pause time isn't focused time.
    const p = pause(s, T0 + 2 * MIN);
    expect(stop(p, T0 + 40 * MIN).log).toMatchObject({ focusedSec: 120, completed: false });
    // A stopped round doesn't count towards the long break.
    expect(out.state.run.done).toBe(0);
  });

  it("round dots: filled per round done, all filled on the long break", () => {
    let st: TimerState = IDLE;
    expect(roundDots(st, prefs, T0)).toEqual({ filled: 0, total: 4, round: 1 });
    let now = T0;
    for (let i = 0; i < 4; i++) {
      const s = focus(now, st, crypto.randomUUID());
      st = complete(s, s.endsAt, prefs, "tab").state;
      now = s.endsAt;
    }
    expect(roundDots(st, prefs, now)).toEqual({ filled: 4, total: 4, round: 4 });
    const brk = start(st, { phase: "long_break", subjectId: null, plannedSec: 900, now, sessionId: crypto.randomUUID() });
    expect(roundDots(brk, prefs, now)).toMatchObject({ filled: 4 });
    const next = focus(now + 15 * MIN, brk, crypto.randomUUID());
    expect(roundDots(next, prefs, now + 15 * MIN)).toEqual({ filled: 0, total: 4, round: 1 });
  });
});

describe("one tab handles an end", () => {
  it("only the first tab claims it; the others see it ended", () => {
    const kv = memoryKV();
    const s = focus();
    writeTimer(kv, s);
    expect(claimEnd(kv, SID, "tab-a", s.endsAt - 1, prefs)).toBeNull(); // not due yet
    const a = claimEnd(kv, SID, "tab-a", s.endsAt + 10, prefs);
    const b = claimEnd(kv, SID, "tab-b", s.endsAt + 20, prefs);
    expect(a?.log?.clientKey).toBe(SID);
    expect(b).toBeNull();
    const stored = readTimer(kv);
    expect(stored).toMatchObject({ status: "ended", ended: { handledBy: "tab-a", sessionId: SID } });
  });

  it("a tab can't end a session that was replaced, paused or stopped meanwhile", () => {
    const kv = memoryKV();
    const s = focus();
    writeTimer(kv, pause(s, T0 + MIN));
    expect(claimEnd(kv, SID, "tab-a", s.endsAt + 10, prefs)).toBeNull();
    writeTimer(kv, focus(T0, IDLE, crypto.randomUUID()));
    expect(claimEnd(kv, SID, "tab-a", s.endsAt + 10, prefs)).toBeNull();
  });

  it("ignores stored state that isn't a timer", () => {
    expect(parseTimer("{\"status\":\"running\"}")).toBeNull();
    expect(parseTimer("not json")).toBeNull();
    expect(parseTimer(null)).toBeNull();
    const kv = memoryKV();
    kv.setItem(TIMER_KEY, JSON.stringify({ ...focus(), plannedSec: 999_999 }));
    expect(readTimer(kv)).toBeNull();
    writeTimer(kv, focus());
    expect(readTimer(kv)).toEqual(focus());
  });
});

describe("retry queue", () => {
  const log = (key = crypto.randomUUID()): SessionLog => ({
    clientKey: key, subjectId: null, kind: "focus", plannedSec: 1500, focusedSec: 1500, completed: true,
    startedAt: new Date(T0).toISOString(), endedAt: new Date(T0 + 25 * MIN).toISOString(),
  });

  it("queues a round once and removes it when saved", async () => {
    const kv = memoryKV();
    const l = log();
    enqueue(kv, l);
    enqueue(kv, l);
    expect(readQueue(kv)).toHaveLength(1);
    const out = await flushQueue(kv, async () => "saved");
    expect(out.saved).toEqual([l]);
    expect(out.pending).toEqual([]);
    expect(kv.map.has(QUEUE_KEY)).toBe(false);
  });

  it("keeps failed saves with a try counted, drops rejected ones", async () => {
    const kv = memoryKV();
    const offline = log();
    const bad = log();
    enqueue(kv, offline);
    enqueue(kv, bad);
    for (let i = 0; i < STUCK_TRIES; i++) {
      await flushQueue(kv, async (l) => {
        if (l.clientKey === bad.clientKey) return "rejected";
        throw new Error("offline");
      });
    }
    expect(readQueue(kv)).toEqual([{ log: offline, tries: STUCK_TRIES }]);
    const back = await flushQueue(kv, async () => "saved");
    expect(back.saved.map((l) => l.clientKey)).toEqual([offline.clientKey]);
    expect(readQueue(kv)).toEqual([]);
  });

  it("keeps rounds another tab queued while saving", async () => {
    const kv = memoryKV();
    enqueue(kv, log());
    const late = log();
    await flushQueue(kv, async () => {
      enqueue(kv, late);
      return "saved";
    });
    expect(readQueue(kv).map((i) => i.log.clientKey)).toEqual([late.clientKey]);
  });
});

describe("tally", () => {
  const sess = (o: Partial<TallySession> & { endedAt: string }): TallySession => ({ clientKey: crypto.randomUUID(), subjectId: BIO, kind: "focus", focusedSec: 1500, completed: true, ...o });

  it("counts today's focus rounds in the student's time zone", () => {
    const now = new Date("2026-10-19T03:00:00Z"); // 11:00 in Singapore, still the 18th in New York
    const list = [
      sess({ endedAt: "2026-10-19T01:00:00Z" }),
      sess({ endedAt: "2026-10-19T02:00:00Z", completed: false, focusedSec: 600 }),
      sess({ endedAt: "2026-10-19T02:30:00Z", subjectId: null }),
      sess({ endedAt: "2026-10-19T02:35:00Z", kind: "short_break", focusedSec: 300 }),
      sess({ endedAt: "2026-10-18T15:00:00Z" }), // yesterday in Singapore
    ];
    expect(todayTally(list, "Asia/Singapore", now)).toEqual({
      rounds: 2,
      focusSec: 1500 + 600 + 1500,
      bySubject: [{ subjectId: BIO, sec: 2100 }, { subjectId: null, sec: 1500 }],
    });
    expect(todayTally(list, "America/New_York", now).rounds).toBe(3);
  });

  it("this week runs from Monday 00:00 local time", () => {
    const now = new Date("2026-10-21T12:00:00Z"); // Wednesday
    const list = [
      sess({ endedAt: "2026-10-19T00:30:00Z" }), // Monday 08:30 in Singapore
      sess({ endedAt: "2026-10-18T15:30:00Z" }), // Sunday 23:30 in Singapore
      sess({ endedAt: "2026-10-20T10:00:00Z", subjectId: null }),
    ];
    expect(weekFocusSec(list, BIO, "Asia/Singapore", now)).toBe(1500);
    expect(weekFocusSec(list, BIO, "UTC", now)).toBe(1500); // Sunday 15:30 UTC is last week
  });

  it("merges server rows and queued rounds once per client key", () => {
    const a = sess({ endedAt: "2026-10-19T01:00:00Z" });
    expect(mergeSessions([a], [a, sess({ endedAt: "2026-10-19T02:00:00Z" })])).toHaveLength(2);
  });

  it("formats durations", () => {
    expect(formatDuration(50 * 60)).toBe("50 min");
    expect(formatDuration(75 * 60)).toBe("1 h 15 min");
    expect(formatDuration(130 * 60)).toBe("2 h 10 min");
    expect(formatDuration(120 * 60)).toBe("2 h");
  });
});

describe("words", () => {
  it("end card and announcements", () => {
    expect(copy.endCard({ phase: "focus", next: "short_break", nextMin: 5, today: 3, longEvery: 4 })).toEqual({ heading: "Round done! 🍅", line: "That's 3 today. Time for a 5-minute break." });
    expect(copy.endCard({ phase: "focus", next: "long_break", nextMin: 15, today: 4, longEvery: 4 }).line).toBe("Four in a row! Take a proper 15-minute break.");
    expect(copy.endCard({ phase: "short_break", next: "focus", nextMin: 25, today: 4, longEvery: 4 })).toEqual({ heading: "Break's over", line: "Ready for another round?" });
    expect(copy.startAnnouncement("focus", 1500, "Biology", true)).toBe("Focus started: 25 minutes, Biology. Focus mode is on: sounds and animations are quieter.");
    expect(copy.startAnnouncement("short_break", 300, null, true)).toBe("Break started: 5 minutes.");
    expect(copy.pauseAnnouncement(18 * 60 + 42)).toBe("Paused with 18 minutes left.");
    expect(copy.awayLine("focus", Date.parse("2026-10-19T06:25:00Z"), "Asia/Singapore")).toBe("Your focus round finished at 14:25. Nice work!");
    expect(copy.awayLine("long_break", Date.parse("2026-10-19T06:30:00Z"), "Asia/Singapore")).toBe("Your break ended at 14:30.");
  });

  it("stop question, chip name, tab title and timer name", () => {
    expect(copy.stopQuestion(12 * 60 + 40, "Biology")).toBe("End this round? 12 min of Biology will be saved.");
    expect(copy.stopQuestion(59, "Biology")).toBe("End this round? It's under a minute, so it won't be saved.");
    expect(copy.chipName({ kind: "running", phase: "focus", sec: 18 * 60 + 42, subject: "Biology" })).toBe("Study timer: focus, 18 minutes left, Biology");
    expect(copy.chipName({ kind: "idle" })).toBe("Study timer, not running");
    expect(copy.tabTitle({ kind: "running", phase: "focus", sec: 18 * 60 + 42, subject: null }, false)).toBe("18:42 · Focus · StudyNest");
    expect(copy.tabTitle({ kind: "running", phase: "short_break", sec: 4 * 60 + 12, subject: null }, false)).toBe("4:12 · Break · StudyNest");
    expect(copy.tabTitle({ kind: "paused", phase: "focus", sec: 60, subject: null }, false)).toBe("Paused · StudyNest");
    expect(copy.tabTitle({ kind: "idle" }, true)).toBe("Time's up! · StudyNest");
    expect(copy.tabTitle({ kind: "idle" }, false)).toBeNull();
    expect(copy.timerName({ phase: "focus", paused: false, subject: "Biology", sec: 18 * 60 + 42, idle: false })).toBe("Focus, Biology, 18 minutes 42 seconds left");
  });
});

describe("default subject", () => {
  const ids = new Set([BIO, "5a000000-0000-4000-8000-000000000002"]);
  it("page subject, then study block, then last used, else none", () => {
    expect(subjectFromPath(`/subjects/${BIO}/flashcards`)).toBe(BIO);
    expect(subjectFromPath("/subjects")).toBeNull();
    expect(defaultSubjectId({ pathname: `/subjects/${BIO}/review`, lastUsed: "5a000000-0000-4000-8000-000000000002", subjectIds: ids })).toBe(BIO);
    expect(defaultSubjectId({ pathname: "/settings", studyBlockSubjectId: "5a000000-0000-4000-8000-000000000002", lastUsed: BIO, subjectIds: ids })).toBe("5a000000-0000-4000-8000-000000000002");
    expect(defaultSubjectId({ pathname: "/settings", lastUsed: BIO, subjectIds: ids })).toBe(BIO);
    // A deleted subject is skipped.
    expect(defaultSubjectId({ pathname: "/subjects/5a000000-0000-4000-8000-000000000009", lastUsed: "5a000000-0000-4000-8000-000000000008", subjectIds: ids })).toBeNull();
  });
});
