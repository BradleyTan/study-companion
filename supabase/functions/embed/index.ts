// Supabase Edge Function: gte-small embeddings (384 dims, free, runs inside Supabase).
// Callable only by the app server, which sends a shared secret; every query is pinned to the
// given user id. Three uses:
//   { userId, sourceId } or { userId, noteId }: embed that file's or note's passages (missing ones)
//   { userId, subjectId }: embed a subject's passages that have none yet (Ask your notes backfill)
//   { query }: embed a question and return it (nothing is stored)
// Deploy: supabase secrets set EMBED_FUNCTION_SECRET=... && supabase functions deploy embed
import { createClient } from "jsr:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
const session = new (globalThis as any).Supabase.ai.Session("gte-small");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_QUERY = 2000;

Deno.serve(async (req) => {
  const secret = Deno.env.get("EMBED_FUNCTION_SECRET");
  if (!secret || req.headers.get("x-embed-secret") !== secret) return new Response("Forbidden", { status: 403 });
  const { userId, sourceId, noteId, subjectId, query } = await req.json().catch(() => ({}));

  if (typeof query === "string") {
    const text = query.trim().slice(0, MAX_QUERY);
    if (!text) return new Response("Bad request", { status: 400 });
    const embedding = await session.run(text, { mean_pool: true, normalize: true });
    return Response.json({ embedding: Array.from(embedding as ArrayLike<number>) });
  }

  const target = sourceId ?? noteId ?? subjectId;
  if (!UUID.test(userId ?? "") || !UUID.test(target ?? "")) return new Response("Bad request", { status: 400 });
  const column = sourceId ? "source_id" : noteId ? "note_id" : "subject_id";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await db
    .from("chunks")
    .select("id, text")
    .eq("user_id", userId)
    .eq(column, target)
    .is("embedding", null)
    .limit(subjectId ? 200 : 500);
  if (error) return new Response(error.message, { status: 400 });

  let done = 0;
  for (const row of rows ?? []) {
    const embedding = await session.run(row.text, { mean_pool: true, normalize: true });
    const { error: upErr } = await db.from("chunks").update({ embedding: JSON.stringify(embedding) }).eq("id", row.id).eq("user_id", userId);
    if (!upErr) done++;
  }
  return Response.json({ embedded: done });
});
