import { describe, expect, it } from "vitest";
import nextConfig, { securityHeaders } from "../../next.config";

describe("security headers (polish-review.md S5-4)", () => {
  it("sends a baseline CSP and the existing headers on every path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/(.*)", headers: securityHeaders }]);
    const csp = securityHeaders.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // form-action would block the server-action redirect to Google sign-in in Chrome.
    expect(csp).not.toContain("form-action");
    expect(securityHeaders.map((h) => h.key)).toEqual(expect.arrayContaining(["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Strict-Transport-Security"]));
  });
});
