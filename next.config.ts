import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone", // minimal runtime bundle for the Docker image
  // The dataset and the database are runtime volumes: never trace/copy them into the build output.
  outputFileTracingExcludes: { "*": ["data/**", ".data/**", "tests/**", "docs/**", "e2e/**"] },
  async headers() {
    // Phase 9 hardening. The Content-Security-Policy is set PER REQUEST (with a nonce) in src/proxy.ts → src/lib/csp.ts; the static security headers live here.
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ] }];
  },
};

export default nextConfig;
