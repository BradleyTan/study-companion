// A small iCalendar (RFC 5545) reader for university timetable files (timetable.md "Import").
// It reads only what a timetable needs: VEVENT (UID, SUMMARY, LOCATION, STATUS, DTSTART, DTEND,
// DURATION, RRULE, EXDATE, RDATE, RECURRENCE-ID) and VTIMEZONE (TZID, X-LIC-LOCATION, offsets).
// Every step is a single pass over the text (no backtracking regular expressions on file content),
// so a 1 MB file reads in linear time. Nothing is fetched: a URL in the file is just text.

export type IcsTime =
  | { kind: "date"; day: number }
  | { kind: "utc"; ms: number }
  | { kind: "local"; day: number; min: number; tzid: string | null };

export type IcsEvent = {
  uid: string | null;
  summary: string;
  location: string | null;
  status: string | null;
  start: IcsTime | null;
  end: IcsTime | null;
  /** DURATION in ms (when there's no DTEND). */
  duration: number | null;
  rrule: string | null;
  exdates: IcsTime[];
  rdates: IcsTime[];
  recurrenceId: IcsTime | null;
  /** A date or time in the event we couldn't read. */
  broken: boolean;
};

export type IcsZone = { tzid: string; location: string | null; offsets: number[] };

export type IcsFile = {
  events: IcsEvent[];
  zones: Map<string, IcsZone>;
  /** X-WR-TIMEZONE: the calendar's zone for times without one (Google exports). */
  calendarZone: string | null;
  /** VEVENTs beyond the reading limit. */
  overLimit: number;
};

/** Most VEVENTs read from one file; a 1 MB file can't hold many more. */
export const MAX_EVENTS_READ = 5000;
const MAX_TEXT = 2000;

export type ContentLine = { name: string; params: Map<string, string>; value: string };

/** Splits the file into logical lines, joining folded lines (CRLF or LF followed by a space or tab). */
export function unfold(text: string): string[] {
  const out: string[] = [];
  let cur: string[] | null = null;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && cur) {
      cur.push(raw.slice(1));
      continue;
    }
    if (cur) out.push(cur.join(""));
    cur = [raw];
  }
  if (cur) out.push(cur.join(""));
  return out;
}

/** "DTSTART;TZID="Europe/London":20261019T100000" → name, params and value (quotes respected). */
export function parseLine(line: string): ContentLine | null {
  let i = 0;
  const n = line.length;
  while (i < n && line[i] !== ";" && line[i] !== ":") i++;
  if (i >= n) return null;
  const name = line.slice(0, i).trim().toUpperCase();
  const params = new Map<string, string>();
  while (i < n && line[i] === ";") {
    i++;
    const ks = i;
    while (i < n && line[i] !== "=" && line[i] !== ";" && line[i] !== ":") i++;
    const key = line.slice(ks, i).trim().toUpperCase();
    let val = "";
    if (line[i] === "=") {
      i++;
      const vs = i;
      let quoted = false;
      for (; i < n; i++) {
        const c = line[i];
        if (c === '"') quoted = !quoted;
        else if (!quoted && (c === ";" || c === ":")) break;
      }
      val = line.slice(vs, i).replace(/"/g, "");
    }
    if (key) params.set(key, val);
  }
  if (line[i] !== ":") return null;
  return { name, params, value: line.slice(i + 1) };
}

/** TEXT values: \n, \, \; and \\ escapes (RFC 5545 3.3.11), trimmed and length-capped. */
export function unescapeText(v: string): string {
  const out: string[] = [];
  for (let i = 0; i < v.length && out.length < MAX_TEXT; i++) {
    const c = v[i];
    if (c === "\\" && i + 1 < v.length) {
      const nx = v[++i];
      out.push(nx === "n" || nx === "N" ? "\n" : nx);
    } else out.push(c);
  }
  return out.join("").trim();
}

/** Splits a list value on unescaped commas. */
function splitList(v: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "\\") { i++; continue; }
    if (v[i] === ",") { out.push(v.slice(start, i)); start = i + 1; }
  }
  out.push(v.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

/** A DATE or DATE-TIME value (with its TZID parameter), or null when it isn't one. */
export function parseTime(value: string, params: Map<string, string>): IcsTime | null {
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const check = new Date(t);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || y < 1900 || y > 2200) return null;
  const day = Math.round(t / 86_400_000);
  if (m[4] === undefined) return { kind: "date", day };
  if (params.get("VALUE")?.toUpperCase() === "DATE") return null;
  const h = Number(m[4]), mi = Number(m[5]), s = Number(m[6] ?? 0);
  if (h > 23 || mi > 59 || s > 60) return null;
  if (m[7]) return { kind: "utc", ms: t + (h * 60 + mi) * 60_000 + s * 1000 };
  return { kind: "local", day, min: h * 60 + mi, tzid: params.get("TZID")?.trim() || null };
}

/** DURATION ("PT1H30M", "P1D") in ms; null when it isn't one. */
export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d{1,4})W)?(?:(\d{1,4})D)?(?:T(?:(\d{1,4})H)?(?:(\d{1,5})M)?(?:(\d{1,6})S)?)?$/.exec(v.trim());
  if (!m || v.trim() === "P" || v.trim().endsWith("T")) return null;
  const ms = ((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 86_400 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

/** "+0100" / "-0430" → minutes. */
function parseOffset(v: string): number | null {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(v.trim());
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -mins : mins;
}

function emptyEvent(): IcsEvent {
  return { uid: null, summary: "", location: null, status: null, start: null, end: null, duration: null, rrule: null, exdates: [], rdates: [], recurrenceId: null, broken: false };
}

/** Reads a calendar file. Returns null when the text isn't an iCalendar file. */
export function parseIcs(text: string): IcsFile | null {
  const body = text.replace(/^﻿/, "");
  const lines = unfold(body);
  const firstReal = lines.find((l) => l.trim() !== "");
  if (!firstReal || firstReal.trim().toUpperCase() !== "BEGIN:VCALENDAR") return null;

  const file: IcsFile = { events: [], zones: new Map(), calendarZone: null, overLimit: 0 };
  const stack: string[] = [];
  let ev: IcsEvent | null = null;
  let zone: IcsZone | null = null;

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const line = parseLine(raw);
    if (!line) continue;
    const top = stack[stack.length - 1];
    if (line.name === "BEGIN") {
      const what = line.value.trim().toUpperCase();
      stack.push(what);
      if (what === "VEVENT" && stack.length === 2 && top === "VCALENDAR") ev = emptyEvent();
      if (what === "VTIMEZONE" && top === "VCALENDAR") zone = { tzid: "", location: null, offsets: [] };
      if (stack.length > 20) return file; // nesting this deep isn't a timetable
      continue;
    }
    if (line.name === "END") {
      const what = line.value.trim().toUpperCase();
      if (top === what) stack.pop();
      if (what === "VEVENT" && ev) {
        if (file.events.length < MAX_EVENTS_READ) file.events.push(ev);
        else file.overLimit++;
        ev = null;
      }
      if (what === "VTIMEZONE" && zone) {
        if (zone.tzid && file.zones.size < 100) file.zones.set(zone.tzid, zone);
        zone = null;
      }
      continue;
    }
    if (top === "VCALENDAR" && line.name === "X-WR-TIMEZONE") file.calendarZone = unescapeText(line.value) || null;
    if (zone && top === "VTIMEZONE") {
      if (line.name === "TZID") zone.tzid = line.value.trim().replace(/^"|"$/g, "");
      if (line.name === "X-LIC-LOCATION") zone.location = line.value.trim();
    }
    if (zone && (top === "STANDARD" || top === "DAYLIGHT") && line.name === "TZOFFSETTO") {
      const o = parseOffset(line.value);
      if (o !== null && zone.offsets.length < 50) zone.offsets.push(o);
    }
    if (!ev || top !== "VEVENT") continue; // properties of a VALARM inside an event are ignored
    switch (line.name) {
      case "UID": ev.uid = line.value.trim().slice(0, 500) || null; break;
      case "SUMMARY": ev.summary = unescapeText(line.value); break;
      case "LOCATION": ev.location = unescapeText(line.value) || null; break;
      case "STATUS": ev.status = line.value.trim().toUpperCase(); break;
      case "DTSTART": ev.start = parseTime(line.value, line.params); if (!ev.start) ev.broken = true; break;
      case "DTEND": ev.end = parseTime(line.value, line.params); if (!ev.end) ev.broken = true; break;
      case "DURATION": ev.duration = parseDuration(line.value); if (ev.duration === null) ev.broken = true; break;
      case "RRULE": ev.rrule = line.value.trim(); break;
      case "RECURRENCE-ID": ev.recurrenceId = parseTime(line.value, line.params); if (!ev.recurrenceId) ev.broken = true; break;
      case "EXDATE":
      case "RDATE": {
        if (line.params.get("VALUE")?.toUpperCase() === "PERIOD") { ev.broken = true; break; }
        const list = line.name === "EXDATE" ? ev.exdates : ev.rdates;
        for (const v of splitList(line.value)) {
          const t = parseTime(v, line.params);
          if (t && list.length < 400) list.push(t);
          else if (!t) ev.broken = true;
        }
        break;
      }
    }
  }
  return file;
}

// ---- RRULE --------------------------------------------------------------------------------

export type Rule = {
  freq: "WEEKLY" | "DAILY";
  interval: number;
  /** Weekdays, 0 = Sunday. */
  byDay: number[] | null;
  count: number | null;
  until: IcsTime | null;
  /** Week start, 0 = Sunday (default Monday). */
  wkst: number;
};

const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** A weekly or daily RRULE we can represent, or null for anything else (monthly, BYSETPOS, …). */
export function parseRule(v: string): Rule | null {
  const parts = new Map<string, string>();
  for (const p of v.split(";")) {
    const eq = p.indexOf("=");
    if (eq > 0) parts.set(p.slice(0, eq).trim().toUpperCase(), p.slice(eq + 1).trim());
  }
  const freq = parts.get("FREQ")?.toUpperCase();
  if (freq !== "WEEKLY" && freq !== "DAILY") return null;
  for (const k of parts.keys()) if (!["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL", "WKST"].includes(k)) return null;
  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) return null;
  let byDay: number[] | null = null;
  if (parts.has("BYDAY")) {
    byDay = [];
    for (const code of parts.get("BYDAY")!.split(",")) {
      const d = DAY_CODES[code.trim().toUpperCase()];
      if (d === undefined) return null; // "1MO", "-1FR": monthly-style positions
      if (!byDay.includes(d)) byDay.push(d);
    }
    if (!byDay.length) return null;
  }
  const count = parts.has("COUNT") ? Number(parts.get("COUNT")) : null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null;
  let until: IcsTime | null = null;
  if (parts.has("UNTIL")) {
    until = parseTime(parts.get("UNTIL")!, new Map());
    if (!until) return null;
  }
  const wkst = parts.has("WKST") ? DAY_CODES[parts.get("WKST")!.toUpperCase()] : 1;
  if (wkst === undefined) return null;
  return { freq, interval, byDay, count, until, wkst };
}
