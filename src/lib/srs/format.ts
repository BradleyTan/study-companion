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
