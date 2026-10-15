import { describe, expect, it } from "vitest";
import {
  buildQueue, countDue, dueBySubject, localDayBounds, localDayKey, newAllowanceLeft, NEW_CARDS_PER_DAY,
  pickNext, requeue, safeTimeZone, spreadByQuote, type CardSchedule,
} from "./due";
import { formatInterval } from "./format";
import { gradeCard, newSrs, previewIntervals, SAME_SESSION_MS } from "./scheduler";

const NOW = new Date("2026-10-14T09:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;

describe("FSRS scheduler", () => {
  it("starts a card as new and due now", () => {
    const s = newSrs(NOW);
    expect(s.state).toBe(0);
    expect(s.dueAt).toBe(NOW.toISOString());
    expect(s.reps).toBe(0);
  });

  it("orders intervals Again < Hard < Good < Easy for a new card", () => {
    const iv = previewIntervals(newSrs(NOW), NOW);
    expect(iv[1]).toBeLessThan(iv[2]);
    expect(iv[2]).toBeLessThan(iv[3]);
    expect(iv[3]).toBeLessThan(iv[4]);
    expect(iv[1]).toBe(1 * MIN); // default learning step 1 min
    expect(iv[1]).toBeLessThanOrEqual(SAME_SESSION_MS);
    expect(iv[4]).toBeGreaterThanOrEqual(DAY);
  });

  it("has no fuzz: the same grade at the same time gives the same due date", () => {
    let s = newSrs(NOW);
    s = gradeCard(s, 3, NOW);
    const later = new Date(Date.parse(s.dueAt));
    const a = gradeCard(s, 3, later);
    const b = gradeCard(s, 3, later);
    expect(a).toEqual(b);
    expect(previewIntervals(s, later)[3]).toBe(Date.parse(a.dueAt) - later.getTime());
  });

  it("grows intervals with repeated Good and shrinks after Again", () => {
    let s = gradeCard(newSrs(NOW), 4, NOW); // Easy: straight to review
    expect(s.state).toBe(2);
    let t = new Date(s.dueAt);
    const first = s.scheduledDays;
    s = gradeCard(s, 3, t);
    expect(s.scheduledDays).toBeGreaterThan(first);
    t = new Date(s.dueAt);
    const lapsed = gradeCard(s, 1, t);
    expect(lapsed.state).toBe(3); // relearning
    expect(lapsed.lapses).toBe(1);
    expect(Date.parse(lapsed.dueAt) - t.getTime()).toBeLessThanOrEqual(SAME_SESSION_MS);
  });

  it("records the review time and counts reps", () => {
    const s = gradeCard(newSrs(NOW), 3, NOW);
    expect(s.lastReviewAt).toBe(NOW.toISOString());
    expect(s.reps).toBe(1);
  });
});

describe("formatInterval", () => {
  it.each([
    [30_000, "in 1 min"], [MIN, "in 1 min"], [10 * MIN, "in 10 min"], [59 * MIN, "in 59 min"],
    [60 * MIN, "in 1 h"], [3 * 60 * MIN, "in 3 h"], [DAY, "in 1 day"], [4 * DAY, "in 4 days"],
    [14 * DAY, "in 2 wk"], [90 * DAY, "in 3 mo"], [365 * DAY, "in 1 yr"], [800 * DAY, "in 2 yr"],
  ])("%d ms → %s", (ms, text) => expect(formatInterval(ms)).toBe(text));
});

describe("time zones", () => {
  it("falls back to UTC for unknown zones", () => {
    expect(safeTimeZone("Mars/Base")).toBe("UTC");
    expect(safeTimeZone(null)).toBe("UTC");
    expect(safeTimeZone("Europe/London")).toBe("Europe/London");
  });

  it("finds the local day and its bounds", () => {
    // 09:00 UTC is 20:00 in Sydney (AEDT, +11) on the same date
    expect(localDayKey("Australia/Sydney", NOW)).toBe("2026-10-14");
    const { start, end } = localDayBounds("Australia/Sydney", NOW);
    expect(start.toISOString()).toBe("2026-10-13T13:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-14T13:00:00.000Z");
    // 23:30 UTC on the 14th is already the 15th in Sydney
    expect(localDayKey("Australia/Sydney", new Date("2026-10-14T23:30:00Z"))).toBe("2026-10-15");
  });

  it("handles a DST change inside the day", () => {
    // Europe/London leaves BST on 2026-10-25: that day is 25 hours long
    const { start, end } = localDayBounds("Europe/London", new Date("2026-10-25T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("works in UTC", () => {
    const { start, end } = localDayBounds("UTC", NOW);
    expect(start.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(DAY);
  });
});

const card = (id: string, over: Partial<CardSchedule> = {}): CardSchedule => ({
  id, subjectId: "s1", state: 2, dueAt: NOW.toISOString(), createdAt: "2026-10-01T00:00:00Z", ...over,
});

describe("due today", () => {
  const dayEnd = new Date("2026-10-15T00:00:00Z");
  const cards = [
    card("overdue", { dueAt: "2026-10-10T00:00:00Z" }),
    card("tonight", { dueAt: "2026-10-14T22:00:00Z" }),
    card("tomorrow", { dueAt: "2026-10-15T08:00:00Z" }),
    card("learning", { state: 1, dueAt: "2026-10-14T09:05:00Z" }),
    ...Array.from({ length: 25 }, (_, i) => card(`new${i}`, { state: 0, createdAt: `2026-10-0${1 + (i % 9)}T00:00:${String(i).padStart(2, "0")}Z` })),
  ];

  it("counts seen cards due before midnight plus new cards up to the allowance", () => {
    expect(countDue(cards, dayEnd, NEW_CARDS_PER_DAY)).toEqual({ due: 3, fresh: 20, total: 23 });
    expect(countDue(cards, dayEnd, 5)).toEqual({ due: 3, fresh: 5, total: 8 });
    expect(countDue(cards, dayEnd, 0).total).toBe(3);
    expect(countDue([], dayEnd, 20).total).toBe(0);
  });

  it("allowance left never goes negative", () => {
    expect(newAllowanceLeft(0)).toBe(20);
    expect(newAllowanceLeft(7)).toBe(13);
    expect(newAllowanceLeft(25)).toBe(0);
  });

  it("splits the new-card allowance across subjects, oldest first", () => {
    const list = [
      card("a1", { subjectId: "a", state: 0, createdAt: "2026-10-01T00:00:00Z" }),
      card("a2", { subjectId: "a", state: 0, createdAt: "2026-10-03T00:00:00Z" }),
      card("b1", { subjectId: "b", state: 0, createdAt: "2026-10-02T00:00:00Z" }),
      card("b2", { subjectId: "b", dueAt: "2026-10-14T01:00:00Z" }),
    ];
    const r = dueBySubject(list, dayEnd, 2);
    expect(r.total).toBe(3);
    expect(r.bySubject.get("a")).toBe(1);
    expect(r.bySubject.get("b")).toBe(2);
  });

  it("builds the queue: due now, later today, then new oldest first", () => {
    const q = buildQueue(cards, NOW, dayEnd, 2).map((c) => c.id);
    expect(q).toEqual(["overdue", "learning", "tonight", "new0", "new9"]);
  });

  it("keeps cards from the same passage apart when it can", () => {
    const list = [
      { id: "1", quoteKey: "p" }, { id: "2", quoteKey: "p" }, { id: "3", quoteKey: "q" }, { id: "4", quoteKey: null }, { id: "5", quoteKey: null },
    ];
    expect(spreadByQuote(list).map((c) => c.id)).toEqual(["1", "3", "2", "4", "5"]);
    expect(spreadByQuote([{ id: "1", quoteKey: "p" }, { id: "2", quoteKey: "p" }]).map((c) => c.id)).toEqual(["1", "2"]);
  });
});

describe("in-session queue", () => {
  it("puts a card graded Again back in the session and drops a learnt one", () => {
    const q = [{ id: "a", availableAt: 0 }, { id: "b", availableAt: 0 }];
    const again = requeue(q, "a", new Date(NOW.getTime() + MIN).toISOString(), NOW);
    expect(again).toEqual([{ id: "b", availableAt: 0 }, { id: "a", availableAt: NOW.getTime() + MIN }]);
    expect(requeue(q, "a", new Date(NOW.getTime() + DAY).toISOString(), NOW)).toEqual([{ id: "b", availableAt: 0 }]);
  });

  it("shows cards that are ready first, else the soonest waiting one", () => {
    const t = NOW.getTime();
    expect(pickNext([], NOW)).toBe(-1);
    expect(pickNext([{ id: "x", availableAt: t + 5 * MIN }, { id: "y", availableAt: t - 1 }], NOW)).toBe(1);
    expect(pickNext([{ id: "x", availableAt: t + 5 * MIN }, { id: "y", availableAt: t + MIN }], NOW)).toBe(1);
  });
});

describe("time zones: across a whole year (QA)", () => {
  // Odd offsets, half-hour DST (Lord Howe), the date line, southern-hemisphere DST.
  const zones = ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Pacific/Chatham", "Australia/Lord_Howe", "Asia/Kathmandu", "America/St_Johns", "America/Sao_Paulo", "Europe/London", "America/Los_Angeles", "Africa/Casablanca"];
  it("today's bounds always contain now and step to the next local date", () => {
    for (const tz of zones) {
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3_600_000 * 29) {
        const now = new Date(t);
        const { start, end } = localDayBounds(tz, now);
        const today = localDayKey(tz, now);
        expect(start.getTime()).toBeLessThanOrEqual(t);
        expect(end.getTime()).toBeGreaterThan(t);
        expect(localDayKey(tz, start)).toBe(today);
        expect(localDayKey(tz, new Date(end.getTime() - 1))).toBe(today);
        expect(localDayKey(tz, end)).not.toBe(today);
        const hours = (end.getTime() - start.getTime()) / 3_600_000;
        expect(hours).toBeGreaterThanOrEqual(23);
        expect(hours).toBeLessThanOrEqual(25);
      }
    }
  }, 30_000);
});
