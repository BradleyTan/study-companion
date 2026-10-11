import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Magic-link and Google sign-in land here with a one-time code.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/subjects";
  // Only allow redirects that stay on this site (blocks //evil.com, /%09/evil.com and friends).
  let safeNext = "/subjects";
  try {
    const target = new URL(next, origin);
    if (target.origin === origin) safeNext = target.pathname + target.search;
  } catch {}
  if (code) {
    const db = await createSupabaseServerClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
