// Time zone names found in university calendar files (timetable.md "Import"): IANA names, Windows
// names (Outlook and Exchange exports), Outlook display names "(UTC+00:00) Dublin, Edinburgh,
// Lisbon, London" and prefixed names "/mozilla.org/20050126_1/Europe/London".
import { isValidTimeZone } from "./dates";

/** Windows zone ids (and their "standard name" spellings) → IANA, from CLDR windowsZones (territory 001). */
const WINDOWS: Record<string, string> = {
  "dateline standard time": "Etc/GMT+12",
  "utc-11": "Etc/GMT+11",
  "hawaiian standard time": "Pacific/Honolulu",
  "alaskan standard time": "America/Anchorage",
  "pacific standard time": "America/Los_Angeles",
  "pacific standard time (mexico)": "America/Tijuana",
  "us mountain standard time": "America/Phoenix",
  "mountain standard time": "America/Denver",
  "central america standard time": "America/Guatemala",
  "central standard time": "America/Chicago",
  "central standard time (mexico)": "America/Mexico_City",
  "mexico standard time": "America/Mexico_City",
  "canada central standard time": "America/Regina",
  "sa pacific standard time": "America/Bogota",
  "eastern standard time": "America/New_York",
  "us eastern standard time": "America/Indiana/Indianapolis",
  "venezuela standard time": "America/Caracas",
  "atlantic standard time": "America/Halifax",
  "sa western standard time": "America/La_Paz",
  "pacific sa standard time": "America/Santiago",
  "newfoundland standard time": "America/St_Johns",
  "e. south america standard time": "America/Sao_Paulo",
  "argentina standard time": "America/Argentina/Buenos_Aires",
  "azores standard time": "Atlantic/Azores",
  "cape verde standard time": "Atlantic/Cape_Verde",
  "utc": "UTC",
  "coordinated universal time": "UTC",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "morocco standard time": "Africa/Casablanca",
  "w. europe standard time": "Europe/Berlin",
  "central europe standard time": "Europe/Budapest",
  "romance standard time": "Europe/Paris",
  "central european standard time": "Europe/Warsaw",
  "w. central africa standard time": "Africa/Lagos",
  "gtb standard time": "Europe/Bucharest",
  "e. europe standard time": "Europe/Chisinau",
  "fle standard time": "Europe/Helsinki",
  "egypt standard time": "Africa/Cairo",
  "south africa standard time": "Africa/Johannesburg",
  "israel standard time": "Asia/Jerusalem",
  "jerusalem standard time": "Asia/Jerusalem",
  "turkey standard time": "Europe/Istanbul",
  "russian standard time": "Europe/Moscow",
  "arab standard time": "Asia/Riyadh",
  "arabic standard time": "Asia/Baghdad",
  "e. africa standard time": "Africa/Nairobi",
  "iran standard time": "Asia/Tehran",
  "arabian standard time": "Asia/Dubai",
  "afghanistan standard time": "Asia/Kabul",
  "west asia standard time": "Asia/Tashkent",
  "pakistan standard time": "Asia/Karachi",
  "india standard time": "Asia/Kolkata",
  "sri lanka standard time": "Asia/Colombo",
  "nepal standard time": "Asia/Kathmandu",
  "central asia standard time": "Asia/Almaty",
  "bangladesh standard time": "Asia/Dhaka",
  "myanmar standard time": "Asia/Yangon",
  "se asia standard time": "Asia/Bangkok",
  "china standard time": "Asia/Shanghai",
  "singapore standard time": "Asia/Singapore",
  "malay peninsula standard time": "Asia/Singapore",
  "taipei standard time": "Asia/Taipei",
  "w. australia standard time": "Australia/Perth",
  "tokyo standard time": "Asia/Tokyo",
  "korea standard time": "Asia/Seoul",
  "cen. australia standard time": "Australia/Adelaide",
  "aus central standard time": "Australia/Darwin",
  "e. australia standard time": "Australia/Brisbane",
  "aus eastern standard time": "Australia/Sydney",
  "tasmania standard time": "Australia/Hobart",
  "west pacific standard time": "Pacific/Port_Moresby",
  "new zealand standard time": "Pacific/Auckland",
  "utc+12": "Etc/GMT-12",
  "fiji standard time": "Pacific/Fiji",
  "tonga standard time": "Pacific/Tongatapu",
  "samoa standard time": "Pacific/Apia",
};

/** Cities in Outlook display names ("(UTC+10:00) Canberra, Melbourne, Sydney") → IANA. */
const CITIES: [string, string][] = [
  ["london", "Europe/London"], ["dublin", "Europe/Dublin"], ["edinburgh", "Europe/London"], ["lisbon", "Europe/Lisbon"],
  ["amsterdam", "Europe/Amsterdam"], ["berlin", "Europe/Berlin"], ["rome", "Europe/Rome"], ["stockholm", "Europe/Stockholm"],
  ["vienna", "Europe/Vienna"], ["brussels", "Europe/Brussels"], ["copenhagen", "Europe/Copenhagen"], ["madrid", "Europe/Madrid"],
  ["paris", "Europe/Paris"], ["prague", "Europe/Prague"], ["warsaw", "Europe/Warsaw"], ["helsinki", "Europe/Helsinki"],
  ["athens", "Europe/Athens"], ["istanbul", "Europe/Istanbul"], ["moscow", "Europe/Moscow"],
  ["eastern time", "America/New_York"], ["central time", "America/Chicago"], ["mountain time", "America/Denver"], ["pacific time", "America/Los_Angeles"],
  ["sydney", "Australia/Sydney"], ["melbourne", "Australia/Melbourne"], ["canberra", "Australia/Sydney"], ["brisbane", "Australia/Brisbane"],
  ["adelaide", "Australia/Adelaide"], ["perth", "Australia/Perth"], ["hobart", "Australia/Hobart"], ["darwin", "Australia/Darwin"],
  ["auckland", "Pacific/Auckland"], ["wellington", "Pacific/Auckland"],
  ["kuala lumpur", "Asia/Kuala_Lumpur"], ["singapore", "Asia/Singapore"], ["hong kong", "Asia/Hong_Kong"], ["beijing", "Asia/Shanghai"],
  ["taipei", "Asia/Taipei"], ["osaka", "Asia/Tokyo"], ["tokyo", "Asia/Tokyo"], ["seoul", "Asia/Seoul"], ["bangkok", "Asia/Bangkok"],
  ["jakarta", "Asia/Jakarta"], ["manila", "Asia/Manila"], ["new delhi", "Asia/Kolkata"], ["mumbai", "Asia/Kolkata"], ["kolkata", "Asia/Kolkata"],
  ["chennai", "Asia/Kolkata"], ["karachi", "Asia/Karachi"], ["dubai", "Asia/Dubai"], ["abu dhabi", "Asia/Dubai"], ["jerusalem", "Asia/Jerusalem"],
  ["cairo", "Africa/Cairo"], ["johannesburg", "Africa/Johannesburg"], ["pretoria", "Africa/Johannesburg"], ["nairobi", "Africa/Nairobi"],
  ["lagos", "Africa/Lagos"], ["toronto", "America/Toronto"], ["vancouver", "America/Vancouver"], ["sao paulo", "America/Sao_Paulo"],
  ["brasilia", "America/Sao_Paulo"], ["buenos aires", "America/Argentina/Buenos_Aires"], ["mexico city", "America/Mexico_City"],
  ["bogota", "America/Bogota"], ["lima", "America/Lima"], ["santiago", "America/Santiago"], ["halifax", "America/Halifax"],
];

/** An IANA zone name inside a longer id ("/mozilla.org/20050126_1/Europe/London"). */
const IANA_INSIDE = /((?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)\s*$/;

/** The IANA zone a calendar file's TZID means, or null when we can't tell from the name alone. */
export function zoneFromName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim().replace(/^"|"$/g, "");
  if (!name) return null;
  if (/^(utc|gmt|z|etc\/utc|etc\/gmt)$/i.test(name)) return "UTC";
  if (name.includes("/") && isValidTimeZone(name) && !name.startsWith("/")) return name;
  const inside = IANA_INSIDE.exec(name)?.[1];
  if (inside && isValidTimeZone(inside)) return inside;
  const win = WINDOWS[name.toLowerCase()];
  if (win) return win;
  const lower = name.toLowerCase();
  if (/^\(utc[^)]*\)/.test(lower) || /^\(gmt[^)]*\)/.test(lower)) {
    for (const [city, zone] of CITIES) if (lower.includes(city)) return zone;
    if (/^\((utc|gmt)\)/.test(lower)) return "UTC";
  }
  return null;
}

/** Zones tried when a file only describes its zone by offsets (no usable name). */
export const COMMON_ZONES = [...new Set([...Object.values(WINDOWS), ...CITIES.map(([, z]) => z)])];
