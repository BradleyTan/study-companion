import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/subjects", "/settings", "/review", "/timer"];
const DEMO_COOKIE = "studynest_demo_uid";

// Refreshes the Supabase session cookie on every request and sends signed-out
// visitors on protected pages to /login. Pages still check the user themselves;
// this is a fast first gate, not the only one.
export async function proxy(request: NextRequest) {
  // If Supabase falls back to the Site URL (redirect URL not on its allow-list), the sign-in
  // link lands on "/?code=...". Hand that one-time code to the callback so sign-in still finishes.
  const code = request.nextUrl.searchParams.get("code");
  if (code && request.nextUrl.pathname !== "/auth/callback") {
    const to = request.nextUrl.clone();
    to.pathname = "/auth/callback";
    to.search = "";
    to.searchParams.set("code", code);
    to.searchParams.set("next", "/subjects");
    return NextResponse.redirect(to);
  }

  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let signedIn = false;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(toSet, headers) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  } else {
    signedIn = Boolean(request.cookies.get(DEMO_COOKIE)?.value);
  }

  const path = request.nextUrl.pathname;
  if (!signedIn && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    return NextResponse.redirect(to);
  }
  if (signedIn && path === "/login") {
    const to = request.nextUrl.clone();
    to.pathname = "/subjects";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
};
