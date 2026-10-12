import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Ask the `embed` Edge Function (supabase/functions/embed) to add embeddings to a
 * source's passages. Best effort: if the function isn't deployed yet, the file is
 * still usable and embeddings can be backfilled later (they're needed from Step 3).
 */
export async function embedSource(userId: string, sourceId: string): Promise<void> {
  const secret = process.env.EMBED_FUNCTION_SECRET;
  if (!secret) return; // not set up yet
  try {
    // Only the server can call the function (shared secret), so students can't run it in a loop.
    const { error } = await createSupabaseAdminClient().functions.invoke("embed", {
      body: { userId, sourceId },
      headers: { "x-embed-secret": secret },
    });
    if (error) console.warn("embed: skipped", error.message);
  } catch (e) {
    console.warn("embed: skipped", e instanceof Error ? e.message : e);
  }
}
