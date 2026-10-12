// Which backend the app talks to.
// - Supabase when its URL and publishable key are set (real use).
// - Demo mode otherwise, but only outside production or when DEMO_MODE=1 is set
//   explicitly. Demo data lives in server memory and resets on restart.

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

// Google sign-in needs the Google provider switched on in Supabase (with a Google OAuth client),
// so the button stays hidden until NEXT_PUBLIC_GOOGLE_SIGNIN=1 says that's done.
export function googleSignInEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "1";
}

export function isDemoMode(): boolean {
  if (supabaseConfig()) return false;
  return process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "1";
}
