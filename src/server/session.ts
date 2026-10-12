import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isDemoMode, supabaseConfig } from "@/lib/env";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { demoRepo } from "./repo/demo";
import { supabaseRepo } from "./repo/supabase";
import type { Repo } from "./repo/types";

export const DEMO_COOKIE = "studynest_demo_uid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type CurrentUser = { id: string; email: string | null; demo: boolean; lastSignInAt: string | null };

/** The signed-in student, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (isDemoMode()) {
    const id = (await cookies()).get(DEMO_COOKIE)?.value;
    return id && UUID.test(id) ? { id, email: null, demo: true, lastSignInAt: null } : null;
  }
  if (!supabaseConfig()) return null; // production build with nothing configured
  const db = await createSupabaseServerClient();
  // getUser() asks Supabase Auth to validate the token, so a forged cookie is rejected.
  const { data } = await db.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null, demo: false, lastSignInAt: data.user.last_sign_in_at ?? null } : null;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Data access for the current student. Redirects to sign-in when signed out. */
export async function getRepo(): Promise<Repo> {
  const user = await requireUser();
  if (user.demo) return demoRepo(user.id);
  return supabaseRepo(await createSupabaseServerClient(), user.id, createSupabaseAdminClient);
}
