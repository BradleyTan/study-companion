"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { googleSignInEnabled } from "@/server/auth-providers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { siteOrigin } from "../origin";
import { DEMO_COOKIE } from "../session";
import type { ActionResult } from "./result";

const email = z.email("That doesn't look like an email address.").max(254);

export async function sendMagicLink(raw: string): Promise<ActionResult> {
  const parsed = email.safeParse(raw.trim());
  if (!parsed.success) return { ok: false, error: "That doesn't look like an email address." };
  const db = await createSupabaseServerClient();
  const { error } = await db.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback?next=/subjects` },
  });
  // Supabase rate-limits sign-in emails; don't reveal whether the account exists.
  if (error) return { ok: false, error: "We couldn't send the link. Try again in a minute." };
  return { ok: true };
}

export async function signInWithGoogle(): Promise<void> {
  if (!(await googleSignInEnabled())) redirect("/login");
  const db = await createSupabaseServerClient();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteOrigin()}/auth/callback?next=/subjects` },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function startDemo(): Promise<void> {
  if (!isDemoMode()) redirect("/login");
  (await cookies()).set(DEMO_COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/subjects");
}

export async function signOut(): Promise<void> {
  if (isDemoMode()) (await cookies()).delete(DEMO_COOKIE);
  else await (await createSupabaseServerClient()).auth.signOut();
  redirect("/");
}
