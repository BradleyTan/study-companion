// Timetable slots: rules, weekly repeats, "Just this week" / "Every week" edits and the week view
// (docs/design/screens/timetable.md). Pure functions shared by the server and the timetable screen.
import { dayMonth, dayOf, hhmm, instantOf, isoOf, localOf, weekdayName } from "./dates";

export const SLOT_KINDS = ["class", "study", "other"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];
export type Recurrence = "none" | "weekly";

/** Most slots a student can have (database cap too). */
export const MAX_SLOTS = 300;
/** Longest slot: 12 hours. */
export const MAX_SLOT_MIN = 720;
/** Most skipped weeks on one weekly slot. */
export const MAX_SKIPS = 60;
/** Drag and the form's time fields move in 15-minute steps. */
export const SNAP_MIN = 15;
export const TITLE_MAX = 80;
export const LOCATION_MAX = 80;

export const SLOT_ERRORS = {
  endAfterStart: "End has to be after the start.",
  tooLong: "A slot can be up to 12 hours.",
  cap: "You've reached 300 slots. Delete a few old ones first.",
  untilBefore: "\"Until\" has to be on or after the day.",
  tooManySkips: "This slot already skips 60 weeks. Change it for every week instead.",
  notAnOccurrence: "That week isn't part of this slot any more.",
} as const;

/** What a slot is, without its id and bookkeeping (what the form edits). */
export type SlotCore = {
  subjectId: string | null;
  kind: SlotKind;
  /** null: the default title, which follows the subject's name. */
  title: string | null;
  location: string | null;
  /** Time zone the times are in (the student's, when it was saved). */
  tz: string;
  /** First date ("2026-10-19", local in `tz`). */
  startDate: string;
  /** Minutes after local midnight; end may be 1440 (midnight). */
  startMin: number;
  endMin: number;
  recurrence: Recurrence;
  /** Last date it may happen (inclusive); weekly only. */
  repeatUntil: string | null;
  /** Weeks skipped ("Just this week"), as the dates they would have happened on. */
  skipDates: string[];
};
export type SlotLike = SlotCore & { id: string };

// ---- titles --------------------------------------------------------------------------

/** timetable.md "Default title": "Biology class", "Study: Biology", "Busy"; no subject: "Class" / "Study" / "Busy". */
export function defaultTitle(kind: SlotKind, subjectName: string | null): string {
  if (kind === "class") return subjectName ? `${subjectName} class` : "Class";
  if (kind === "study") return subjectName ? `Study: ${subjectName}` : "Study";
  return "Busy";
}
export function slotTitle(slot: Pick<SlotCore, "kind" | "title">, subjectName: string | null): string {
  return slot.title ?? defaultTitle(slot.kind, subjectName);
}
export const KIND_LABEL: Record<SlotKind, string> = { class: "Class", study: "Study", other: "Other" };

// ---- rules -----------------------------------------------------------------------------

/** Nearest 15-minute step. */
export function snap(min: number, step = SNAP_MIN): number {
  return Math.round(min / step) * step;
}
/** The 15-minute step a minute falls in. */
export function snapDown(min: number, step = SNAP_MIN): number {
  return Math.floor(min / step) * step;
}

/** The first rule a slot breaks, or null. */
export function slotError(s: Pick<SlotCore, "startMin" | "endMin" | "startDate" | "repeatUntil" | "recurrence">): string | null {
  if (s.endMin <= s.startMin) return SLOT_ERRORS.endAfterStart;
  if (s.endMin - s.startMin > MAX_SLOT_MIN) return SLOT_ERRORS.tooLong;
  if (s.recurrence === "weekly" && s.repeatUntil && dayOf(s.repeatUntil) < dayOf(s.startDate)) return SLOT_ERRORS.untilBefore;
  return null;
}

/** Skipped weeks that are real occurrences of the series, sorted, without duplicates. */
export function cleanSkips(s: Pick<SlotCore, "startDate" | "repeatUntil" | "recurrence" | "skipDates">): string[] {
  if (s.recurrence !== "weekly") return [];
  const first = dayOf(s.startDate);
  const last = s.repeatUntil ? dayOf(s.repeatUntil) : Infinity;
  const days = new Set<number>();
  for (const iso of s.skipDates) {
    const d = dayOf(iso);
    if (Number.isFinite(d) && d >= first && d <= last && (d - first) % 7 === 0) days.add(d);
  }
  return [...days].sort((a, b) => a - b).map(isoOf);
}

/** Is `date` one of the slot's (not skipped) days? */
export function isOccurrence(s: SlotCore, date: string): boolean {
  const d = dayOf(date), first = dayOf(s.startDate);
  if (!Number.isFinite(d)) return false;
  if (s.recurrence === "none") return d === first;
  if (d < first || (d - first) % 7 !== 0) return false;
  if (s.repeatUntil && d > dayOf(s.repeatUntil)) return false;
  return !s.skipDates.includes(date);
}

// ---- occurrences -------------------------------------------------------------------------

export type Occurrence = {
  slotId: string;
  /** Local date in the slot's time zone. */
  date: string;
  start: number;
  end: number;
};

/** Occurrences overlapping [fromMs, toMs), computed in the slot's own time zone. */
export function occurrences(s: SlotLike, fromMs: number, toMs: number): Occurrence[] {
  const first = dayOf(s.startDate);
  if (!Number.isFinite(first) || toMs <= fromMs) return [];
  const out: Occurrence[] = [];
  const add = (d: number) => {
    const start = instantOf(s.tz, d, s.startMin);
    const end = instantOf(s.tz, d, s.endMin);
    if (end > fromMs && start < toMs) out.push({ slotId: s.id, date: isoOf(d), start, end });
  };
  if (s.recurrence === "none") {
    add(first);
    return out;
  }
  const last = s.repeatUntil ? dayOf(s.repeatUntil) : Infinity;
  const fromDay = localOf(s.tz, fromMs).day - 1;
  const toDay = localOf(s.tz, toMs).day + 1;
  const skip = new Set(s.skipDates.map(dayOf));
  for (let d = first + Math.max(0, Math.ceil((fromDay - first) / 7)) * 7; d <= Math.min(last, toDay); d += 7) {
    if (!skip.has(d)) add(d);
  }
  return out;
}

/** The slot's next occurrence that hasn't ended yet (looking up to a year ahead). */
export function nextOccurrence(s: SlotLike, nowMs: number): Occurrence | null {
  return occurrences(s, nowMs, nowMs + 400 * 86_400_000)[0] ?? null;
}

/** "Every Monday until 13 Dec", "Every Monday", "Just once". */
export function repeatLabel(s: SlotCore): string {
  if (s.recurrence === "none") return "Just once";
  const day = weekdayName(dayOf(s.startDate));
  return s.repeatUntil ? `Every ${day} until ${dayMonth(dayOf(s.repeatUntil))}` : `Every ${day}`;
}

export const timeRange = (startMin: number, endMin: number) => `${hhmm(startMin)}–${hhmm(endMin)}`;

// ---- edits -----------------------------------------------------------------------------------

export type EditScope = "this" | "all";
export type EditPlan = {
  /** Changes to the existing slot. */
  update: Partial<SlotCore> | null;
  /** A new slot (a one-off for "Just this week", or the rest of the series for "Every week"). */
  create: SlotCore | null;
  /** Delete the existing slot. */
  remove: boolean;
};
type PlanResult = EditPlan | { error: string };

const shiftSkips = (skips: string[], delta: number) => skips.map((d) => isoOf(dayOf(d) + delta));

/**
 * Editing one occurrence (`date`) of a slot (timetable.md "Repeating slots"):
 * - a one-off slot is simply changed;
 * - "Just this week" skips that week and makes a one-off with the change;
 * - "Every week" changes the series from this week on: earlier weeks keep the old times (the
 *   series is split with `repeatUntil`), or the whole series changes when this is its first week.
 */
export function planEdit(slot: SlotCore, date: string, scope: EditScope, next: SlotCore): PlanResult {
  const bad = slotError(next);
  if (bad) return { error: bad };
  if (slot.recurrence === "none") {
    return { update: { ...next, skipDates: cleanSkips(next) }, create: null, remove: false };
  }
  if (!isOccurrence(slot, date)) return { error: SLOT_ERRORS.notAnOccurrence };
  if (scope === "this") {
    if (slot.skipDates.length >= MAX_SKIPS) return { error: SLOT_ERRORS.tooManySkips };
    return {
      update: { skipDates: cleanSkips({ ...slot, skipDates: [...slot.skipDates, date] }) },
      create: { ...next, recurrence: "none", repeatUntil: null, skipDates: [] },
      remove: false,
    };
  }
  const occ = dayOf(date);
  const delta = dayOf(next.startDate) - occ;
  const later = slot.skipDates.filter((d) => dayOf(d) > occ);
  const carried = next.recurrence === "weekly" ? cleanSkips({ ...next, skipDates: shiftSkips(later, delta) }) : [];
  if (occ <= dayOf(slot.startDate)) {
    return { update: { ...next, skipDates: carried }, create: null, remove: false };
  }
  return {
    update: { repeatUntil: isoOf(occ - 1), skipDates: slot.skipDates.filter((d) => dayOf(d) < occ) },
    create: { ...next, skipDates: carried },
    remove: false,
  };
}

/** Deleting one occurrence: "Just this week" skips it, "Every week" ends the series before it. */
export function planDelete(slot: SlotCore, date: string, scope: EditScope): PlanResult {
  if (slot.recurrence === "none") return { update: null, create: null, remove: true };
  if (!isOccurrence(slot, date)) return { error: SLOT_ERRORS.notAnOccurrence };
  const occ = dayOf(date);
  if (scope === "this") {
    if (slot.skipDates.length >= MAX_SKIPS) return { error: SLOT_ERRORS.tooManySkips };
    return { update: { skipDates: cleanSkips({ ...slot, skipDates: [...slot.skipDates, date] }) }, create: null, remove: false };
  }
  if (occ <= dayOf(slot.startDate)) return { update: null, create: null, remove: true };
  // Skipped weeks after the end are kept (unused), so Undo only has to put `repeatUntil` back.
  return { update: { repeatUntil: isoOf(occ - 1) }, create: null, remove: false };
}

// ---- week view ---------------------------------------------------------------------------

export type WeekItem<S extends SlotLike = SlotLike> = {
  slot: S;
  occ: Occurrence;
  /** Day number in the student's time zone. */
  day: number;
  /** Shown times in the student's time zone (end clipped to midnight). */
  startMin: number;
  endMin: number;
};

/** Occurrences starting in each of the 7 days from `firstDay`, shown in `tz`, in time order. */
export function weekItems<S extends SlotLike>(slots: S[], firstDay: number, tz: string): WeekItem<S>[][] {
  const days: WeekItem<S>[][] = Array.from({ length: 7 }, () => []);
  const from = instantOf(tz, firstDay, 0);
  const to = instantOf(tz, firstDay + 7, 0);
  for (const slot of slots) {
    for (const occ of occurrences(slot, from, to)) {
      const a = localOf(tz, occ.start);
      const b = localOf(tz, occ.end);
      const i = a.day - firstDay;
      if (i < 0 || i > 6) continue;
      const endMin = b.day === a.day ? b.min : 1440;
      days[i].push({ slot, occ, day: a.day, startMin: a.min, endMin: Math.max(endMin, a.min + 1) });
    }
  }
  for (const list of days) list.sort((x, y) => x.startMin - y.startMin || x.endMin - y.endMin || x.slot.id.localeCompare(y.slot.id));
  return days;
}

/** Side-by-side columns for overlapping items (timetable.md: overlaps are drawn side by side). */
export function overlapColumns(items: { startMin: number; endMin: number }[]): { col: number; cols: number }[] {
  const out = items.map(() => ({ col: 0, cols: 1 }));
  let cluster: number[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];
  const close = () => {
    const n = colEnds.length;
    for (const i of cluster) out[i].cols = n;
    cluster = [];
    colEnds = [];
  };
  items.forEach((it, i) => {
    if (it.startMin >= clusterEnd && cluster.length) close();
    let col = colEnds.findIndex((end) => end <= it.startMin);
    if (col === -1) { col = colEnds.length; colEnds.push(it.endMin); } else colEnds[col] = it.endMin;
    out[i].col = col;
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  });
  if (cluster.length) close();
  return out;
}
