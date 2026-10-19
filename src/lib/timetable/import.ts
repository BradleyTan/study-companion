// Turning a university timetable file into timetable slots (timetable.md "Import the uni timetable").
// Every event is expanded into its dates within the next 26 weeks (weekly and daily RRULEs with
// BYDAY, INTERVAL, UNTIL, COUNT, EXDATE, RDATE and moved or cancelled weeks), shown in the
// student's time zone, and then folded back into weekly classes: the same name, room, weekday and
// time become one weekly slot with its missing weeks skipped. That works the same for files that
// repeat with RRULE and for files that list every week as its own event, keeps the slot count low
// (300 per student) and keeps times right across daylight saving changes in either zone.
import { createHash } from "node:crypto";
import { DAY_MS, dayOf, hhmm, instantOf, isoOf, isValidTimeZone, localOf, tzOffset, weekdayOf, weekdayShort, ymd } from "./dates";
import { parseRule, type IcsEvent, type IcsFile, type IcsTime, type Rule } from "./ics";
import { LOCATION_MAX, MAX_SLOT_MIN, TITLE_MAX } from "./slots";
import { COMMON_ZONES, zoneFromName } from "./zones";

import { IMPORT_HORIZON_WEEKS, IMPORT_MAX_CLASSES } from "./limits";

export { IMPORT_HORIZON_WEEKS, IMPORT_MAX_BYTES, IMPORT_MAX_CLASSES } from "./limits";
/** Most dates kept across the whole file. */
const MAX_OCCURRENCES = 5000;
/** Work budget for stepping through repeat rules (keeps a hostile file cheap). */
const MAX_STEPS = 200_000;
/** A gap of more than 4 weeks starts a new class instead of skipping weeks. */
const MAX_GAP_DAYS = 28;

export type LeftOut = {
  allDay: number;
  past: number;
  tooLong: number;
  unreadable: number;
  repeat: number;
  beyond: number;
  overLimit: number;
};

/** One class to add: a weekly slot or a one-off. */
export type ImportClass = {
  /** Stable key for re-imports (`import_uid`). */
  key: string;
  group: string;
  title: string | null;
  location: string | null;
  startDate: string;
  startMin: number;
  endMin: number;
  recurrence: "none" | "weekly";
  repeatUntil: string | null;
  skipDates: string[];
  /** How many dates it covers. */
  dates: number;
};

export type ImportGroup = {
  name: string;
  /** "Mon 10:00–11:00, weekly, 12 weeks" or "4 dates". */
  when: string;
  location: string | null;
  classes: number;
};

export type ImportPlan = {
  classes: ImportClass[];
  groups: ImportGroup[];
  left: LeftOut;
  /** The file's own time zone when it differs from the student's. */
  fileZone: string | null;
  firstDate: string | null;
  lastDate: string | null;
};

type Occ = { start: number; end: number; ev: IcsEvent };

const emptyLeft = (): LeftOut => ({ allDay: 0, past: 0, tooLong: 0, unreadable: 0, repeat: 0, beyond: 0, overLimit: 0 });

/** Which IANA zone a TZID means: its name, the file's VTIMEZONE (X-LIC-LOCATION, then its offsets). */
export function resolveZone(tzid: string, file: IcsFile, studentTz: string, year: number): string | null {
  const byName = zoneFromName(tzid);
  if (byName) return byName;
  const def = file.zones.get(tzid);
  if (!def) return null;
  const loc = zoneFromName(def.location);
  if (loc) return loc;
  // Only offsets to go on: the student's zone if it matches them, else a common zone that does.
  const want = [...new Set(def.offsets)].sort((a, b) => a - b).join(",");
  if (!want) return null;
  const offsetsOf = (z: string) => {
    const jan = tzOffset(z, Date.UTC(year, 0, 15)) / 60_000;
    const jul = tzOffset(z, Date.UTC(year, 6, 15)) / 60_000;
    return [...new Set([jan, jul])].sort((a, b) => a - b).join(",");
  };
  for (const z of [studentTz, ...COMMON_ZONES]) if (isValidTimeZone(z) && offsetsOf(z) === want) return z;
  return null;
}

/** A date-time as an instant, given the zone used for times without one. */
function instant(t: IcsTime, zoneOf: (tzid: string) => string | null, floating: string): number | null {
  if (t.kind === "utc") return t.ms;
  if (t.kind === "date") return null;
  const tz = t.tzid ? zoneOf(t.tzid) : floating;
  return tz ? instantOf(tz, t.day, t.min) : null;
}

/** Key of a local wall-clock time, for matching EXDATE and RECURRENCE-ID to dates. */
const wallKey = (day: number, min: number) => day * 1440 + min;

/**
 * Local days a rule produces from `first` (inclusive), in order. Without COUNT it jumps straight
 * to `skipTo` (whole intervals), so a rule that started years ago costs nothing extra.
 */
function* ruleDays(rule: Rule, first: number, skipTo: number, budget: { steps: number }): Generator<number> {
  const jump = rule.count === null && skipTo > first;
  if (rule.freq === "DAILY") {
    const d0 = jump ? first + Math.floor((skipTo - first) / rule.interval) * rule.interval : first;
    for (let d = d0; budget.steps-- > 0; d += rule.interval) {
      if (!rule.byDay || rule.byDay.includes(weekdayOf(d))) yield d;
    }
    return;
  }
  const days = rule.byDay ?? [weekdayOf(first)];
  // Days of the week in WKST order, as offsets from the week's first day.
  const offsets = days.map((wd) => (wd - rule.wkst + 7) % 7).sort((a, b) => a - b);
  const week0 = first - ((weekdayOf(first) - rule.wkst + 7) % 7);
  const period = 7 * rule.interval;
  const w0 = jump ? week0 + Math.max(0, Math.floor((skipTo - week0) / period)) * period : week0;
  for (let w = w0; budget.steps > 0; w += period) {
    for (const o of offsets) {
      if (budget.steps-- <= 0) return;
      const d = w + o;
      if (d >= first) yield d;
    }
  }
}

/** Every date of an event (master or one-off) from its start, as instants. */
function expand(ev: IcsEvent, ctx: Ctx, overrides: Set<number>): { occ: { start: number; end: number }[]; fail?: keyof LeftOut } {
  const s = ev.start!;
  if (s.kind === "date") return { occ: [], fail: "allDay" };
  const tz = s.kind === "utc" ? "UTC" : s.tzid ? ctx.zoneOf(s.tzid) : ctx.floating;
  if (!tz) return { occ: [], fail: "unreadable" };
  const start0 = s.kind === "utc" ? s.ms : instantOf(tz, s.day, s.min);
  const local0 = s.kind === "utc" ? localOf("UTC", s.ms) : { day: s.day, min: s.min };

  let dur: number;
  if (ev.end) {
    if (ev.end.kind === "date") return { occ: [], fail: "allDay" };
    const e = instant(ev.end, ctx.zoneOf, ctx.floating);
    if (e === null) return { occ: [], fail: "unreadable" };
    dur = e - start0;
  } else dur = ev.duration ?? 3_600_000;
  if (dur <= 0) return { occ: [], fail: "unreadable" };
  if (dur > MAX_SLOT_MIN * 60_000) return { occ: [], fail: "tooLong" };

  // EXDATEs and moved weeks, as local wall-clock keys in the event's zone (or whole days).
  const exKeys = new Set(overrides);
  const exDays = new Set<number>();
  for (const x of ev.exdates) {
    if (x.kind === "date") { exDays.add(x.day); continue; }
    const at = instant(x, ctx.zoneOf, ctx.floating);
    if (at !== null) { const l = localOf(tz, at); exKeys.add(wallKey(l.day, l.min)); }
  }

  const out: { start: number; end: number }[] = [];
  const push = (day: number, min: number) => {
    if (exDays.has(day) || exKeys.has(wallKey(day, min))) return;
    const st = tz === "UTC" ? day * DAY_MS + min * 60_000 : instantOf(tz, day, min);
    out.push({ start: st, end: st + dur });
  };

  if (!ev.rrule) {
    push(local0.day, local0.min);
  } else {
    const rule = parseRule(ev.rrule);
    if (!rule) return { occ: [], fail: "repeat" };
    let untilKey = Infinity;
    if (rule.until) {
      if (rule.until.kind === "date") untilKey = wallKey(rule.until.day, 1439);
      else {
        const at = instant(rule.until, ctx.zoneOf, tz);
        if (at === null) return { occ: [], fail: "repeat" };
        const l = localOf(tz, at);
        untilKey = wallKey(l.day, l.min);
      }
    }
    const endDay = ctx.windowEndDay + 2;
    let n = 0;
    // DTSTART is always the first date, even when it doesn't match BYDAY.
    const firstMatches = !rule.byDay || rule.byDay.includes(weekdayOf(local0.day));
    if (!firstMatches) { n++; push(local0.day, local0.min); }
    for (const d of ruleDays(rule, local0.day, ctx.today - 7, ctx.budget)) {
      if (d > endDay || wallKey(d, local0.min) > untilKey) break;
      if (rule.count !== null && n >= rule.count) break;
      n++;
      push(d, local0.min);
      if (out.length > MAX_OCCURRENCES) break;
    }
    if (ctx.budget.steps <= 0) return { occ: [], fail: "repeat" };
  }
  for (const r of ev.rdates) {
    if (r.kind === "date") { push(r.day, local0.min); continue; }
    const at = instant(r, ctx.zoneOf, ctx.floating);
    if (at !== null) out.push({ start: at, end: at + dur });
  }
  return { occ: out };
}

type Ctx = {
  zoneOf: (tzid: string) => string | null;
  floating: string;
  today: number;
  windowEndDay: number;
  budget: { steps: number };
};

const keyHash = (s: string) => createHash("sha256").update(s).digest("base64url").slice(0, 32);
const clip = (s: string | null, max: number) => (s ? s.replace(/\s+/g, " ").trim().slice(0, max) || null : null);

/** "Mon 10:00–11:00, weekly, 12 weeks" / "Tue 14:00–15:00, once" for one class. */
function whenLabel(c: ImportClass): string {
  const day = weekdayShort(dayOf(c.startDate));
  const t = `${day} ${hhmm(c.startMin)}–${hhmm(c.endMin)}`;
  return c.recurrence === "weekly" ? `${t}, weekly, ${c.dates} weeks` : `${t}, once`;
}

/**
 * Plans an import for a student in `tz` at `now`: the classes to add (nothing is saved here) and
 * what was left out. Pure apart from the clock passed in.
 */
export function planImport(file: IcsFile, tz: string, now: number): ImportPlan {
  const left = emptyLeft();
  left.overLimit += file.overLimit;
  const today = localOf(tz, now).day;
  const windowEndDay = today + IMPORT_HORIZON_WEEKS * 7;
  const windowEnd = instantOf(tz, windowEndDay, 0);
  const year = ymd(today).y;
  const zoneCache = new Map<string, string | null>();
  const zoneOf = (tzid: string) => {
    if (!zoneCache.has(tzid)) zoneCache.set(tzid, resolveZone(tzid, file, tz, year));
    return zoneCache.get(tzid)!;
  };
  const calZone = file.calendarZone ? zoneFromName(file.calendarZone) : null;
  const ctx: Ctx = { zoneOf, floating: calZone ?? tz, today, windowEndDay, budget: { steps: MAX_STEPS } };

  // Moved or cancelled weeks (RECURRENCE-ID) take that date out of their series.
  const masters = new Map<string, IcsEvent>();
  for (const m of file.events) if (m.uid && !m.recurrenceId && m.start && m.start.kind !== "date" && !masters.has(m.uid)) masters.set(m.uid, m);
  const overridesByUid = new Map<string, Set<number>>();
  for (const ev of file.events) {
    if (!ev.uid || !ev.recurrenceId || ev.recurrenceId.kind === "date") continue;
    const master = masters.get(ev.uid);
    const ms = master?.start;
    const mz = !ms || ms.kind === "date" ? null : ms.kind === "utc" ? "UTC" : ms.tzid ? zoneOf(ms.tzid) : ctx.floating;
    const at = instant(ev.recurrenceId, zoneOf, ctx.floating);
    if (!mz || at === null) continue;
    const l = localOf(mz, at);
    const set = overridesByUid.get(ev.uid) ?? new Set<number>();
    set.add(wallKey(l.day, l.min));
    overridesByUid.set(ev.uid, set);
  }

  let fileZone: string | null = calZone && calZone !== tz ? calZone : null;
  const occs: Occ[] = [];
  for (const ev of file.events) {
    if (ev.status === "CANCELLED") continue;
    if (!ev.start || ev.broken) { left.unreadable++; continue; }
    if (ev.start.kind === "local" && ev.start.tzid && !fileZone) {
      const z = zoneOf(ev.start.tzid);
      if (z && z !== tz) fileZone = z;
    }
    const isMaster = !ev.recurrenceId;
    const { occ, fail } = expand(isMaster ? ev : { ...ev, rrule: null, rdates: [], exdates: [] }, ctx, isMaster && ev.uid ? overridesByUid.get(ev.uid) ?? new Set() : new Set());
    if (fail) { left[fail]++; continue; }
    const future = occ.filter((o) => o.end > now);
    // No dates left (or only past ones): a repeat that ended, or a one-off that's over.
    if (!future.length && (occ.length || ev.rrule)) { left.past++; continue; }
    const inWindow = future.filter((o) => o.start < windowEnd);
    if (future.length && !inWindow.length) { left.beyond++; continue; }
    let crossed = false;
    for (const o of inWindow) {
      if (occs.length >= MAX_OCCURRENCES) { left.overLimit++; break; }
      const a = localOf(tz, o.start), b = localOf(tz, o.end);
      if (b.day !== a.day && !(b.day === a.day + 1 && b.min === 0)) { crossed = true; continue; }
      occs.push({ ...o, ev });
    }
    if (crossed) left.tooLong++;
  }

  // Fold dates back into weekly classes: same name, room, weekday and times.
  type Row = { day: number; startMin: number; endMin: number; title: string | null; location: string | null; group: string };
  const byKey = new Map<string, Row[]>();
  for (const o of occs) {
    const a = localOf(tz, o.start), b = localOf(tz, o.end);
    const endMin = b.day === a.day ? b.min : 1440;
    const title = clip(o.ev.summary, TITLE_MAX);
    const location = clip(o.ev.location, LOCATION_MAX);
    const key = [title ?? "", location ?? "", weekdayOf(a.day), a.min, endMin].join("\u0001");
    const list = byKey.get(key) ?? [];
    list.push({ day: a.day, startMin: a.min, endMin, title, location, group: title ?? "Untitled" });
    byKey.set(key, list);
  }

  const classes: ImportClass[] = [];
  for (const [key, rows] of byKey) {
    const days = [...new Set(rows.map((r) => r.day))].sort((x, y) => x - y);
    const r0 = rows[0];
    const runs: number[][] = [];
    for (const d of days) {
      const run = runs[runs.length - 1];
      if (run && d - run[run.length - 1] <= MAX_GAP_DAYS) run.push(d);
      else runs.push([d]);
    }
    runs.forEach((run, i) => {
      const base = { group: r0.group, title: r0.title, location: r0.location, startMin: r0.startMin, endMin: r0.endMin };
      if (run.length === 1) {
        classes.push({ ...base, key: keyHash(`${key}\u0001${isoOf(run[0])}`), startDate: isoOf(run[0]), recurrence: "none", repeatUntil: null, skipDates: [], dates: 1 });
        return;
      }
      const have = new Set(run);
      const skips: string[] = [];
      for (let d = run[0]; d <= run[run.length - 1]; d += 7) if (!have.has(d)) skips.push(isoOf(d));
      classes.push({
        ...base,
        key: keyHash(i === 0 ? key : `${key}\u0001${isoOf(run[0])}`),
        startDate: isoOf(run[0]), recurrence: "weekly", repeatUntil: isoOf(run[run.length - 1]), skipDates: skips, dates: run.length,
      });
    });
  }
  classes.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.startMin - b.startMin || (a.title ?? "").localeCompare(b.title ?? ""));
  if (classes.length > IMPORT_MAX_CLASSES) {
    left.overLimit += classes.length - IMPORT_MAX_CLASSES;
    classes.length = IMPORT_MAX_CLASSES;
  }

  const groups: ImportGroup[] = [];
  const byGroup = new Map<string, ImportClass[]>();
  for (const c of classes) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
  for (const [name, list] of byGroup) {
    const weekly = list.filter((c) => c.recurrence === "weekly");
    const once = list.length - weekly.length;
    const parts = weekly.slice(0, 2).map(whenLabel);
    if (weekly.length > 2) parts.push(`+${weekly.length - 2} more`);
    if (once) parts.push(once === 1 && !weekly.length ? whenLabel(list[0]) : `${once} date${once === 1 ? "" : "s"}`);
    const locations = [...new Set(list.map((c) => c.location).filter(Boolean))];
    groups.push({ name, when: parts.join("; "), location: locations.length === 1 ? locations[0] : locations.length ? `${locations.length} rooms` : null, classes: list.length });
  }

  let lastDay = -Infinity;
  for (const c of classes) lastDay = Math.max(lastDay, dayOf(c.repeatUntil ?? c.startDate));
  return {
    classes, groups, left, fileZone,
    firstDate: classes.length ? classes.reduce((m, c) => (c.startDate < m ? c.startDate : m), classes[0].startDate) : null,
    lastDate: classes.length ? isoOf(lastDay) : null,
  };
}

/** "Left out: 3 all-day events, 12 past classes." (null when nothing was). */
export function leftOutLine(left: LeftOut): string | null {
  const parts: string[] = [];
  const n = (k: number, one: string, many: string) => k && parts.push(`${k} ${k === 1 ? one : many}`);
  n(left.allDay, "all-day event", "all-day events");
  n(left.past, "past class", "past classes");
  n(left.tooLong, "event over 12 hours or past midnight", "events over 12 hours or past midnight");
  n(left.repeat, "event with a repeat we couldn't read", "events with repeats we couldn't read");
  n(left.unreadable, "event had times we couldn't read", "events had times we couldn't read");
  n(left.beyond, "event more than 26 weeks away", "events more than 26 weeks away");
  n(left.overLimit, "class over the import limit", "classes over the import limit");
  return parts.length ? `Left out: ${parts.join(", ")}.` : null;
}

// ---- subject matching ----------------------------------------------------------------------

/** Course codes such as "BIOL1001", "CS 101", "MATH2B03". */
export function courseCodes(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/\b([A-Z]{2,5})\s?(\d{3,5}[A-Z]?)\b/g)) out.add(m[1] + m[2]);
  return [...out];
}

/**
 * The subject a group is pre-matched to (timetable.md: the name contains a subject's name, or a
 * course code already used for that subject); null for "No subject".
 */
export function matchSubject(group: string, subjects: { id: string; name: string }[], codeOwners: Map<string, string>): string | null {
  const lower = ` ${group.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  let best: { id: string; len: number } | null = null;
  for (const s of subjects) {
    const name = s.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (name.length >= 2 && lower.includes(` ${name} `) && (!best || name.length > best.len)) best = { id: s.id, len: name.length };
  }
  if (best) return best.id;
  for (const code of courseCodes(group)) {
    const owner = codeOwners.get(code);
    if (owner) return owner;
  }
  return null;
}

/** Course code → subject, from subject names and the titles of the student's existing slots. */
export function codeOwners(subjects: { id: string; name: string }[], slots: { subjectId: string | null; title: string | null }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of subjects) for (const c of courseCodes(s.name)) map.set(c, s.id);
  for (const s of slots) if (s.subjectId && s.title) for (const c of courseCodes(s.title)) if (!map.has(c)) map.set(c, s.subjectId);
  return map;
}
