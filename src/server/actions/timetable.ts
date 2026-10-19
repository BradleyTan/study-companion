"use server";
import { z } from "zod";
import { dayOf, isoOf, todayIn } from "@/lib/timetable/dates";
import { codeOwners, leftOutLine, matchSubject, planImport } from "@/lib/timetable/import";
import { parseIcs } from "@/lib/timetable/ics";
import { IMPORT_MAX_BYTES, IMPORT_MAX_CLASSES } from "@/lib/timetable/limits";
import { cleanSkips, MAX_SKIPS, MAX_SLOTS, nextOccurrence, planDelete, planEdit, SLOT_ERRORS, type SlotCore } from "@/lib/timetable/slots";
import { newCalendarToken } from "@/lib/timetable/token";
import { addImportInput, deleteSlotInput, editSlotInput, slotInput, undoImportInput, undoSlotInput, type SlotInput, type SlotUndo } from "@/lib/validation";
import type { NewTimetableSlot, Repo, TimetableSlot } from "../repo/types";
import { getRepo } from "../session";
import { calendarLinkView, purgeOldDeletes, type CalendarLinkView } from "../timetable";
import { firstIssue, type ActionResult } from "./result";

// Timetable and calendar link (docs/design/screens/timetable.md). Public endpoints like every
// server action: every argument is validated with zod, every slot and subject is looked up through
// the student's own repo (another student's id is simply "not found"), and writes are pinned to
// the student by the repo. Each write returns the student's slots so the screen redraws from them.

type Slots = { slots: TimetableSlot[] };

const isCap = (e: unknown) => e instanceof Error && e.message.includes("timetable slot limit reached");
const GONE = "That slot was deleted. Refresh to see your timetable.";

/** The form's values as a slot, in the student's time zone. */
function toCore(s: SlotInput, tz: string, subjectId: string | null): SlotCore {
  const core: SlotCore = {
    subjectId, kind: s.kind, title: s.title, location: s.location, tz, startDate: s.date, startMin: s.startMin, endMin: s.endMin,
    recurrence: s.repeats, repeatUntil: s.repeats === "weekly" ? s.until : null, skipDates: [],
  };
  return core;
}

/** The subject if it's the student's, else null ("No subject"); `false` when a given id isn't theirs. */
async function ownSubject(repo: Repo, id: string | null): Promise<string | null | false> {
  if (!id) return null;
  return (await repo.getSubject(id)) ? id : false;
}

const manual = (c: SlotCore): NewTimetableSlot => ({ ...c, source: "manual", importUid: null, importBatch: null });

export async function createSlot(raw: unknown): Promise<ActionResult<Slots & { id: string }>> {
  const parsed = slotInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  const subjectId = await ownSubject(repo, parsed.data.subjectId);
  if (subjectId === false) return { ok: false, error: "That subject doesn't exist any more." };
  const { timezone } = await repo.getProfile();
  await purgeOldDeletes(repo);
  try {
    const [made] = await repo.createSlots([manual(toCore(parsed.data, timezone, subjectId))]);
    return { ok: true, id: made.id, slots: await repo.listSlots() };
  } catch (e) {
    if (isCap(e)) return { ok: false, error: SLOT_ERRORS.cap };
    throw e;
  }
}

/** Edit (or drag) one occurrence: a one-off, "Just this week" or "Every week" from this week. */
export async function editSlot(raw: unknown): Promise<ActionResult<Slots>> {
  const parsed = editSlotInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, date, scope, slot } = parsed.data;
  const repo = await getRepo();
  const current = await repo.getSlot(id);
  if (!current) return { ok: false, error: GONE };
  const subjectId = await ownSubject(repo, slot.subjectId);
  if (subjectId === false) return { ok: false, error: "That subject doesn't exist any more." };
  const { timezone } = await repo.getProfile();
  const plan = planEdit(current, date, scope, toCore(slot, timezone, subjectId));
  if ("error" in plan) return { ok: false, error: plan.error };
  await purgeOldDeletes(repo);
  try {
    // The new part first: if it can't be saved (cap), nothing has changed.
    if (plan.create) await repo.createSlots([manual(plan.create)]);
    if (plan.update) await repo.updateSlot(id, plan.update);
  } catch (e) {
    if (isCap(e)) return { ok: false, error: SLOT_ERRORS.cap };
    throw e;
  }
  return { ok: true, slots: await repo.listSlots() };
}

/** Delete one occurrence ("Just this week"), the series from this week on, or a one-off. */
export async function deleteSlot(raw: unknown): Promise<ActionResult<Slots & { undo: SlotUndo }>> {
  const parsed = deleteSlotInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, date, scope } = parsed.data;
  const repo = await getRepo();
  const current = await repo.getSlot(id);
  if (!current) return { ok: false, error: GONE };
  const plan = planDelete(current, date, scope);
  if ("error" in plan) return { ok: false, error: plan.error };
  await purgeOldDeletes(repo);
  let undo: SlotUndo;
  if (plan.remove) {
    await repo.setSlotDeleted(id, true);
    undo = { type: "restore", id };
  } else if (scope === "this") {
    await repo.updateSlot(id, plan.update!);
    undo = { type: "unskip", id, date };
  } else {
    await repo.updateSlot(id, plan.update!);
    undo = { type: "until", id, until: current.repeatUntil };
  }
  return { ok: true, undo, slots: await repo.listSlots() };
}

export async function undoSlotDelete(raw: unknown): Promise<ActionResult<Slots>> {
  const parsed = undoSlotInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const u = parsed.data;
  const repo = await getRepo();
  try {
    if (u.type === "restore") {
      if (!(await repo.getSlot(u.id, { deleted: true }))) return { ok: false, error: GONE };
      await repo.setSlotDeleted(u.id, false);
    } else {
      const s = await repo.getSlot(u.id);
      if (!s) return { ok: false, error: GONE };
      if (s.recurrence !== "weekly") return { ok: false, error: "That can't be undone any more." };
      if (u.type === "unskip") await repo.updateSlot(u.id, { skipDates: s.skipDates.filter((d) => d !== u.date) });
      else {
        if (u.until && dayOf(u.until) < dayOf(s.startDate)) return { ok: false, error: SLOT_ERRORS.untilBefore };
        await repo.updateSlot(u.id, { repeatUntil: u.until });
      }
    }
  } catch (e) {
    if (isCap(e)) return { ok: false, error: SLOT_ERRORS.cap };
    throw e;
  }
  return { ok: true, slots: await repo.listSlots() };
}

// ---- import ---------------------------------------------------------------------------

export type ImportPreview = {
  classes: {
    key: string; group: string; title: string | null; location: string | null; startDate: string; startMin: number; endMin: number;
    recurrence: "weekly" | "none"; repeatUntil: string | null; skipDates: string[]; dates: number;
    /** Already imported before (a re-import updates it). */
    existing: boolean;
  }[];
  groups: { name: string; when: string; location: string | null; classes: number; subjectId: string | null }[];
  /** Imported classes from before that aren't in this file (removed with "Replace my previous import"). */
  removable: number;
  leftOut: string | null;
  fileZone: string | null;
  timezone: string;
  firstDate: string | null;
  lastDate: string | null;
};

const IMPORT_ERRORS = {
  notCalendar: "That isn't a calendar file. Look for a file ending in .ics.",
  tooBig: "That file is over 1 MB.",
  empty: "We couldn't find any classes in that file.",
  past: "This file only has past classes.",
  broken: "Something went wrong reading that file. Try exporting it again.",
} as const;

/** A slot that still has a date today or later. */
const upcoming = (s: TimetableSlot, now: number) => nextOccurrence(s, now) !== null;

/**
 * Step 2 and 3 of the import: reads the uploaded .ics file on the server (never a URL) and returns
 * the preview. Nothing is saved.
 */
export async function previewImport(form: FormData): Promise<ActionResult<{ preview: ImportPreview }>> {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: IMPORT_ERRORS.notCalendar };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, error: IMPORT_ERRORS.tooBig };
  const typeOk = /\.ics$/i.test(file.name) || file.type === "text/calendar";
  if (!typeOk) return { ok: false, error: IMPORT_ERRORS.notCalendar };
  const repo = await getRepo();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > IMPORT_MAX_BYTES) return { ok: false, error: IMPORT_ERRORS.tooBig };
    if (bytes.includes(0)) return { ok: false, error: IMPORT_ERRORS.notCalendar };
    const text = new TextDecoder("utf-8").decode(bytes);
    const ics = parseIcs(text);
    if (!ics) return { ok: false, error: IMPORT_ERRORS.notCalendar };
    const [profile, subjects, slots] = await Promise.all([repo.getProfile(), repo.listSubjects(), repo.listSlots()]);
    const now = Date.now();
    const plan = planImport(ics, profile.timezone, now);
    if (!plan.classes.length) {
      const onlyPast = plan.left.past > 0 && plan.left.allDay + plan.left.tooLong + plan.left.unreadable + plan.left.repeat + plan.left.beyond === 0;
      return { ok: false, error: onlyPast ? IMPORT_ERRORS.past : IMPORT_ERRORS.empty };
    }
    const imported = new Map(slots.filter((s) => s.source === "import" && s.importUid).map((s) => [s.importUid!, s]));
    const keys = new Set(plan.classes.map((c) => c.key));
    const owners = codeOwners(subjects, slots);
    const preview: ImportPreview = {
      classes: plan.classes.map((c) => ({ ...c, existing: imported.has(c.key) })),
      groups: plan.groups.map((g) => {
        // A group imported before keeps the subject the student gave it.
        const before = plan.classes.find((c) => c.group === g.name && imported.get(c.key)?.subjectId);
        return { ...g, subjectId: before ? imported.get(before.key)!.subjectId : matchSubject(g.name, subjects, owners) };
      }),
      removable: [...imported.values()].filter((s) => !keys.has(s.importUid!) && upcoming(s, now)).length,
      leftOut: leftOutLine(plan.left),
      fileZone: plan.fileZone,
      timezone: profile.timezone,
      firstDate: plan.firstDate,
      lastDate: plan.lastDate,
    };
    return { ok: true, preview };
  } catch (e) {
    console.error("previewImport", e instanceof Error ? e.message : e);
    return { ok: false, error: IMPORT_ERRORS.broken };
  }
}

const addImportRequest = addImportInput.and(z.object({ fileKeys: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(IMPORT_MAX_CLASSES) }));

/**
 * Step 4: adds the ticked classes as one import batch (6-second Undo deletes it). With "Replace my
 * previous import" it updates classes imported before and removes earlier imported classes that
 * are no longer in the file (only ones with dates still to come); slots made by hand are never
 * touched. Without it, classes already imported are left as they are.
 */
export async function addImport(raw: unknown): Promise<ActionResult<Slots & { batch: string; added: number; firstDate: string }>> {
  const parsed = addImportRequest.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { classes, replace, fileKeys } = parsed.data;
  const repo = await getRepo();
  const [profile, subjects, live] = await Promise.all([repo.getProfile(), repo.listSubjects(), repo.listSlots()]);
  const mySubjects = new Set(subjects.map((s) => s.id));
  const imported = new Map(live.filter((s) => s.source === "import" && s.importUid).map((s) => [s.importUid!, s]));
  const now = Date.now();
  const batch = crypto.randomUUID();

  const insert: NewTimetableSlot[] = [];
  const update: { id: string; next: SlotCore & { importUid: string } }[] = [];
  for (const c of classes) {
    const core: SlotCore = {
      subjectId: c.subjectId && mySubjects.has(c.subjectId) ? c.subjectId : null,
      kind: "class", title: c.title, location: c.location, tz: profile.timezone, startDate: c.startDate, startMin: c.startMin, endMin: c.endMin,
      recurrence: c.recurrence, repeatUntil: c.repeatUntil, skipDates: [],
    };
    core.skipDates = cleanSkips({ ...core, skipDates: c.skipDates });
    const was = imported.get(c.key);
    if (!was) { insert.push({ ...core, source: "import", importUid: c.key, importBatch: batch }); continue; }
    if (!replace) continue;
    // Weeks already past stay part of the class: keep the earlier start of the same weekly class.
    const from = dayOf(was.startDate), to = dayOf(core.startDate);
    if (was.recurrence === "weekly" && core.recurrence === "weekly" && from < to && (to - from) % 7 === 0 && was.tz === core.tz) {
      // Weeks between them that weren't dates of the earlier class (a break after its last date)
      // stay skipped, so the merged class never fills a holiday.
      const wasUntil = was.repeatUntil ? dayOf(was.repeatUntil) : Infinity;
      const between: string[] = [];
      for (let d = from; d < to; d += 7) if (d > wasUntil) between.push(isoOf(d));
      const merged = cleanSkips({ ...core, startDate: was.startDate, skipDates: [...was.skipDates.filter((d) => dayOf(d) < to), ...between, ...core.skipDates] });
      if (merged.length <= MAX_SKIPS) { core.startDate = was.startDate; core.skipDates = merged; }
    }
    update.push({ id: was.id, next: { ...core, importUid: c.key } });
  }
  const inFile = new Set([...fileKeys, ...classes.map((c) => c.key)]);
  const remove = replace ? [...imported.values()].filter((s) => !inFile.has(s.importUid!) && upcoming(s, now)).map((s) => s.id) : [];
  if (!insert.length && !update.length && !remove.length) return { ok: false, error: "Those classes are already in your timetable." };
  if (live.length + insert.length - remove.length > MAX_SLOTS) {
    return { ok: false, error: "That would go over 300 slots. Untick a few groups, or delete some old slots first." };
  }
  await purgeOldDeletes(repo);
  try {
    await repo.applyImport(batch, { insert, update, remove });
  } catch (e) {
    if (isCap(e)) return { ok: false, error: "That would go over 300 slots. Untick a few groups, or delete some old slots first." };
    throw e;
  }
  const today = isoOf(todayIn(profile.timezone, now));
  const dates = classes.map((c) => c.startDate).sort();
  return { ok: true, batch, added: insert.length + update.length, firstDate: dates.find((d) => d >= today) ?? dates[0], slots: await repo.listSlots() };
}

export async function undoImport(raw: unknown): Promise<ActionResult<Slots>> {
  const parsed = undoImportInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  await repo.undoImport(parsed.data.batch);
  return { ok: true, slots: await repo.listSlots() };
}

// ---- calendar link -----------------------------------------------------------------------

type LinkResult = ActionResult<{ link: CalendarLinkView }>;

/** The link as it is now (the panel shows it again each time it's opened). */
export async function getCalendarLink(): Promise<LinkResult> {
  const repo = await getRepo();
  return { ok: true, link: await calendarLinkView(await repo.getCalendarLink()) };
}

/** "Make my calendar link": created only on request; pressing it twice keeps the first link. */
export async function makeCalendarLink(): Promise<LinkResult> {
  const repo = await getRepo();
  const link = (await repo.getCalendarLink()) ?? (await repo.setCalendarLink(newCalendarToken()));
  return { ok: true, link: await calendarLinkView(link) };
}

/** "Reset link": a new token; the old link stops working at once. */
export async function resetCalendarLink(): Promise<LinkResult> {
  const repo = await getRepo();
  return { ok: true, link: await calendarLinkView(await repo.setCalendarLink(newCalendarToken())) };
}

/** "Turn off link": calendars using it stop updating. */
export async function turnOffCalendarLink(): Promise<LinkResult> {
  const repo = await getRepo();
  await repo.deleteCalendarLink();
  return { ok: true, link: null };
}
