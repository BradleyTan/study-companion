import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
process.env.NEXT_PUBLIC_SITE_URL = "https://studynest.test";
const actions = await import("./timetable");
const { calendarFile } = await import("../calendar");
const { createSlot, editSlot, deleteSlot, undoSlotDelete, previewImport, addImport, undoImport, makeCalendarLink, resetCalendarLink, turnOffCalendarLink, getCalendarLink } = actions;

const form = (o: Record<string, unknown> = {}) => ({
  kind: "class", subjectId: null, title: "", location: "", date: "2026-10-19", startMin: 600, endMin: 660, repeats: "weekly", until: null, ...o,
});
const icsFile = (text: string, name = "timetable.ics") => {
  const f = new FormData();
  f.set("file", new File([text], name, { type: "text/calendar" }));
  return f;
};
const fixture = readFileSync(new URL("../../lib/timetable/fixtures/google-export.ics", import.meta.url), "utf8");

describe("slots", () => {
  let bio: string;
  beforeEach(async () => {
    repo = demoRepo(crypto.randomUUID());
    await repo.updateProfile({ timezone: "Europe/London" });
    bio = (await repo.createSubject({ name: "Biology", colour: "mint", emoji: "🧬" })).id;
  });

  it("creates a weekly class in the student's time zone with the default title", async () => {
    const res = await createSlot(form({ subjectId: bio, location: "  Room 2.14 " }));
    expect(res.ok).toBe(true);
    const [s] = await repo.listSlots();
    expect(s).toMatchObject({ subjectId: bio, kind: "class", title: null, location: "Room 2.14", tz: "Europe/London", recurrence: "weekly", source: "manual" });
  });

  it("refuses broken slots with the form's words", async () => {
    expect(await createSlot(form({ endMin: 600 }))).toEqual({ ok: false, error: "End has to be after the start." });
    expect(await createSlot(form({ startMin: 0, endMin: 780 }))).toEqual({ ok: false, error: "A slot can be up to 12 hours." });
    expect(await createSlot(form({ date: "2026-02-30" }))).toMatchObject({ ok: false });
    expect(await createSlot(form({ kind: "party" }))).toMatchObject({ ok: false });
    expect(await createSlot(form({ title: "x".repeat(81) }))).toEqual({ ok: false, error: "Keep the title under 80 characters." });
  });

  it("caps a student at 300 slots", async () => {
    await repo.createSlots(Array.from({ length: 300 }, () => ({
      subjectId: null, kind: "other" as const, title: null, location: null, tz: "UTC", startDate: "2026-10-19", startMin: 0, endMin: 15,
      recurrence: "none" as const, repeatUntil: null, skipDates: [], source: "manual" as const, importUid: null, importBatch: null,
    })));
    expect(await createSlot(form())).toEqual({ ok: false, error: "You've reached 300 slots. Delete a few old ones first." });
  });

  it("Just this week and Every week edits", async () => {
    const { id } = (await createSlot(form({ subjectId: bio }))) as { id: string };
    const moved = await editSlot({ id, date: "2026-10-26", scope: "this", slot: form({ subjectId: bio, date: "2026-10-27", startMin: 660, endMin: 720 }) });
    expect(moved.ok).toBe(true);
    let slots = await repo.listSlots();
    expect(slots.find((s) => s.id === id)?.skipDates).toEqual(["2026-10-26"]);
    expect(slots.find((s) => s.id !== id)).toMatchObject({ startDate: "2026-10-27", startMin: 660, recurrence: "none" });

    const every = await editSlot({ id, date: "2026-11-09", scope: "all", slot: form({ subjectId: bio, date: "2026-11-09", startMin: 540, endMin: 600 }) });
    expect(every.ok).toBe(true);
    slots = await repo.listSlots();
    expect(slots.find((s) => s.id === id)).toMatchObject({ startMin: 600, repeatUntil: "2026-11-08" });
    expect(slots.find((s) => s.startDate === "2026-11-09")).toMatchObject({ startMin: 540, recurrence: "weekly", repeatUntil: null });
  });

  it("delete with undo: one-off, this week, every week from here", async () => {
    const { id } = (await createSlot(form())) as { id: string };
    const thisWeek = await deleteSlot({ id, date: "2026-10-26", scope: "this" });
    expect(thisWeek).toMatchObject({ ok: true, undo: { type: "unskip", id, date: "2026-10-26" } });
    await undoSlotDelete((thisWeek as { undo: unknown }).undo);
    expect((await repo.getSlot(id))?.skipDates).toEqual([]);

    const later = await deleteSlot({ id, date: "2026-11-02", scope: "all" });
    expect((await repo.getSlot(id))?.repeatUntil).toBe("2026-11-01");
    await undoSlotDelete((later as { undo: unknown }).undo);
    expect((await repo.getSlot(id))?.repeatUntil).toBeNull();

    const all = await deleteSlot({ id, date: "2026-10-19", scope: "all" });
    expect(await repo.listSlots()).toEqual([]);
    await undoSlotDelete((all as { undo: unknown }).undo);
    expect(await repo.listSlots()).toHaveLength(1);
  });

  it("deleting a subject keeps its slots as No subject", async () => {
    await createSlot(form({ subjectId: bio }));
    await repo.deleteSubject(bio);
    expect((await repo.listSlots())[0].subjectId).toBeNull();
  });
});

describe("student B against student A", () => {
  it("B can't see, edit, delete, undo or use A's slots and subjects", async () => {
    const a = demoRepo(crypto.randomUUID());
    const aSubject = (await a.createSubject({ name: "Biology", colour: "mint", emoji: "🧬" })).id;
    repo = a;
    const { id } = (await createSlot(form({ subjectId: aSubject }))) as { id: string };
    await deleteSlot({ id, date: "2026-10-19", scope: "all" });
    await undoSlotDelete({ type: "restore", id });

    repo = demoRepo(crypto.randomUUID());
    expect(await repo.listSlots()).toEqual([]);
    expect(await editSlot({ id, date: "2026-10-19", scope: "all", slot: form() })).toEqual({ ok: false, error: expect.stringMatching(/deleted/) });
    expect(await deleteSlot({ id, date: "2026-10-19", scope: "all" })).toMatchObject({ ok: false });
    expect(await undoSlotDelete({ type: "restore", id })).toMatchObject({ ok: false });
    expect(await undoSlotDelete({ type: "until", id, until: null })).toMatchObject({ ok: false });
    expect(await createSlot(form({ subjectId: aSubject }))).toEqual({ ok: false, error: "That subject doesn't exist any more." });
    expect((await a.getSlot(id))?.startMin).toBe(600);
  });
});

describe("import", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T00:00:00Z"));
    repo = demoRepo(crypto.randomUUID());
    await repo.updateProfile({ timezone: "Europe/London" });
    await repo.createSubject({ name: "CHEM1002 Chemistry", colour: "sun", emoji: "🧪" });
  });

  it("refuses what isn't a calendar file, too big, or only past", async () => {
    expect(await previewImport(icsFile("hello", "notes.txt"))).toEqual({ ok: false, error: "That isn't a calendar file. Look for a file ending in .ics." });
    expect(await previewImport(icsFile("%PDF-1.7 \u0000"))).toEqual({ ok: false, error: "That isn't a calendar file. Look for a file ending in .ics." });
    expect(await previewImport(icsFile(`BEGIN:VCALENDAR\n${"X:y\n".repeat(300_000)}`))).toEqual({ ok: false, error: "That file is over 1 MB." });
    expect(await previewImport(icsFile("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"))).toEqual({ ok: false, error: "We couldn't find any classes in that file." });
    const past = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:p\r\nSUMMARY:Old\r\nDTSTART:20250101T090000Z\r\nDTEND:20250101T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    expect(await previewImport(icsFile(past))).toEqual({ ok: false, error: "This file only has past classes." });
  });

  it("previews, adds with subjects, undoes, and re-imports without touching hand-made slots", async () => {
    const res = await previewImport(icsFile(fixture));
    if (!res.ok) throw new Error(res.error);
    const p = res.preview;
    expect(p.groups.map((g) => [g.name, g.classes])).toEqual([["BIOL1001 Lecture", 2], ["BIOL1001 Lecture (moved)", 1], ["CHEM1002 Practical", 1]]);
    const chem = (await repo.listSubjects())[0].id;
    expect(p.groups.find((g) => g.name === "CHEM1002 Practical")?.subjectId).toBe(chem); // by the course code in the subject's name
    expect(p.leftOut).toBe("Left out: 1 all-day event, 1 past class, 1 event with a repeat we couldn't read.");

    await createSlot(form({ kind: "study", title: "My own study" }));
    const classes = p.classes.map((c) => ({ ...c, subjectId: c.group.startsWith("CHEM") ? chem : null }));
    const fileKeys = p.classes.map((c) => c.key);
    const added = await addImport({ classes, replace: true, fileKeys });
    expect(added).toMatchObject({ ok: true, added: 4, firstDate: "2026-10-19" });
    expect(await repo.listSlots()).toHaveLength(5);

    await undoImport({ batch: (added as { batch: string }).batch });
    expect((await repo.listSlots()).map((s) => s.title)).toEqual(["My own study"]);

    await addImport({ classes, replace: true, fileKeys });
    // The uni drops the Wednesday lecture and moves the practical's room.
    const again = await previewImport(icsFile(fixture.replace("BYDAY=MO,WE", "BYDAY=MO").replace("LOCATION:Lab B", "LOCATION:Lab C")));
    if (!again.ok) throw new Error(again.error);
    expect(again.preview.removable).toBe(2); // Wednesday series + old practical (its room is part of the key)
    expect(again.preview.classes.filter((c) => c.existing)).toHaveLength(2);
    const second = await addImport({ classes: again.preview.classes.map((c) => ({ ...c, subjectId: null })), replace: true, fileKeys: again.preview.classes.map((c) => c.key) });
    expect(second.ok).toBe(true);
    const after = await repo.listSlots();
    expect(after.map((s) => `${s.title} | ${s.location}`).sort()).toEqual([
      "BIOL1001 Lecture (moved) | Lecture Theatre A", "BIOL1001 Lecture | Room 2.14, Main Building", "CHEM1002 Practical | Lab C", "My own study | null",
    ]);
    // Undo of the re-import brings back exactly what was there.
    await undoImport({ batch: (second as { batch: string }).batch });
    expect((await repo.listSlots()).map((s) => `${s.title} | ${s.location} | ${s.subjectId === chem}`).sort()).toEqual([
      "BIOL1001 Lecture (moved) | Lecture Theatre A | false", "BIOL1001 Lecture | Room 2.14, Main Building | false", "BIOL1001 Lecture | Room 2.14, Main Building | false",
      "CHEM1002 Practical | Lab B | true", "My own study | null | false",
    ]);
  });

  it("a re-import during a long break never fills the break with classes", async () => {
    // Autumn term, four weeks off at Christmas, spring term: two weekly runs of the same class.
    const year = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:lec", "SUMMARY:BIOL1001 Lecture",
      "DTSTART;TZID=Europe/London:20261019T100000", "DTEND;TZID=Europe/London:20261019T110000",
      "RRULE:FREQ=WEEKLY;UNTIL=20270301T235959Z",
      "EXDATE;TZID=Europe/London:20261214T100000,20261221T100000,20261228T100000,20270104T100000",
      "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");
    const run = async () => {
      const res = await previewImport(icsFile(year));
      if (!res.ok) throw new Error(res.error);
      const r = await addImport({ classes: res.preview.classes.map((c) => ({ ...c, subjectId: null })), replace: true, fileKeys: res.preview.classes.map((c) => c.key) });
      expect(r.ok).toBe(true);
    };
    const meets = (day: string) => calendarDates().includes(day);
    const calendarDates = () => {
      const out: string[] = [];
      for (const s of slotsNow) {
        for (let d = Date.parse(s.startDate); d <= Date.parse(s.repeatUntil ?? s.startDate); d += 7 * 86_400_000) {
          const iso = new Date(d).toISOString().slice(0, 10);
          if (!s.skipDates.includes(iso)) out.push(iso);
          if (s.recurrence === "none") break;
        }
      }
      return out;
    };
    let slotsNow = [] as Awaited<ReturnType<Repo["listSlots"]>>;
    await run();
    slotsNow = await repo.listSlots();
    expect(slotsNow).toHaveLength(2);
    expect(meets("2026-12-21")).toBe(false);

    // Re-imported in the holidays: the autumn run is over, only the spring run is in the file's future.
    vi.setSystemTime(new Date("2026-12-16T12:00:00Z"));
    await run();
    slotsNow = await repo.listSlots();
    for (const d of ["2026-12-14", "2026-12-21", "2026-12-28", "2027-01-04"]) expect(meets(d), d).toBe(false);
    for (const d of ["2026-10-19", "2026-12-07", "2027-01-11", "2027-03-01"]) expect(meets(d), d).toBe(true);
  });

  it("a re-import keeps the weeks the student moved or deleted", async () => {
    const res = await previewImport(icsFile(fixture));
    if (!res.ok) throw new Error(res.error);
    const classes = res.preview.classes.map((c) => ({ ...c, subjectId: null }));
    const fileKeys = classes.map((c) => c.key);
    await addImport({ classes, replace: true, fileKeys });
    const lecture = (await repo.listSlots()).find((s) => s.recurrence === "weekly" && s.title === "BIOL1001 Lecture")!;
    // Two later weeks of the series: move one to 11:00 ("Just this week"), delete the other.
    const day0 = Date.parse(`${lecture.startDate}T00:00:00Z`);
    const dates = Array.from({ length: 6 }, (_, n) => new Date(day0 + n * 7 * 86_400_000).toISOString().slice(0, 10))
      .filter((d) => !lecture.skipDates.includes(d) && (!lecture.repeatUntil || d <= lecture.repeatUntil));
    const later = dates.slice(2, 4);
    expect(later).toHaveLength(2);
    const moved = await editSlot({ id: lecture.id, date: later[0], scope: "this", slot: form({ title: "BIOL1001 Lecture", date: later[0], startMin: 660, endMin: 720, repeats: "none" }) });
    expect(moved).toMatchObject({ ok: true });
    expect((await deleteSlot({ id: lecture.id, date: later[1], scope: "this" })).ok).toBe(true);

    const again = await previewImport(icsFile(fixture));
    if (!again.ok) throw new Error(again.error);
    expect((await addImport({ classes: again.preview.classes.map((c) => ({ ...c, subjectId: null })), replace: true, fileKeys })).ok).toBe(true);
    expect((await repo.getSlot(lecture.id))!.skipDates).toEqual(expect.arrayContaining(later));
  });

  it("without Replace, classes imported before are left alone", async () => {
    const res = await previewImport(icsFile(fixture));
    if (!res.ok) throw new Error(res.error);
    const classes = res.preview.classes.map((c) => ({ ...c, subjectId: null }));
    await addImport({ classes, replace: false, fileKeys: [] });
    expect(await addImport({ classes, replace: false, fileKeys: [] })).toEqual({ ok: false, error: "Those classes are already in your timetable." });
  });

  it("Undo works only for the latest import and only for a few minutes (S4-3)", async () => {
    const res = await previewImport(icsFile(fixture));
    if (!res.ok) throw new Error(res.error);
    const classes = res.preview.classes.map((c) => ({ ...c, subjectId: null }));
    const first = (await addImport({ classes: classes.slice(0, 2), replace: false, fileKeys: [] })) as { ok: true; batch: string };
    const second = (await addImport({ classes: classes.slice(2), replace: false, fileKeys: [] })) as { ok: true; batch: string };
    expect(first.ok && second.ok).toBe(true);
    const before = (await repo.listSlots()).map((s) => s.id).sort();
    // A new import ends the earlier one's Undo: a late or replayed call changes nothing.
    expect(await undoImport({ batch: first.batch })).toEqual({ ok: false, error: "That import can't be undone any more." });
    expect((await repo.listSlots()).map((s) => s.id).sort()).toEqual(before);
    // A batch id that was never ours, or isn't an import, changes nothing either.
    expect(await undoImport({ batch: crypto.randomUUID() })).toMatchObject({ ok: false });
    // Five minutes later the latest one can't be undone on the server either.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    try {
      expect(await undoImport({ batch: second.batch })).toMatchObject({ ok: false });
    } finally {
      vi.useRealTimers();
    }
    expect((await repo.listSlots()).map((s) => s.id).sort()).toEqual(before);
    // Within the window it works, once.
    const third = (await addImport({ classes, replace: true, fileKeys: classes.map((c) => c.key) })) as { ok: true; batch: string };
    expect(third.ok).toBe(true);
    expect((await undoImport({ batch: third.batch })).ok).toBe(true);
    expect(await undoImport({ batch: third.batch })).toMatchObject({ ok: false });
  });

  it("refuses forged classes", async () => {
    const bad = { key: "k", subjectId: null, title: "X", location: null, startDate: "2026-10-19", startMin: 600, endMin: 2000, recurrence: "none", repeatUntil: null, skipDates: [] };
    expect(await addImport({ classes: [bad], replace: false, fileKeys: [] })).toMatchObject({ ok: false });
    expect(await addImport({ classes: [{ ...bad, endMin: 660, key: "../../x" }], replace: false, fileKeys: [] })).toMatchObject({ ok: false });
    expect(await addImport({ classes: [{ ...bad, endMin: 660 }, { ...bad, endMin: 660 }], replace: false, fileKeys: [] })).toMatchObject({ ok: false });
  });
});

describe("calendar link and feed", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    repo = demoRepo(crypto.randomUUID());
    await repo.updateProfile({ timezone: "Europe/London" });
  });

  it("is made only on request, shown again, reset and turned off", async () => {
    expect(await getCalendarLink()).toEqual({ ok: true, link: null });
    const made = await makeCalendarLink();
    if (!made.ok || !made.link) throw new Error("no link");
    expect(made.link.url).toMatch(/^https:\/\/studynest\.test\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    expect((await makeCalendarLink()).ok && (await getCalendarLink())).toEqual({ ok: true, link: made.link });

    const subject = await repo.createSubject({ name: "Biology", colour: "mint", emoji: "🧬" });
    await createSlot(form({ subjectId: subject.id, location: "Room 2.14" }));
    const token = made.link.url.split("/").pop()!.replace(".ics", "");
    const ics = await calendarFile(token);
    expect(ics).toContain("SUMMARY:🧬 Biology class");
    expect((await getCalendarLink()).ok && ((await getCalendarLink()) as { link: { lastFetchedAt: string } }).link.lastFetchedAt).toBeTruthy();

    const reset = await resetCalendarLink();
    if (!reset.ok || !reset.link) throw new Error("no link");
    expect(reset.link.url).not.toBe(made.link.url);
    expect(await calendarFile(token)).toBeNull();
    expect(await calendarFile(reset.link.url.split("/").pop()!.replace(".ics", ""))).toContain("BEGIN:VCALENDAR");

    await turnOffCalendarLink();
    expect(await calendarFile(reset.link.url.split("/").pop()!.replace(".ics", ""))).toBeNull();
    expect(await getCalendarLink()).toEqual({ ok: true, link: null });
  });

  it("the token never appears in the export; malformed tokens are refused without a lookup", async () => {
    const made = await makeCalendarLink();
    const token = made.ok && made.link ? made.link.url.split("/").pop()!.replace(".ics", "") : "";
    expect(JSON.stringify(await repo.exportAll())).not.toContain(token);
    expect(await calendarFile("short")).toBeNull();
    expect(await calendarFile(`${token}x`)).toBeNull();
    expect(await calendarFile(token.toLowerCase() === token ? token.toUpperCase() : token.toLowerCase())).toBeNull();
  });
});
