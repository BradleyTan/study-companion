// Supabase Edge Function: adds gte-small embeddings (384 dims, free, runs inside Supabase)
// to one student's passages. Callable only by the app server, which sends a shared secret;
// every query is pinned to the given user id.
// Deploy: supabase secrets set EMBED_FUNCTION_SECRET=... && supabase functions deploy embed
import { createClient } from "jsr:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
const session = new (globalThis as any).Supabase.ai.Session("gte-small");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (req) => {
  const secret = Deno.env.get("EMBED_FUNCTION_SECRET");
  if (!secret || req.headers.get("x-embed-secret") !== secret) return new Response("Forbidden", { status: 403 });
  const { userId, sourceId, noteId } = await req.json().catch(() => ({}));
  const target = sourceId ?? noteId;
  if (!UUID.test(userId ?? "") || !UUID.test(target ?? "")) return new Response("Bad request", { status: 400 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await db
    .from("chunks")
    .select("id, text")
    .eq("user_id", userId)
    .eq(sourceId ? "source_id" : "note_id", target)
    .is("embedding", null)
    .limit(500);
  if (error) return new Response(error.message, { status: 400 });

  let done = 0;
  for (const row of rows ?? []) {
    const embedding = await session.run(row.text, { mean_pool: true, normalize: true });
    const { error: upErr } = await db.from("chunks").update({ embedding: JSON.stringify(embedding) }).eq("id", row.id).eq("user_id", userId);
    if (!upErr) done++;
  }
  return Response.json({ embedded: done });
});
