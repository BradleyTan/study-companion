import type { NextConfig } from "next";

export const securityHeaders = [
  // Baseline CSP without script-src (that needs per-request nonces for Next's inline scripts; see
  // docs/security/polish-review.md S5-4): no <base> hijack, no plugins, no framing.
  { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Cache Components is off: almost every page here is per-student and dynamic.
  // See docs/PLAN.md, "Decisions".
  experimental: {
    // Demo-mode uploads only; real uploads go straight from the browser to Storage.
    serverActions: { bodySizeLimit: "26mb" },
    proxyClientMaxBodySize: "26mb",
  },
  serverExternalPackages: ["unpdf"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
