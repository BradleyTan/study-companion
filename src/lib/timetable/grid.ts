import { hhmm, isoOf, localOf, longDate, shortDate, weekdayName } from "./dates";
import { KIND_LABEL, MAX_SLOT_MIN, nextOccurrence, SNAP_MIN, slotTitle, snapDown, type SlotLike } from "./slots";

// Pure helpers for the week grid (timetable.md "Drag to create", "Accessibility"). No DOM here, so
// the drag maths and the spoken names are unit-tested.

/** Minutes after midnight for a y offset inside a day column, snapped down to 15 minutes. */
export function minuteAt(y: number, hourPx: number): number {
  const raw = (y / hourPx) * 60;
  return Math.min(1440 - SNAP_MIN, Math.max(0, snapDown(raw)));
}

/**
 * The slot a drag from `anchor` to `current` makes: whole 15-minute steps covering both points,
 * at least 15 minutes, at most 12 hours, never past midnight.
 */
export function dragRange(anchor: number, current: number): { startMin: number; endMin: number } {
  let startMin = Math.min(anchor, current);
  let endMin = Math.max(anchor, current) + SNAP_MIN;
  if (endMin - startMin > MAX_SLOT_MIN) {
    if (current < anchor) startMin = endMin - MAX_SLOT_MIN;
    else endMin = startMin + MAX_SLOT_MIN;
  }
  startMin = Math.max(0, startMin);
  endMin = Math.min(1440, endMin);
  return { startMin, endMin };
}

/** A plain click: a 1-hour slot from the clicked quarter hour (shorter near midnight). */
export function clickRange(min: number): { startMin: number; endMin: number } {
  const startMin = Math.min(min, 1440 - SNAP_MIN);
  return { startMin, endMin: Math.min(1440, startMin + 60) };
}

/** Tap on touch: the hour (or the half hour) tapped, 1 hour long. */
export function tapRange(y: number, hourPx: number): { startMin: number; endMin: number } {
  const raw = (y / hourPx) * 60;
  const startMin = Math.min(1380, Math.max(0, Math.floor(raw / 30) * 30));
  return { startMin, endMin: startMin + 60 };
}

/** Moving a slot by whole steps: keeps its length, stays inside the day. */
export function moveRange(startMin: number, endMin: number, deltaMin: number): { startMin: number; endMin: number } {
  const len = endMin - startMin;
  const step = Math.round(deltaMin / SNAP_MIN) * SNAP_MIN;
  const s = Math.min(1440 - len, Math.max(0, startMin + step));
  return { startMin: s, endMin: s + len };
}

/** Resizing a slot's end: 15 minutes at least, 12 hours at most, midnight at the latest. */
export function resizeEnd(startMin: number, endMin: number, deltaMin: number): number {
  const step = Math.round(deltaMin / SNAP_MIN) * SNAP_MIN;
  return Math.min(1440, startMin + MAX_SLOT_MIN, Math.max(startMin + SNAP_MIN, endMin + step));
}

/** Where the grid scrolls to on load: 30 minutes before the week's earliest slot, else 8:00. */
export function scrollMinute(startMins: number[]): number {
  if (!startMins.length) return 8 * 60;
  return Math.max(0, Math.min(...startMins) - 30);
}

/** "10:00 to 11:00" (spoken form of 10:00–11:00). */
export const spokenRange = (startMin: number, endMin: number) => `${hhmm(startMin)} to ${hhmm(endMin)}`;

/**
 * The slot's accessible name: "Class, Biology, BIOL1001 Lecture, 10:00 to 11:00, Room 2.14, every
 * week". The kind is always in words.
 */
export function slotName(o: {
  kind: SlotLike["kind"]; title: string | null; subjectName: string | null; startMin: number; endMin: number; location: string | null; weekly: boolean;
}): string {
  return [
    KIND_LABEL[o.kind],
    o.subjectName ?? "no subject",
    slotTitle(o, o.subjectName),
    spokenRange(o.startMin, o.endMin),
    o.location,
    o.weekly ? "every week" : "just once",
  ].filter(Boolean).join(", ");
}

/** "Monday 14 October", or "Today, Monday 14 October". */
export function dayLabel(day: number, today: number): string {
  return `${day === today ? "Today, " : ""}${longDate(day)}`;
}

/** "Biology class moved to Tuesday, 11:00 to 12:00." */
export function movedLine(title: string, day: number, startMin: number, endMin: number): string {
  return `${title} moved to ${weekdayName(day)}, ${spokenRange(startMin, endMin)}.`;
}

/**
 * For "Nothing this week": the first slot happening after the shown week (else the last one before
 * it), so the student can jump there.
 */
export function nearestOutside<S extends SlotLike>(slots: S[], weekFromMs: number, weekToMs: number, tz: string): { day: number; week: string; kind: S["kind"] } | null {
  let best: { start: number; kind: S["kind"] } | null = null;
  for (const s of slots) {
    const occ = nextOccurrence(s, weekToMs);
    if (occ && (!best || occ.start < best.start)) best = { start: occ.start, kind: s.kind };
  }
  if (!best) {
    // Only earlier weeks: the latest occurrence before this week (one-offs and finished series).
    for (const s of slots) {
      const occ = nextOccurrence(s, weekFromMs - 400 * 86_400_000);
      if (occ && occ.start < weekFromMs && (!best || occ.start > best.start)) best = { start: occ.start, kind: s.kind };
    }
  }
  if (!best) return null;
  const day = localOf(tz, best.start).day;
  return { day, week: isoOf(day), kind: best.kind };
}

/** "Mon 3 Nov" for the "Next class" link. */
export const nextLabel = (day: number) => shortDate(day);

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago" (calendar link status line). */
export function agoLabel(thenMs: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - thenMs) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** The feed link as webcal:// (opens the subscribe screen in Apple Calendar). */
export const webcalUrl = (url: string) => url.replace(/^https?:\/\//i, "webcal://");
