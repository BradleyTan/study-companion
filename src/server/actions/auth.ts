"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { googleSignInEnabled, isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEMO_COOKIE } from "../session";
import type { ActionResult } from "./result";

async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  // Never build sign-in links from a request header in production.
  if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

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
  if (!googleSignInEnabled()) redirect("/login");
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
