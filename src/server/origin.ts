import "server-only";
import { headers } from "next/headers";
import { isDemoMode } from "@/lib/env";

/**
 * The site's public origin for links we hand out (sign-in links, the calendar link). Never built
 * from a request header in production.
 */
export async function siteOrigin(): Promise<string> {
  // Vercel preview deploys sign in on their own branch URL (set by Vercel, not by the request),
  // so a test sign-in stays on the preview instead of landing on the live site.
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  // Only the in-memory demo may fall back to the Host header in production. DEMO_MODE=1 alone
  // isn't enough: with Supabase configured the app is real and sign-in links must not follow a
  // spoofed Host (S4-2).
  if (process.env.NODE_ENV === "production" && !isDemoMode()) throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
