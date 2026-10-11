import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/env";

/** Client acting as the signed-in student (RLS applies). */
export async function createSupabaseServerClient() {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Supabase is not configured");
  const cookieStore = await cookies();
  return createServerClient(cfg.url, cfg.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes sessions.
        }
      },
    },
  });
}

let adminClient: SupabaseClient | null = null;

/**
 * Admin client with the secret key (bypasses RLS). Server-only. Used for rows students
 * may not write themselves (sources, chunks, upload log, AI quota), signed upload URLs,
 * the embed function and account deletion. Callers must always filter by the student's id.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const cfg = supabaseConfig();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!cfg || !secret) throw new Error("SUPABASE_SECRET_KEY is not set");
  adminClient ??= createClient(cfg.url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return adminClient;
}
