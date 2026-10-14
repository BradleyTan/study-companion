import { describe, expect, it } from "vitest";
import { googleEnabledIn } from "./auth-providers";

describe("googleEnabledIn", () => {
  it("is true only when Supabase reports Google as on", () => {
    expect(googleEnabledIn({ external: { google: true, email: true } })).toBe(true);
    expect(googleEnabledIn({ external: { google: false, email: true } })).toBe(false);
    expect(googleEnabledIn({ external: { email: true } })).toBe(false);
  });
  it("is false for anything unexpected", () => {
    expect(googleEnabledIn(null)).toBe(false);
    expect(googleEnabledIn({ msg: "Invalid API key" })).toBe(false);
    expect(googleEnabledIn({ external: { google: "yes" } })).toBe(false);
  });
});
