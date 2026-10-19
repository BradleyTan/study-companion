import "server-only";
import { headers } from "next/headers";

/**
 * The site's public origin for links we hand out (sign-in links, the calendar link). Never built
 * from a request header in production.
 */
export async function siteOrigin(): Promise<string> {
  // Vercel preview deploys sign in on their own branch URL (set by Vercel, not by the request),
  // so a test sign-in stays on the preview instead of landing on the live site.
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "1") throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
