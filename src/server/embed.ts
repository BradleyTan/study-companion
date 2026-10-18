import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { supabaseConfig } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

// The `embed` Edge Function (supabase/functions/embed): gte-small embeddings inside Supabase,
// free. Only the server can call it (shared secret), so students can't run it in a loop.

/** Whether the embed function is set up at all (otherwise Ask your notes uses keyword search). */
export function embedConfigured(): boolean {
  return !!process.env.EMBED_FUNCTION_SECRET && !!supabaseConfig();
}

async function invoke(body: Record<string, string>): Promise<unknown> {
  const secret = process.env.EMBED_FUNCTION_SECRET;
  if (!secret || !supabaseConfig()) return null;
  const { data, error } = await createSupabaseAdminClient().functions.invoke("embed", { body, headers: { "x-embed-secret": secret } });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Ask the function to add embeddings to a source's passages. Best effort: if the function isn't
 * deployed yet, the file is still usable and embeddings can be backfilled later.
 */
export async function embedSource(userId: string, sourceId: string): Promise<void> {
  try {
    await invoke({ userId, sourceId });
  } catch (e) {
    console.warn("embed: skipped", e instanceof Error ? e.message : e);
  }
}

/**
 * After the response: embed a subject's passages that have no embedding yet (notes are never
 * embedded on save, and files uploaded before the function was deployed have none), so the next
 * question can use them. At most 200 per call; best effort.
 */
export function backfillSubjectEmbeddings(userId: string, subjectId: string): void {
  if (!embedConfigured()) return;
  after(async () => {
    try {
      await invoke({ userId, subjectId });
    } catch (e) {
      console.warn("embed backfill: skipped", e instanceof Error ? e.message : e);
    }
  });
}

const reply = z.object({ embedding: z.array(z.number().finite()).length(384) });
const QUERY_TIMEOUT_MS = 8000;

/** A question's gte-small embedding, or null when the function is missing, slow or failing (keyword mode). */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (!embedConfigured()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), QUERY_TIMEOUT_MS); });
    const data = await Promise.race([invoke({ query: text.slice(0, 2000) }), timeout]);
    const parsed = reply.safeParse(data);
    return parsed.success ? parsed.data.embedding : null;
  } catch (e) {
    console.warn("embed query: keyword search instead", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
