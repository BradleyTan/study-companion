// The private calendar feed (timetable.md "What the feed contains"): every slot as an event with a
// stable UID, its title with the subject's emoji, location and times; weekly slots as weekly
// RRULEs with UNTIL and an EXDATE per skipped week. Times are in each slot's own zone (TZID) with a
// VTIMEZONE built from Intl, so a 10:00 class stays at 10:00 across daylight saving in Google,
// Apple and Outlook Calendar. Nothing else (no notes, no study history) is in it.
import { dayOf, instantOf, tzOffset, ymd } from "./dates";
import { slotTitle, type SlotLike } from "./slots";

export type FeedSlot = SlotLike & { updatedAt: string };
export type FeedSubject = { id: string; name: string; emoji: string };

/** TEXT escaping (RFC 5545 3.3.11); control characters dropped. */
export function escapeText(v: string): string {
  let out = "";
  for (const ch of v) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === ";") out += "\\;";
    else if (ch === ",") out += "\\,";
    else if (ch === "\n") out += "\\n";
    else if (code < 0x20 || code === 0x7f) continue;
    else out += ch;
  }
  return out;
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets without splitting a UTF-8 character (RFC 5545 3.1). */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = encoder.encode(ch).length;
    if (bytes + b > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** 20261019T100000 (local) for a day and minute. */
function localStamp(day: number, min: number): string {
  const { y, m, d } = ymd(day);
  return `${y}${pad(m)}${pad(d)}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
}
/** 20261019T090000Z. */
export function utcStamp(ms: number): string {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}
function offsetText(mins: number): string {
  const sign = mins < 0 ? "-" : "+";
  const a = Math.abs(mins);
  return `${sign}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
}

/** UTC instants where `tz` changes its offset during [from, to). */
export function transitions(tz: string, from: number, to: number): { at: number; before: number; after: number }[] {
  const out: { at: number; before: number; after: number }[] = [];
  const STEP = 7 * 86_400_000;
  let prev = from;
  let prevOff = tzOffset(tz, from);
  for (let t = from + STEP; t <= to + STEP; t += STEP) {
    const off = tzOffset(tz, t);
    if (off !== prevOff) {
      // Narrow down to the minute.
      let lo = prev, hi = t;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
        if (tzOffset(tz, mid) === prevOff) lo = mid; else hi = mid;
      }
      out.push({ at: hi, before: prevOff / 60_000, after: off / 60_000 });
      prevOff = off;
    }
    prev = t;
  }
  return out;
}

/** A VTIMEZONE for `tz` covering the given years: one observance per offset change. */
export function vtimezone(tz: string, fromYear: number, toYear: number): string[] {
  const from = Date.UTC(fromYear, 0, 1);
  const to = Date.UTC(toYear + 1, 0, 1);
  const changes = transitions(tz, from, to);
  const startOff = tzOffset(tz, from) / 60_000;
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tz}`];
  const minOff = Math.min(startOff, ...changes.map((c) => c.after));
  // The offset in force at the start of the range.
  lines.push(startOff > minOff ? "BEGIN:DAYLIGHT" : "BEGIN:STANDARD",
    `DTSTART:${localStamp(dayOf(`${fromYear}-01-01`), 0)}`, `TZOFFSETFROM:${offsetText(startOff)}`, `TZOFFSETTO:${offsetText(startOff)}`,
    startOff > minOff ? "END:DAYLIGHT" : "END:STANDARD");
  for (const c of changes) {
    const kind = c.after > minOff ? "DAYLIGHT" : "STANDARD";
    // DTSTART is the local time of the change, read with the offset before it.
    const local = c.at + c.before * 60_000;
    const day = Math.floor(local / 86_400_000);
    const min = Math.round((local - day * 86_400_000) / 60_000);
    lines.push(`BEGIN:${kind}`, `DTSTART:${localStamp(day, min)}`, `TZOFFSETFROM:${offsetText(c.before)}`, `TZOFFSETTO:${offsetText(c.after)}`, `END:${kind}`);
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

/** The feed's SUMMARY: "🧬 Biology class" (emoji from the subject, title or its default). */
export function feedTitle(slot: SlotLike, subject: FeedSubject | null): string {
  const title = slotTitle(slot, subject?.name ?? null);
  return subject ? `${subject.emoji} ${title}` : title;
}

/** The whole calendar file (CRLF line endings, folded lines). */
export function buildFeed(slots: FeedSlot[], subjects: FeedSubject[], now: number): string {
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const lines: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//StudyNest//Timetable//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:StudyNest", "X-WR-CALDESC:Your StudyNest timetable",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  // One VTIMEZONE per zone used, over the years the slots cover (open-ended repeats: 2 years ahead).
  const years = new Map<string, { from: number; to: number }>();
  const thisYear = new Date(now).getUTCFullYear();
  for (const s of slots) {
    if (s.tz === "UTC") continue;
    const a = ymd(dayOf(s.startDate)).y;
    const b = s.recurrence === "weekly" ? (s.repeatUntil ? ymd(dayOf(s.repeatUntil)).y : Math.max(a, thisYear) + 2) : a;
    const cur = years.get(s.tz);
    years.set(s.tz, { from: Math.min(cur?.from ?? a, a), to: Math.max(cur?.to ?? b, b) });
  }
  for (const [tz, r] of years) lines.push(...vtimezone(tz, r.from, Math.min(r.to, r.from + 10)));

  const stamp = utcStamp(now);
  for (const s of slots) {
    const day = dayOf(s.startDate);
    const subject = s.subjectId ? byId.get(s.subjectId) ?? null : null;
    const when = (d: number, min: number) => (s.tz === "UTC" ? `:${utcStamp(instantOf("UTC", d, min))}` : `;TZID=${s.tz}:${localStamp(d, min)}`);
    const endDay = s.endMin === 1440 ? day + 1 : day;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@studynest`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${utcStamp(Date.parse(s.updatedAt))}`,
      `DTSTART${when(day, s.startMin)}`,
      `DTEND${when(endDay, s.endMin % 1440)}`,
      `SUMMARY:${escapeText(feedTitle(s, subject))}`,
    );
    if (s.location) lines.push(`LOCATION:${escapeText(s.location)}`);
    if (s.recurrence === "weekly") {
      const until = s.repeatUntil ? `;UNTIL=${utcStamp(instantOf(s.tz, dayOf(s.repeatUntil), s.startMin))}` : "";
      lines.push(`RRULE:FREQ=WEEKLY${until}`);
      if (s.skipDates.length) {
        const list = s.skipDates.map((d) => (s.tz === "UTC" ? utcStamp(instantOf("UTC", dayOf(d), s.startMin)) : localStamp(dayOf(d), s.startMin)));
        lines.push(`EXDATE${s.tz === "UTC" ? "" : `;TZID=${s.tz}`}:${list.join(",")}`);
      }
    }
    lines.push(`CATEGORIES:${s.kind === "class" ? "Class" : s.kind === "study" ? "Study" : "Other"}`, "TRANSP:OPAQUE", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A slot's first occurrence start as an instant (tests and previews). */
export const firstStart = (s: SlotLike) => instantOf(s.tz, dayOf(s.startDate), s.startMin);
