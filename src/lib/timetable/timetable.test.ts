import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dayOf, instantOf, isoOf, localOf, parseTimeValue, timeValue, weekLabel, weekStartOf } from "./dates";
import { buildFeed, escapeText, feedZone, foldLine, transitions, vtimezone, type FeedSlot } from "./feed";
import { parseDuration, parseIcs, parseLine, parseRule, unescapeText, unfold } from "./ics";
import { codeOwners, courseCodes, leftOutLine, matchSubject, planImport } from "./import";
import {
  cleanSkips, defaultTitle, isOccurrence, nextOccurrence, occurrences, overlapColumns, planDelete, planEdit, repeatLabel, slotError, snap, snapDown,
  weekItems, type SlotCore, type SlotLike,
} from "./slots";
import { zoneFromName } from "./zones";

const H = 3_600_000;
const D = 86_400_000;
const utc = (s: string) => Date.parse(s);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function slot(o: Partial<SlotLike> = {}): SlotLike {
  return {
    id: "s1", subjectId: null, kind: "class", title: null, location: null, tz: "Europe/London",
    startDate: "2026-10-19", startMin: 600, endMin: 660, recurrence: "weekly", repeatUntil: null, skipDates: [], ...o,
  };
}

describe("dates and time zones", () => {
  it("day numbers round-trip and reject impossible dates", () => {
    expect(isoOf(dayOf("2026-10-19"))).toBe("2026-10-19");
    expect(dayOf("2026-02-30")).toBeNaN();
    expect(dayOf("19-10-2026")).toBeNaN();
    expect(weekStartOf(dayOf("2026-10-21"))).toBe(dayOf("2026-10-19"));
    expect(weekStartOf(dayOf("2026-10-21"), "sun")).toBe(dayOf("2026-10-18"));
    expect(weekLabel(dayOf("2026-10-19"))).toBe("19 – 25 Oct");
    expect(weekLabel(dayOf("2026-09-28"))).toBe("28 Sep – 4 Oct");
  });

  it("local wall-clock time to instants, either side of a daylight saving change", () => {
    // London leaves BST on Sunday 25 October 2026.
    expect(instantOf("Europe/London", dayOf("2026-10-19"), 600)).toBe(utc("2026-10-19T09:00:00Z"));
    expect(instantOf("Europe/London", dayOf("2026-10-26"), 600)).toBe(utc("2026-10-26T10:00:00Z"));
    // Sydney starts daylight saving on 4 October 2026.
    expect(instantOf("Australia/Sydney", dayOf("2026-10-02"), 540)).toBe(utc("2026-10-01T23:00:00Z"));
    expect(instantOf("Australia/Sydney", dayOf("2026-10-05"), 540)).toBe(utc("2026-10-04T22:00:00Z"));
    expect(localOf("Asia/Singapore", utc("2026-10-19T16:30:00Z"))).toEqual({ day: dayOf("2026-10-20"), min: 30 });
  });

  it("a time in the spring-forward gap moves forward; the repeated hour picks the first", () => {
    // New York: 8 March 2026, 02:00 → 03:00.
    const gap = instantOf("America/New_York", dayOf("2026-03-08"), 150);
    expect(localOf("America/New_York", gap)).toEqual({ day: dayOf("2026-03-08"), min: 210 });
    // 1 November 2026, 01:30 happens twice (EDT then EST): the first is 05:30Z.
    expect(instantOf("America/New_York", dayOf("2026-11-01"), 90)).toBe(utc("2026-11-01T05:30:00Z"));
  });

  it("time field values", () => {
    expect(timeValue(545)).toBe("09:05");
    expect(timeValue(1440)).toBe("00:00");
    expect(parseTimeValue("09:05")).toBe(545);
    expect(parseTimeValue("23:59:00")).toBe(1439);
    expect(parseTimeValue("24:00")).toBeNull();
    expect(parseTimeValue("9:5")).toBeNull();
  });
});

describe("slot rules", () => {
  it("snaps to 15 minutes", () => {
    expect(snap(607)).toBe(600);
    expect(snap(608)).toBe(615);
    expect(snapDown(614)).toBe(600);
  });

  it("checks end after start and 12 hours at most", () => {
    expect(slotError({ startMin: 600, endMin: 600, startDate: "2026-10-19", repeatUntil: null, recurrence: "none" })).toBe("End has to be after the start.");
    expect(slotError({ startMin: 0, endMin: 735, startDate: "2026-10-19", repeatUntil: null, recurrence: "none" })).toBe("A slot can be up to 12 hours.");
    expect(slotError({ startMin: 720, endMin: 1440, startDate: "2026-10-19", repeatUntil: null, recurrence: "none" })).toBeNull();
    expect(slotError({ startMin: 600, endMin: 660, startDate: "2026-10-19", repeatUntil: "2026-10-12", recurrence: "weekly" })).toMatch(/Until/);
  });

  it("default titles", () => {
    expect(defaultTitle("class", "Biology")).toBe("Biology class");
    expect(defaultTitle("study", "Biology")).toBe("Study: Biology");
    expect(defaultTitle("other", "Biology")).toBe("Busy");
    expect(defaultTitle("class", null)).toBe("Class");
    expect(defaultTitle("study", null)).toBe("Study");
  });

  it("keeps skipped weeks that are real dates of the series", () => {
    expect(cleanSkips({ startDate: "2026-10-19", repeatUntil: "2026-11-30", recurrence: "weekly", skipDates: ["2026-11-02", "2026-10-20", "2026-12-07", "2026-11-02", "2026-10-12"] })).toEqual(["2026-11-02"]);
  });
});

describe("weekly repeats", () => {
  it("a 10:00 London class stays at 10:00 across the clock change", () => {
    const occ = occurrences(slot(), utc("2026-10-19T00:00:00Z"), utc("2026-11-03T00:00:00Z"));
    expect(occ.map((o) => new Date(o.start).toISOString())).toEqual(["2026-10-19T09:00:00.000Z", "2026-10-26T10:00:00.000Z", "2026-11-02T10:00:00.000Z"]);
    expect(occ.every((o) => o.end - o.start === H)).toBe(true);
  });

  it("skips weeks, stops at repeat_until and finds the next one", () => {
    const s = slot({ skipDates: ["2026-10-26"], repeatUntil: "2026-11-09" });
    const occ = occurrences(s, utc("2026-10-01T00:00:00Z"), utc("2027-01-01T00:00:00Z"));
    expect(occ.map((o) => o.date)).toEqual(["2026-10-19", "2026-11-02", "2026-11-09"]);
    expect(nextOccurrence(s, utc("2026-10-19T09:30:00Z"))?.date).toBe("2026-10-19"); // happening now
    expect(nextOccurrence(s, utc("2026-10-19T12:00:00Z"))?.date).toBe("2026-11-02");
    expect(nextOccurrence(s, utc("2026-11-10T00:00:00Z"))).toBeNull();
    expect(isOccurrence(s, "2026-11-02")).toBe(true);
    expect(isOccurrence(s, "2026-10-26")).toBe(false);
    expect(repeatLabel(s)).toBe("Every Monday until 9 Nov");
    expect(repeatLabel({ ...s, recurrence: "none" })).toBe("Just once");
  });

  it("an open-ended series years ahead is still cheap and exact", () => {
    const occ = occurrences(slot(), utc("2030-03-25T00:00:00Z"), utc("2030-04-08T00:00:00Z"));
    expect(occ.map((o) => o.date)).toEqual(["2030-03-25", "2030-04-01"]);
    expect(new Date(occ[1].start).toISOString()).toBe("2030-04-01T09:00:00.000Z"); // BST again
  });

  it("week view shows a slot in the student's own zone, and overlaps side by side", () => {
    const week = weekItems([slot()], dayOf("2026-10-19"), "Asia/Singapore");
    expect(week[0][0]).toMatchObject({ startMin: 17 * 60, endMin: 18 * 60 });
    const cols = overlapColumns([{ startMin: 600, endMin: 660 }, { startMin: 630, endMin: 690 }, { startMin: 660, endMin: 720 }, { startMin: 700, endMin: 720 }, { startMin: 720, endMin: 780 }]);
    expect(cols).toEqual([{ col: 0, cols: 2 }, { col: 1, cols: 2 }, { col: 0, cols: 2 }, { col: 1, cols: 2 }, { col: 0, cols: 1 }]);
  });
});

describe("Just this week / Every week", () => {
  const series: SlotCore = slot({ skipDates: ["2026-11-16"], repeatUntil: "2026-12-07" });
  const moved = (o: Partial<SlotCore>): SlotCore => ({ ...series, ...o });

  it("Just this week skips the date and makes a one-off with the change", () => {
    const plan = planEdit(series, "2026-11-02", "this", moved({ startDate: "2026-11-03", startMin: 660, endMin: 720 }));
    expect(plan).toEqual({
      update: { skipDates: ["2026-11-02", "2026-11-16"] },
      create: { ...series, startDate: "2026-11-03", startMin: 660, endMin: 720, recurrence: "none", repeatUntil: null, skipDates: [] },
      remove: false,
    });
  });

  it("Every week from a later week splits the series; earlier weeks keep the old time", () => {
    const plan = planEdit(series, "2026-11-02", "all", moved({ startDate: "2026-11-03", startMin: 660, endMin: 720 }));
    expect(plan).toEqual({
      update: { repeatUntil: "2026-11-01", skipDates: [] },
      // The skipped 16 Nov moves with the series to Tuesday 17 Nov.
      create: { ...series, startDate: "2026-11-03", startMin: 660, endMin: 720, skipDates: ["2026-11-17"] },
      remove: false,
    });
  });

  it("Every week from the first week changes the whole series", () => {
    const plan = planEdit(series, "2026-10-19", "all", moved({ location: "Room 1" }));
    expect(plan).toEqual({ update: { ...series, location: "Room 1" }, create: null, remove: false });
  });

  it("a one-off is simply changed; an invalid change is refused", () => {
    const once = { ...series, recurrence: "none" as const, repeatUntil: null, skipDates: [] };
    expect(planEdit(once, "2026-10-19", "this", { ...once, endMin: 700 })).toMatchObject({ update: { endMin: 700 }, create: null });
    expect(planEdit(series, "2026-10-19", "all", moved({ endMin: 500 }))).toEqual({ error: "End has to be after the start." });
    expect(planEdit(series, "2026-11-16", "this", series)).toEqual({ error: "That week isn't part of this slot any more." });
  });

  it("deleting: this week, every week from here, or the whole series", () => {
    expect(planDelete(series, "2026-10-26", "this")).toEqual({ update: { skipDates: ["2026-10-26", "2026-11-16"] }, create: null, remove: false });
    expect(planDelete(series, "2026-11-23", "all")).toEqual({ update: { repeatUntil: "2026-11-22" }, create: null, remove: false });
    expect(planDelete(series, "2026-10-19", "all")).toEqual({ update: null, create: null, remove: true });
    const full = { ...series, skipDates: Array.from({ length: 60 }, (_, i) => isoOf(dayOf("2026-10-26") + 7 * i)), repeatUntil: null };
    expect(planDelete(full, "2026-10-19", "this")).toEqual({ error: expect.stringMatching(/60 weeks/) });
  });
});

describe("ics reading", () => {
  it("unfolds lines (CRLF or LF, space or tab) and reads quoted parameters", () => {
    expect(unfold("SUMMARY:Bio\r\n logy\r\n\tLecture\nLOCATION:A")).toEqual(["SUMMARY:BiologyLecture", "LOCATION:A"]);
    const l = parseLine('DTSTART;TZID="Europe/London";VALUE=DATE-TIME:20261019T100000');
    expect(l?.name).toBe("DTSTART");
    expect(l?.params.get("TZID")).toBe("Europe/London");
    expect(l?.value).toBe("20261019T100000");
    expect(parseLine('X;P="a:b;c":value')?.params.get("P")).toBe("a:b;c");
    expect(parseLine("no colon here")).toBeNull();
  });

  it("unescapes text and reads durations and rules", () => {
    expect(unescapeText("Room 2.14\\, Main\\; North\\nFloor 2\\\\")).toBe("Room 2.14, Main; North\nFloor 2\\");
    expect(parseDuration("PT1H30M")).toBe(90 * 60_000);
    expect(parseDuration("P1W")).toBe(7 * D);
    expect(parseDuration("PT")).toBeNull();
    expect(parseRule("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261207T235959Z")).toMatchObject({ freq: "WEEKLY", byDay: [1, 3], interval: 1 });
    expect(parseRule("FREQ=MONTHLY;BYDAY=1TH")).toBeNull();
    expect(parseRule("FREQ=WEEKLY;BYDAY=1MO")).toBeNull();
    expect(parseRule("FREQ=WEEKLY;BYSETPOS=1")).toBeNull();
    expect(parseRule("FREQ=WEEKLY;INTERVAL=0")).toBeNull();
  });

  it("refuses text that isn't a calendar", () => {
    expect(parseIcs("hello")).toBeNull();
    expect(parseIcs("%PDF-1.7")).toBeNull();
    expect(parseIcs("﻿BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")?.events).toEqual([]);
  });

  it("knows Windows, Outlook and prefixed zone names", () => {
    expect(zoneFromName("GMT Standard Time")).toBe("Europe/London");
    expect(zoneFromName("AUS Eastern Standard Time")).toBe("Australia/Sydney");
    expect(zoneFromName("Singapore Standard Time")).toBe("Asia/Singapore");
    expect(zoneFromName("(UTC+10:00) Canberra, Melbourne, Sydney")).toBe("Australia/Sydney");
    expect(zoneFromName("(UTC+00:00) Dublin, Edinburgh, Lisbon, London")).toBe("Europe/London");
    expect(zoneFromName("/mozilla.org/20050126_1/Europe/Paris")).toBe("Europe/Paris");
    expect(zoneFromName("Europe/Berlin")).toBe("Europe/Berlin");
    expect(zoneFromName("Mars/Olympus")).toBeNull();
    expect(zoneFromName("Z")).toBe("UTC");
  });
});

const NOW = utc("2026-10-19T00:00:00Z"); // a Monday

describe("import: Google export with RRULE, EXDATE, a moved week and COUNT", () => {
  const file = parseIcs(fixture("google-export.ics"))!;

  it("reads the events (alarms ignored, escapes and folding undone)", () => {
    expect(file.events).toHaveLength(7);
    expect(file.events[0]).toMatchObject({ summary: "BIOL1001 Lecture", location: "Room 2.14, Main Building", uid: "biol1001-lec@uni.example" });
    expect(file.events[0].exdates).toHaveLength(2);
  });

  it("folds into weekly classes with skipped weeks, and says what was left out", () => {
    const plan = planImport(file, "Europe/London", NOW);
    const simple = plan.classes.map((c) => ({ title: c.title, startDate: c.startDate, time: [c.startMin, c.endMin], recurrence: c.recurrence, until: c.repeatUntil, skips: c.skipDates, dates: c.dates }));
    expect(simple).toEqual([
      { title: "BIOL1001 Lecture", startDate: "2026-10-19", time: [600, 660], recurrence: "weekly", until: "2026-12-07", skips: ["2026-11-02"], dates: 7 },
      { title: "BIOL1001 Lecture (moved)", startDate: "2026-10-21", time: [600, 660], recurrence: "none", until: null, skips: [], dates: 1 },
      { title: "CHEM1002 Practical", startDate: "2026-10-23", time: [840, 1020], recurrence: "weekly", until: "2026-11-27", skips: [], dates: 6 },
      { title: "BIOL1001 Lecture", startDate: "2026-10-28", time: [600, 660], recurrence: "weekly", until: "2026-12-02", skips: ["2026-11-04"], dates: 5 },
    ]);
    expect(plan.left).toMatchObject({ allDay: 1, past: 1, repeat: 1 });
    expect(leftOutLine(plan.left)).toBe("Left out: 1 all-day event, 1 past class, 1 event with a repeat we couldn't read.");
    expect(plan.groups.map((g) => [g.name, g.classes, g.when])).toEqual([
      ["BIOL1001 Lecture", 2, "Mon 10:00–11:00, weekly, 7 weeks; Wed 10:00–11:00, weekly, 5 weeks"],
      ["BIOL1001 Lecture (moved)", 1, "Wed 10:00–11:00, once"],
      ["CHEM1002 Practical", 1, "Fri 14:00–17:00, weekly, 6 weeks"],
    ]);
    expect(plan.fileZone).toBeNull();
    expect([plan.firstDate, plan.lastDate]).toEqual(["2026-10-19", "2026-12-07"]);
  });

  it("keys are stable between imports, and differ between classes", () => {
    const a = planImport(file, "Europe/London", NOW);
    const b = planImport(file, "Europe/London", NOW + 8 * D); // a week later: past weeks drop off
    const monday = (c: { startDate: string }) => new Date(c.startDate).getUTCDay() === 1;
    expect(b.classes.find((c) => c.recurrence === "weekly" && monday(c))).toMatchObject({ startDate: "2026-11-09", key: a.classes[0].key });
    expect(new Set(a.classes.map((c) => c.key)).size).toBe(a.classes.length);
  });

  it("a student in another zone sees local times, split where London's clocks change", () => {
    const plan = planImport(file, "Asia/Singapore", NOW);
    expect(plan.fileZone).toBe("Europe/London");
    const mondays = plan.classes.filter((c) => c.title === "BIOL1001 Lecture" && dayOf(c.startDate) % 7 === dayOf("2026-10-19") % 7);
    expect(mondays.map((c) => [c.startDate, c.startMin, c.recurrence])).toEqual([["2026-10-19", 17 * 60, "none"], ["2026-10-26", 18 * 60, "weekly"]]);
  });
});

/** A Syllabus Plus style export: every week its own event, Windows zone name, CRLF, folded lines. */
function weeklyEventsExport(): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Scientia//Syllabus Plus//EN",
    "BEGIN:VTIMEZONE", "TZID:GMT Standard Time",
    "BEGIN:STANDARD", "DTSTART:16010101T020000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10", "END:STANDARD",
    "BEGIN:DAYLIGHT", "DTSTART:16010101T010000", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3", "END:DAYLIGHT",
    "END:VTIMEZONE",
  ];
  let n = 0;
  const ev = (date: string, start: string, end: string, summary: string, location: string) => {
    lines.push("BEGIN:VEVENT", `UID:${++n}-2026@timetable.uni.example`, "DTSTAMP:20261001T080000Z",
      `DTSTART;TZID="GMT Standard Time":${date}T${start}00`, `DTEND;TZID="GMT Standard Time":${date}T${end}00`,
      `SUMMARY:${summary}`, `LOCATION:${location}`,
      "DESCRIPTION:Module: Introduction to Cell Biology\\nStaff: Dr A. Example\\nWeeks: 1-11\\nThis line is long enough that the export folds it across two lines",
      "END:VEVENT");
  };
  for (let w = 0; w < 11; w++) {
    const mon = dayOf("2026-09-28") + 7 * w;
    if (w === 5) continue; // reading week
    ev(isoOf(mon).replace(/-/g, ""), "0900", "1000", "BIOL1001/LEC/01 Lecture", "Room 2.14");
    ev(isoOf(mon + 3).replace(/-/g, ""), "1405", "1655", "BIOL1001/PRA/02 Practical", "Lab B\\, Science Block");
  }
  ev("20260930", "1100", "1200", "CHEM1002 Workshop", "Room 1.01"); // past
  return lines.map((l) => foldLine(l)).join("\r\n") + "\r\n";
}

describe("import: a uni export with every week as its own event", () => {
  it("rebuilds weekly classes with the reading week skipped, keeping exact minutes", () => {
    const file = parseIcs(weeklyEventsExport())!;
    const plan = planImport(file, "Europe/London", NOW);
    expect(plan.classes.map((c) => [c.title, c.startDate, c.startMin, c.endMin, c.recurrence, c.repeatUntil, c.skipDates, c.location])).toEqual([
      ["BIOL1001/LEC/01 Lecture", "2026-10-19", 540, 600, "weekly", "2026-12-07", ["2026-11-02"], "Room 2.14"],
      ["BIOL1001/PRA/02 Practical", "2026-10-22", 845, 1015, "weekly", "2026-12-10", ["2026-11-05"], "Lab B, Science Block"],
    ]);
    expect(plan.left.past).toBe(7); // three past weeks of each, and the workshop
  });

  it("a zone known only by its offsets matches the student's zone", () => {
    const text = weeklyEventsExport().replace(/GMT Standard Time/g, "Custom Campus Time");
    const plan = planImport(parseIcs(text)!, "Europe/London", NOW);
    expect(plan.classes).toHaveLength(2);
    expect(plan.left.unreadable).toBe(0);
  });
});

describe("import: edge cases", () => {
  const cal = (...body: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...body, "END:VCALENDAR"].join("\r\n");
  const ev = (...props: string[]) => ["BEGIN:VEVENT", ...props, "END:VEVENT"].join("\r\n");

  it("floating times use the calendar's zone, else the student's; Outlook zone names work", () => {
    const plan = planImport(parseIcs(cal("X-WR-TIMEZONE:Australia/Sydney", ev("UID:a", "SUMMARY:Stats", "DTSTART:20261020T090000", "DTEND:20261020T100000")))!, "Australia/Sydney", NOW);
    expect(plan.classes[0]).toMatchObject({ startDate: "2026-10-20", startMin: 540 });
    const outlook = planImport(parseIcs(cal(ev("UID:b", "SUMMARY:Stats", 'DTSTART;TZID="(UTC+10:00) Canberra, Melbourne, Sydney":20261020T090000', "DURATION:PT2H")))!, "Australia/Melbourne", NOW);
    expect(outlook.fileZone).toBe("Australia/Sydney");
    expect(outlook.classes[0]).toMatchObject({ startMin: 540, endMin: 660 });
  });

  it("daily rules with BYDAY, alternate weeks and RDATE", () => {
    const plan = planImport(parseIcs(cal(
      ev("UID:d", "SUMMARY:Lab", "DTSTART;TZID=Europe/London:20261019T090000", "DTEND;TZID=Europe/London:20261019T100000", "RRULE:FREQ=DAILY;BYDAY=MO,TU;COUNT=4"),
      ev("UID:e", "SUMMARY:Seminar", "DTSTART;TZID=Europe/London:20261020T150000", "DTEND;TZID=Europe/London:20261020T160000", "RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261201", "RDATE;TZID=Europe/London:20261208T150000"),
    ))!, "Europe/London", NOW);
    expect(plan.classes.map((c) => [c.title, c.startDate, c.recurrence, c.repeatUntil, c.skipDates])).toEqual([
      ["Lab", "2026-10-19", "weekly", "2026-10-26", []],
      ["Lab", "2026-10-20", "weekly", "2026-10-27", []],
      ["Seminar", "2026-10-20", "weekly", "2026-12-08", ["2026-10-27", "2026-11-10", "2026-11-24"]],
    ]);
  });

  it("leaves out what it can't show: over 12 hours, past midnight, unknown zones, broken dates", () => {
    const plan = planImport(parseIcs(cal(
      ev("UID:1", "SUMMARY:Exam", "DTSTART:20261020T080000Z", "DTEND:20261020T210000Z"),
      ev("UID:2", "SUMMARY:Night lab", "DTSTART:20261020T230000Z", "DTEND:20261021T010000Z"),
      ev("UID:3", "SUMMARY:Mars", "DTSTART;TZID=Mars/Olympus:20261020T080000", "DTEND;TZID=Mars/Olympus:20261020T090000"),
      ev("UID:4", "SUMMARY:Broken", "DTSTART:2026-10-20", "DTEND:20261020T090000Z"),
      ev("UID:5", "SUMMARY:Far away", "DTSTART:20280101T090000Z", "DTEND:20280101T100000Z"),
      ev("UID:6", "SUMMARY:Midnight end", "DTSTART:20261020T230000Z", "DTEND:20261021T000000Z"),
    ))!, "UTC", NOW);
    expect(plan.left).toMatchObject({ tooLong: 2, unreadable: 2, beyond: 1 });
    expect(plan.classes).toEqual([expect.objectContaining({ title: "Midnight end", startMin: 1380, endMin: 1440 })]);
  });

  it("stays fast on a hostile file (long lines, deep repeats, many events)", () => {
    const many = Array.from({ length: 3000 }, (_, i) => ev(`UID:${i}`, `SUMMARY:Class ${i % 40}`, "DTSTART:19900101T090000Z", "DTEND:19900101T100000Z", "RRULE:FREQ=DAILY"));
    const text = cal(`X-LONG:${"a".repeat(300_000)}`, ...many, `SUMMARY:${"\\".repeat(50_000)}`);
    const t0 = performance.now();
    const plan = planImport(parseIcs(text)!, "UTC", NOW);
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(plan.classes.length).toBeLessThanOrEqual(500);
  });
});

describe("subject matching", () => {
  const subjects = [{ id: "bio", name: "Biology" }, { id: "chem", name: "Chemistry" }, { id: "mb", name: "Marine Biology" }];
  it("by name (longest wins) or by a course code already used for the subject", () => {
    expect(courseCodes("BIOL1001/LEC/01 Lecture and CS 101")).toEqual(["BIOL1001", "CS101"]);
    const owners = codeOwners(subjects, [{ subjectId: "chem", title: "CHEM1002 Workshop" }]);
    expect(matchSubject("Marine Biology field trip", subjects, owners)).toBe("mb");
    expect(matchSubject("Intro to biology", subjects, owners)).toBe("bio");
    expect(matchSubject("CHEM1002 Practical", subjects, owners)).toBe("chem");
    expect(matchSubject("BIOL1001 Lecture", subjects, owners)).toBeNull();
  });
});

describe("calendar feed", () => {
  const subjects = [{ id: "bio", name: "Biology", emoji: "🧬" }];
  const slots: FeedSlot[] = [
    { ...slot({ id: "11111111-1111-4111-8111-111111111111", subjectId: "bio", location: "Room 2.14, Main; North", repeatUntil: "2026-12-07", skipDates: ["2026-11-02"] }), updatedAt: "2026-10-18T12:00:00.000Z" },
    { ...slot({ id: "22222222-2222-4222-8222-222222222222", kind: "study", subjectId: null, title: "Revise with Sam, chapter 3", recurrence: "none", startDate: "2026-10-21", startMin: 900, endMin: 1440 }), updatedAt: "2026-10-18T12:00:00.000Z" },
    { ...slot({ id: "33333333-3333-4333-8333-333333333333", kind: "other", tz: "UTC", startMin: 60, endMin: 120 }), updatedAt: "2026-10-18T12:00:00.000Z" },
  ];
  const text = buildFeed(slots, subjects, NOW);

  it("never puts anything but a real zone name in TZID (S4-4)", () => {
    expect(feedZone("Europe/London")).toBe("Europe/London");
    for (const bad of ["Europe/London\r\nBEGIN:VEVENT", "Mars/Olympus", "Europe/London:x", "Europe/London;X=1", "", "x".repeat(65)]) expect(feedZone(bad)).toBe("UTC");
    const evil = buildFeed([{ ...slots[0], tz: "Europe/London\r\nX-INJECTED:1" }], subjects, NOW);
    expect(evil).not.toContain("X-INJECTED");
    expect(evil).not.toContain("TZID=");
  });

  it("folds long lines with the same result as a byte-exact fold, and repeat feeds reuse zone rules", () => {
    for (const line of ["SUMMARY:" + "é".repeat(60), "SUMMARY:" + "🧬x".repeat(40), "SUMMARY:" + "a".repeat(200), "X:" + "€".repeat(24)]) {
      const parts = foldLine(line).split("\r\n ");
      expect(parts.join("")).toBe(line);
      parts.forEach((p, i) => expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(i ? 74 : 75));
    }
    const zones = Intl.supportedValuesOf("timeZone").slice(0, 100);
    const many = zones.map((tz, i) => ({ ...slots[0], id: `z${i}`, tz }));
    buildFeed(many, subjects, NOW);
    const t0 = performance.now();
    buildFeed(many, subjects, NOW);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it("is a valid calendar: CRLF, folded at 75 octets, escaped, stable UIDs", () => {
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(text).not.toMatch(/[^\r]\n/);
    const unfolded = unfold(text).join("\n");
    expect(unfolded).toContain("UID:11111111-1111-4111-8111-111111111111@studynest");
    expect(unfolded).toContain("SUMMARY:🧬 Biology class");
    expect(unfolded).toContain("LOCATION:Room 2.14\\, Main\\; North");
    expect(unfolded).toContain("SUMMARY:Revise with Sam\\, chapter 3");
    expect(unfolded).toContain("DTSTART;TZID=Europe/London:20261019T100000");
    expect(unfolded).toContain("RRULE:FREQ=WEEKLY;UNTIL=20261207T100000Z");
    expect(unfolded).toContain("EXDATE;TZID=Europe/London:20261102T100000");
    expect(unfolded).toContain("DTEND;TZID=Europe/London:20261022T000000"); // ends at midnight
    expect(unfolded).toContain("DTSTART:20261019T010000Z");
    expect(unfolded).toContain("BEGIN:VTIMEZONE\nTZID:Europe/London");
    expect(buildFeed(slots, subjects, NOW)).toBe(text); // same input, same file
  });

  it("an old slot doesn't push this year's daylight saving rules out of the zone", () => {
    const old = { ...slot({ id: "44444444-4444-4444-8444-444444444444", recurrence: "none", startDate: "2004-03-01" }), updatedAt: "2026-10-18T12:00:00.000Z" };
    const feed = unfold(buildFeed([old, slots[0]], subjects, NOW)).join("\n");
    expect(feed).toContain("DTSTART:20261025T020000"); // London's change back on 25 Oct 2026
    expect(feed).toContain("DTSTART:20260329T010000");
  });

  it("round-trips through the importer to the same classes", () => {
    const plan = planImport(parseIcs(text)!, "Europe/London", NOW);
    const bio = plan.classes.find((c) => c.title === "🧬 Biology class")!;
    expect(bio).toMatchObject({ startDate: "2026-10-19", startMin: 600, endMin: 660, recurrence: "weekly", repeatUntil: "2026-12-07", skipDates: ["2026-11-02"], location: "Room 2.14, Main; North" });
    expect(plan.classes.find((c) => c.title === "Revise with Sam, chapter 3")).toMatchObject({ startDate: "2026-10-21", startMin: 900, endMin: 1440, recurrence: "none" });
    expect(plan.left).toMatchObject({ unreadable: 0, repeat: 0 });
  });

  it("time zone rules match Intl: London changes at 01:00 UTC", () => {
    expect(transitions("Europe/London", utc("2026-01-01T00:00:00Z"), utc("2027-01-01T00:00:00Z")).map((t) => [new Date(t.at).toISOString(), t.before, t.after])).toEqual([
      ["2026-03-29T01:00:00.000Z", 0, 60], ["2026-10-25T01:00:00.000Z", 60, 0],
    ]);
    const tz = vtimezone("Europe/London", 2026, 2026).join("\n");
    expect(tz).toContain("BEGIN:DAYLIGHT\nDTSTART:20260329T010000\nTZOFFSETFROM:+0000\nTZOFFSETTO:+0100");
    expect(tz).toContain("BEGIN:STANDARD\nDTSTART:20261025T020000\nTZOFFSETFROM:+0100\nTZOFFSETTO:+0000");
    expect(vtimezone("Asia/Singapore", 2026, 2027).join("\n")).toContain("TZOFFSETTO:+0800");
  });

  it("escapes text and folds without splitting characters", () => {
    expect(escapeText("a,b;c\\d\ne\u0007")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldLine(`SUMMARY:${"🧬".repeat(30)}`);
    expect(folded.split("\r\n ").join("")).toBe(`SUMMARY:${"🧬".repeat(30)}`);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  });
});
