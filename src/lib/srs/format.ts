const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Interval copy for grade buttons: "in 1 min", "in 3 h", "in 1 day", "in 4 days",
 * "in 2 wk", "in 3 mo", "in 1 yr". Rounded to the nearest unit; never seconds.
 */
export function formatInterval(ms: number): string {
  const mins = Math.max(1, Math.round(ms / MIN));
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(ms / DAY);
  if (days < 14) return `in ${days} ${days === 1 ? "day" : "days"}`;
  if (days < 60) return `in ${Math.round(days / 7)} wk`;
  if (days < 365) return `in ${Math.round(days / 30)} mo`;
  return `in ${Math.max(1, Math.round(days / 365))} yr`;
}

/** Local calendar day in `tz` as a UTC midnight timestamp (for whole-day differences). */
function localDay(tz: string, t: number): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
  const get = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

/**
 * When the deck's next card comes due, for the Flashcards page when nothing is due now
 * (polish.md P2-2): "Next card due today at 15:40", "Next card due tomorrow", "Next card due in 8 days".
 * Calendar days in the student's time zone.
 */
export function nextDueLine(dueAt: string, now: Date, tz: string): string {
  const due = Date.parse(dueAt);
  const days = Math.max(0, Math.round((localDay(tz, due) - localDay(tz, now.getTime())) / DAY));
  if (days === 0) {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(due));
    return `Next card due today at ${time}`;
  }
  return days === 1 ? "Next card due tomorrow" : `Next card due in ${days} days`;
}

/**
 * The earliest time a card in the deck comes due after today's work is done: the earliest due
 * date of a seen card, or tomorrow's start when new cards wait for tomorrow's allowance.
 * null when there is nothing to schedule (an empty deck).
 */
export function nextDueAt(cards: { state: number; dueAt: string }[], newWaiting: boolean, tomorrowStart: string): string | null {
  const seen = cards.filter((c) => c.state !== 0).map((c) => c.dueAt);
  if (newWaiting) seen.push(tomorrowStart);
  return seen.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}
