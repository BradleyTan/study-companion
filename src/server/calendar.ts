import "server-only";
import { isDemoMode, supabaseConfig } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { buildFeed } from "@/lib/timetable/feed";
import { TOKEN_RE, tokenHash } from "@/lib/timetable/token";
import { demoCalendarFeed } from "./repo/demo";
import { supabaseCalendarFeed } from "./repo/supabase";

/**
 * The calendar file for a feed token, or null when no link has that token (never made, reset or
 * turned off). There is no signed-in student here: the token is the only key, so this is the one
 * place that reads a student's slots without their session. It reads only slots and subject
 * names and emoji (at most 300 slots), never notes or study history, and calls no AI.
 */
export async function calendarFile(token: string, now = Date.now()): Promise<string | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = tokenHash(token);
  let data;
  if (isDemoMode()) data = demoCalendarFeed(hash, now);
  else if (supabaseConfig()) data = await supabaseCalendarFeed(createSupabaseAdminClient(), hash);
  else return null;
  return data ? buildFeed(data.slots, data.subjects, now) : null;
}
