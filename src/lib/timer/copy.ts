// Words for the timer (timer.md): labels, announcements, the chip's name and the tab title.
import { safeTimeZone } from "@/lib/srs/due";
import { clock, displaySec, type Phase } from "./machine";

export const PHASE_NAME: Record<Phase, string> = { focus: "Focus", short_break: "Short break", long_break: "Long break" };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "18 minutes 42 seconds", "25 minutes", "40 seconds". */
export function spokenTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (!m) return plural(s, "second");
  return s ? `${plural(m, "minute")} ${plural(s, "second")}` : plural(m, "minute");
}

/** Whole minutes left for the chip ("18 minutes left"; under a minute says so). */
export function minutesLeft(sec: number): string {
  return sec < 60 ? "under a minute left" : `${plural(Math.floor(sec / 60), "minute")} left`;
}

/** role="timer" name: "Focus, Biology, 18 minutes 42 seconds left". */
export function timerName(o: { phase: Phase; paused: boolean; subject: string | null; sec: number; idle: boolean }): string {
  const parts = [o.paused ? `Paused, ${PHASE_NAME[o.phase].toLowerCase()}` : PHASE_NAME[o.phase]];
  if (o.subject) parts.push(o.subject);
  parts.push(o.idle ? spokenTime(o.sec) : `${spokenTime(o.sec)} left`);
  return parts.join(", ");
}

export type ChipView =
  | { kind: "idle" }
  | { kind: "running" | "paused"; phase: Phase; sec: number; subject: string | null }
  | { kind: "ended"; phase: Phase };

export function chipName(v: ChipView): string {
  if (v.kind === "idle") return "Study timer, not running";
  if (v.kind === "ended") return v.phase === "focus" ? "Study timer: round done" : "Study timer: break's over";
  const what = v.kind === "paused" ? `paused, ${PHASE_NAME[v.phase].toLowerCase()}` : PHASE_NAME[v.phase].toLowerCase();
  return `Study timer: ${what}, ${minutesLeft(v.sec)}${v.subject ? `, ${v.subject}` : ""}`;
}

/** Tab title while the timer runs (null: leave the page's own title). */
export function tabTitle(v: ChipView, unseenEnd: boolean): string | null {
  if (unseenEnd) return "Time's up! · StudyNest";
  if (v.kind === "paused") return "Paused · StudyNest";
  if (v.kind === "running") return `${clock(v.sec, false)} · ${v.phase === "focus" ? "Focus" : "Break"} · StudyNest`;
  return null;
}

export function startAnnouncement(phase: Phase, plannedSec: number, subject: string | null, focusMode: boolean): string {
  const min = plural(Math.round(plannedSec / 60), "minute");
  if (phase !== "focus") return `Break started: ${min}.`;
  return `Focus started: ${min}${subject ? `, ${subject}` : ""}.${focusMode ? " Focus mode is on: sounds and animations are quieter." : ""}`;
}

export const pauseAnnouncement = (sec: number) => `Paused with ${minutesLeft(sec)}.`;
export const resumeAnnouncement = (sec: number) => `Resumed: ${minutesLeft(sec)}.`;
export const ONE_MINUTE = "1 minute left.";

/** "14:25" in the student's time zone. */
export function wallTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: safeTimeZone(tz), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

export function awayLine(phase: Phase, endedAt: number, tz: string): string {
  return phase === "focus" ? `Your focus round finished at ${wallTime(endedAt, tz)}. Nice work!` : `Your break ended at ${wallTime(endedAt, tz)}.`;
}

/** End card text (timer.md "End card"). */
export function endCard(o: { phase: Phase; next: Phase; nextMin: number; today: number; longEvery: number }): { heading: string; line: string } {
  if (o.phase !== "focus") return { heading: "Break's over", line: "Ready for another round?" };
  if (o.next === "long_break") {
    const n = o.longEvery <= 8 ? cap(WORDS[o.longEvery]) : String(o.longEvery);
    return { heading: "Round done! 🍅", line: `${n} in a row! Take a proper ${o.nextMin}-minute break.` };
  }
  return { heading: "Round done! 🍅", line: `That's ${o.today} today. Time for a ${o.nextMin}-minute break.` };
}

export function endAnnouncement(o: { phase: Phase; next: Phase; nextMin: number }): string {
  return o.phase === "focus" ? `Round done! Time for a ${o.nextMin}-minute break.` : "Break's over. Ready for another round?";
}

/** Notification text (timer.md "Notifications"). */
export function notificationText(o: { phase: Phase; nextMin: number }): { title: string; body: string } {
  return o.phase === "focus"
    ? { title: "Round done! 🍅", body: `Time for a ${o.nextMin}-minute break.` }
    : { title: "Break's over", body: "Ready for another round?" };
}

/** Inline confirm for Stop. */
export function stopQuestion(focusedSec: number, subject: string | null): string {
  if (focusedSec < 60) return "End this round? It's under a minute, so it won't be saved.";
  return `End this round? ${Math.floor(focusedSec / 60)} min${subject ? ` of ${subject}` : ""} will be saved.`;
}

export { clock, displaySec };
