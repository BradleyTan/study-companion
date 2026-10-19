import { afterEach, describe, expect, it, vi } from "vitest";

// siteOrigin builds sign-in and calendar links. In production it must never use the Host header
// unless the app is really the in-memory demo (S4-2).
const host = { get: (k: string) => (k === "host" ? "evil.example" : null) };
vi.mock("next/headers", () => ({ headers: async () => host }));
vi.mock("server-only", () => ({}));
const { siteOrigin } = await import("./origin");

const KEYS = ["NODE_ENV", "DEMO_MODE", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "VERCEL_ENV", "VERCEL_BRANCH_URL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function env(o: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, o);
}
afterEach(() => {
  const e = process.env as Record<string, string | undefined>;
  for (const k of KEYS) if (saved[k] === undefined) delete e[k]; else e[k] = saved[k];
});

describe("siteOrigin", () => {
  it("uses the configured site URL", async () => {
    env({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://studynest.app/" });
    expect(await siteOrigin()).toBe("https://studynest.app");
  });

  it("refuses the Host header in production with Supabase configured, even with DEMO_MODE=1", async () => {
    env({ NODE_ENV: "production", DEMO_MODE: "1", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk" });
    await expect(siteOrigin()).rejects.toThrow("NEXT_PUBLIC_SITE_URL");
    env({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk" });
    await expect(siteOrigin()).rejects.toThrow("NEXT_PUBLIC_SITE_URL");
    env({ NODE_ENV: "production" });
    await expect(siteOrigin()).rejects.toThrow("NEXT_PUBLIC_SITE_URL");
  });

  it("only the real in-memory demo falls back to the Host header", async () => {
    env({ NODE_ENV: "production", DEMO_MODE: "1" });
    expect(await siteOrigin()).toBe("http://evil.example");
  });
});
