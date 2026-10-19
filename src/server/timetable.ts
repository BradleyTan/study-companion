import "server-only";
import { hhmm, isoOf, localOf, longDate, shortDate, todayIn, weekdayName, weekdayShort, weekStartOf } from "@/lib/timetable/dates";
import { nextOccurrence, occurrences, slotTitle } from "@/lib/timetable/slots";
import type { CalendarLink, Repo, TimetableSlot } from "./repo/types";
import { siteOrigin } from "./origin";

/** What the calendar link panel shows (timetable.md "Calendar link panel"). */
export type CalendarLinkView = { url: string; createdAt: string; lastFetchedAt: string | null } | null;

/** The feed URL for a token: https://…/api/calendar/<token>.ics */
export async function calendarLinkView(link: CalendarLink | null): Promise<CalendarLinkView> {
  if (!link) return null;
  return { url: `${await siteOrigin()}/api/calendar/${link.token}.ics`, createdAt: link.createdAt, lastFetchedAt: link.lastFetchedAt };
}

/** The study strip's "Next" part (subject.md, Step 4). */
export type NextClass =
  | { kind: "studyNow"; untilMin: number }
  | { kind: "next"; title: string; start: number; location: string | null; weekOf: string; date: string; when: string; whenLong: string }
  | null;

/**
 * For a subject: a Study block happening now (it replaces "Next"), else the next class that hasn't
 * ended yet (one happening now counts), shown in the student's time zone.
 */
export function nextForSubject(slots: TimetableSlot[], subject: { id: string; name: string }, now: number, tz: string, weekStart: "mon" | "sun"): NextClass {
  const mine = slots.filter((s) => s.subjectId === subject.id);
  for (const s of mine.filter((x) => x.kind === "study")) {
    const occ = occurrences(s, now, now + 1).find((o) => o.start <= now && o.end > now);
    if (occ) {
      const end = localOf(tz, occ.end);
      return { kind: "studyNow", untilMin: end.day === localOf(tz, now).day ? end.min : 1440 };
    }
  }
  let best: { slot: TimetableSlot; start: number } | null = null;
  for (const s of mine.filter((x) => x.kind === "class")) {
    const occ = nextOccurrence(s, now);
    if (occ && (!best || occ.start < best.start)) best = { slot: s, start: occ.start };
  }
  if (!best) return null;
  const at = localOf(tz, best.start);
  // "Today 10:00" / "Tomorrow 10:00" read better than a weekday for the next two days.
  const ahead = at.day - todayIn(tz, now);
  const short = ahead === 0 ? "Today" : ahead === 1 ? "Tomorrow" : ahead < 7 ? weekdayShort(at.day) : shortDate(at.day);
  const long = ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : ahead < 7 ? weekdayName(at.day) : longDate(at.day);
  return {
    kind: "next", title: slotTitle(best.slot, subject.name), start: best.start, location: best.slot.location,
    weekOf: isoOf(weekStartOf(at.day, weekStart)), date: isoOf(at.day),
    when: `${short} ${hhmm(at.min)}`, whenLong: `${long} ${hhmm(at.min)}`,
  };
}

/** Study blocks today and tomorrow (the timer defaults to the subject of one happening now). */
export function studyBlocksSoon(slots: TimetableSlot[], now: number): { subjectId: string; start: number; end: number }[] {
  const out: { subjectId: string; start: number; end: number }[] = [];
  const until = now + 2 * 86_400_000;
  for (const s of slots) {
    if (s.kind !== "study" || !s.subjectId) continue;
    for (const o of occurrences(s, now - 86_400_000, until)) out.push({ subjectId: s.subjectId, start: o.start, end: o.end });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, 50);
}

/** Purge slots deleted more than 10 minutes ago (their Undo is long gone). */
export async function purgeOldDeletes(repo: Repo): Promise<void> {
  await repo.purgeDeletedSlots(new Date(Date.now() - 10 * 60_000).toISOString());
}
