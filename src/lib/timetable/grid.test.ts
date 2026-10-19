import { describe, expect, it } from "vitest";
import { dayOf, instantOf } from "./dates";
import { agoLabel, clickRange, dayLabel, dragRange, minuteAt, moveRange, movedLine, nearestOutside, resizeEnd, scrollMinute, slotName, tapRange, webcalUrl } from "./grid";
import type { SlotLike } from "./slots";

const H = 48;

describe("grid maths", () => {
  it("snaps a y offset down to 15 minutes and stays inside the day", () => {
    expect(minuteAt(0, H)).toBe(0);
    expect(minuteAt(10 * H + 11, H)).toBe(600); // 10:13 → 10:00
    expect(minuteAt(10 * H + 13, H)).toBe(615); // 10:16 → 10:15
    expect(minuteAt(-20, H)).toBe(0);
    expect(minuteAt(25 * H, H)).toBe(1425);
  });

  it("drags in 15-minute steps either way, 12 hours at most", () => {
    expect(dragRange(600, 600)).toEqual({ startMin: 600, endMin: 615 });
    expect(dragRange(600, 675)).toEqual({ startMin: 600, endMin: 690 });
    expect(dragRange(600, 540)).toEqual({ startMin: 540, endMin: 615 });
    expect(dragRange(60, 1425)).toEqual({ startMin: 60, endMin: 780 });
    expect(dragRange(1425, 0)).toEqual({ startMin: 720, endMin: 1440 });
  });

  it("click makes an hour, tap picks the hour or half hour", () => {
    expect(clickRange(615)).toEqual({ startMin: 615, endMin: 675 });
    expect(clickRange(1425)).toEqual({ startMin: 1425, endMin: 1440 });
    expect(tapRange(10 * H + 5, H)).toEqual({ startMin: 600, endMin: 660 });
    expect(tapRange(10.6 * H, H)).toEqual({ startMin: 630, endMin: 690 });
    expect(tapRange(23.9 * H, H)).toEqual({ startMin: 1380, endMin: 1440 });
  });

  it("moves keep the length inside the day; resizes stay 15 min to 12 h", () => {
    expect(moveRange(600, 660, 37)).toEqual({ startMin: 630, endMin: 690 });
    expect(moveRange(600, 660, -700)).toEqual({ startMin: 0, endMin: 60 });
    expect(moveRange(600, 660, 1000)).toEqual({ startMin: 1380, endMin: 1440 });
    expect(resizeEnd(600, 660, 22)).toBe(675);
    expect(resizeEnd(600, 660, -120)).toBe(615);
    expect(resizeEnd(600, 660, 2000)).toBe(1320);
    expect(resizeEnd(1200, 1260, 600)).toBe(1440);
  });

  it("scrolls to 30 minutes before the earliest slot, else 8:00", () => {
    expect(scrollMinute([])).toBe(480);
    expect(scrollMinute([600, 540])).toBe(510);
    expect(scrollMinute([15])).toBe(0);
  });
});

describe("spoken names", () => {
  it("spells out the slot", () => {
    expect(slotName({ kind: "class", title: "BIOL1001 Lecture", subjectName: "Biology", startMin: 600, endMin: 660, location: "Room 2.14", weekly: true }))
      .toBe("Class, Biology, BIOL1001 Lecture, 10:00 to 11:00, Room 2.14, every week");
    expect(slotName({ kind: "study", title: null, subjectName: null, startMin: 540, endMin: 570, location: null, weekly: false }))
      .toBe("Study, no subject, Study, 9:00 to 9:30, just once");
  });

  it("labels days and moves", () => {
    const d = dayOf("2026-10-19");
    expect(dayLabel(d, d)).toBe("Today, Monday 19 October");
    expect(dayLabel(d + 1, d)).toBe("Tuesday 20 October");
    expect(movedLine("Biology class", d + 1, 660, 720)).toBe("Biology class moved to Tuesday, 11:00 to 12:00.");
  });
});

describe("nearestOutside", () => {
  const tz = "Europe/London";
  const slot = (id: string, startDate: string, weekly = false): SlotLike => ({
    id, subjectId: null, kind: "class", title: null, location: null, tz, startDate, startMin: 600, endMin: 660,
    recurrence: weekly ? "weekly" : "none", repeatUntil: null, skipDates: [],
  });
  const week = dayOf("2026-10-19");
  const from = instantOf(tz, week, 0), to = instantOf(tz, week + 7, 0);

  it("finds the first slot after the week", () => {
    const r = nearestOutside([slot("a", "2026-11-10"), slot("b", "2026-11-03")], from, to, tz);
    expect(r?.week).toBe("2026-11-03");
  });
  it("falls back to the last one before it", () => {
    const r = nearestOutside([slot("a", "2026-09-01"), slot("b", "2026-10-06")], from, to, tz);
    expect(r?.week).toBe("2026-10-06");
  });
  it("for a weekly series that ended, falls back to its last week, not its first", () => {
    const ended = { ...slot("a", "2026-09-07", true), repeatUntil: "2026-10-05" };
    expect(nearestOutside([ended], from, to, tz)?.week).toBe("2026-10-05");
  });
  it("is null with no slots", () => {
    expect(nearestOutside([], from, to, tz)).toBeNull();
  });
});

describe("calendar link labels", () => {
  it("says how long ago", () => {
    const now = Date.UTC(2026, 9, 19, 12);
    expect(agoLabel(now - 20_000, now)).toBe("just now");
    expect(agoLabel(now - 60_000, now)).toBe("1 minute ago");
    expect(agoLabel(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(agoLabel(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });
  it("makes a webcal link", () => {
    expect(webcalUrl("https://studynest.app/api/calendar/abc.ics")).toBe("webcal://studynest.app/api/calendar/abc.ics");
    expect(webcalUrl("http://localhost:3000/api/calendar/abc.ics")).toBe("webcal://localhost:3000/api/calendar/abc.ics");
  });
});
