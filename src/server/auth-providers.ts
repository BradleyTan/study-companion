import { z } from "zod";
import { supabaseConfig } from "@/lib/env";

// Supabase's public /auth/v1/settings lists which sign-in providers are switched on.
const settingsSchema = z.object({ external: z.object({ google: z.boolean().optional() }).partial() });

export function googleEnabledIn(settings: unknown): boolean {
  const parsed = settingsSchema.safeParse(settings);
  return parsed.success && parsed.data.external.google === true;
}

// Show "Continue with Google" only when the Google provider is actually on in Supabase,
// so the button never leads to Supabase's raw "provider is not enabled" error.
export async function googleSignInEnabled(): Promise<boolean> {
  const cfg = supabaseConfig();
  if (!cfg) return false;
  try {
    const res = await fetch(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.key }, next: { revalidate: 60 } });
    return res.ok && googleEnabledIn(await res.json());
  } catch {
    return false;
  }
}
