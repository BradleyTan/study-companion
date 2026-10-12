"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient(url: string, key: string) {
  return createBrowserClient(url, key);
}
