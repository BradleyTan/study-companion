// Day separators in the chat (chat.md "Day separators"): "Today", a weekday within the last
// week ("Tuesday"), otherwise the date ("12 Oct", with the year when it isn't this year).

/** YYYY-MM-DD of an instant in a time zone. */
export function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function dayLabel(iso: string, tz: string, now = new Date()): string {
  const key = dayKey(iso, tz);
  const today = dayKey(now.toISOString(), tz);
  if (key === today) return "Today";
  const days = Math.round((Date.parse(today) - Date.parse(key)) / 86_400_000);
  const d = new Date(iso);
  if (days > 0 && days < 7) return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(d);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
}
