// Calendar dates and wall-clock time in IANA time zones (timetable.md "Repeating slots").
// Dates are whole days since 1970-01-01 ("day numbers") so week arithmetic is plain integers;
// conversion to and from instants goes through Intl, cached per zone.

export const DAY_MS = 86_400_000;
export const MIN_MS = 60_000;

/** "2026-10-19" → day number. Returns NaN for anything that isn't a real date. */
export function dayOf(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return NaN;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN;
  return Math.round(t / DAY_MS);
}

export function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function ymd(day: number): { y: number; m: number; d: number } {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** First day of the week containing `day` (Monday or Sunday start). */
export function weekStartOf(day: number, weekStart: "mon" | "sun" = "mon"): number {
  const wd = weekdayOf(day);
  return day - (weekStart === "mon" ? (wd + 6) % 7 : wd);
}

// Building an Intl.DateTimeFormat is slow, and an imported file can name thousands of zones, so
// answers are remembered (bounded, so a hostile file can't grow it without limit).
const validZones = new Map<string, boolean>();
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  const known = validZones.get(tz);
  if (known !== undefined) return known;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  if (validZones.size >= 2000) validZones.clear();
  validZones.set(tz, ok);
  return ok;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

function parts(tz: string, ms: number) {
  let y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    switch (p.type) {
      case "year": y = Number(p.value); break;
      case "month": mo = Number(p.value); break;
      case "day": d = Number(p.value); break;
      case "hour": h = Number(p.value); break;
      case "minute": mi = Number(p.value); break;
      case "second": s = Number(p.value); break;
    }
  }
  return { y, mo, d, h: h === 24 ? 0 : h, mi, s };
}

/** Offset of `tz` from UTC at instant `ms`, in ms (positive east of Greenwich). */
export function tzOffset(tz: string, ms: number): number {
  const p = parts(tz, ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The local date (day number) and minute of the day of an instant in `tz`. */
export function localOf(tz: string, ms: number): { day: number; min: number } {
  const p = parts(tz, ms);
  return { day: Math.round(Date.UTC(p.y, p.mo - 1, p.d) / DAY_MS), min: p.h * 60 + p.mi };
}

/**
 * The instant of local wall-clock time `min` (minutes after midnight, may be 1440) on `day` in
 * `tz`. In a daylight-saving gap (a time that doesn't exist) it moves forward by the gap; in the
 * repeated hour it picks the first one.
 */
export function instantOf(tz: string, day: number, min: number): number {
  const wall = day * DAY_MS + min * MIN_MS;
  // Offsets are within ±14 h and changes are months apart, so the offsets in force 14 hours
  // either side of the wall time are the only candidates.
  const SPAN = 14 * 3_600_000;
  const early = tzOffset(tz, wall - SPAN);
  const late = tzOffset(tz, wall + SPAN);
  let best: number | null = null;
  for (const o of early === late ? [early] : [early, late]) {
    const t = wall - o;
    if (tzOffset(tz, t) === o && (best === null || t < best)) best = t;
  }
  // Gap: the wall time doesn't exist; read it with the offset from before the change (moves it forward).
  return best ?? wall - early;
}

/** Today in `tz` as a day number. */
export function todayIn(tz: string, now: number): number {
  return localOf(tz, now).day;
}

/** "10:00" (24-hour) from minutes after midnight; 1440 → "24:00". */
export function hhmm(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** "09:05" for `<input type="time">`; 1440 → "00:00". */
export function timeValue(min: number): string {
  const m = min % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "09:05" → 545; null when it isn't a time. */
export function parseTimeValue(v: string): number | null {
  const m = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const weekdayName = (day: number) => WEEKDAYS[weekdayOf(day)];
export const weekdayShort = (day: number) => WEEKDAYS[weekdayOf(day)].slice(0, 3);
export const monthName = (m: number) => MONTHS[m - 1];
export const monthShort = (m: number) => MONTHS[m - 1].slice(0, 3);

/** "Mon 14 Oct". */
export function shortDate(day: number): string {
  const { m, d } = ymd(day);
  return `${weekdayShort(day)} ${d} ${monthShort(m)}`;
}
/** "Monday 14 October". */
export function longDate(day: number): string {
  const { m, d } = ymd(day);
  return `${weekdayName(day)} ${d} ${monthName(m)}`;
}
/** "14 Oct". */
export function dayMonth(day: number): string {
  const { m, d } = ymd(day);
  return `${d} ${monthShort(m)}`;
}

/** Week label "14 – 20 Oct" or "28 Sep – 4 Oct". */
export function weekLabel(first: number): string {
  const a = ymd(first), b = ymd(first + 6);
  return a.m === b.m ? `${a.d} – ${b.d} ${monthShort(b.m)}` : `${a.d} ${monthShort(a.m)} – ${b.d} ${monthShort(b.m)}`;
}

/** "1 h 30 min", "45 min", "2 h". */
export function durationLabel(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
