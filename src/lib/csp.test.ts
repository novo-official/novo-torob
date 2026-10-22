// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "./csp";

describe("per-request CSP", () => {
  it("scripts need the nonce; no unsafe-inline/unsafe-eval for scripts in production; everything else closed", () => {
    const n = newNonce(); const csp = buildCsp(n, false);
    expect(csp).toContain(`script-src 'self' 'nonce-${n}' 'strict-dynamic'`);
    expect(csp.match(/script-src[^;]*/)![0]).not.toMatch(/unsafe-inline|unsafe-eval/);
    for (const d of ["default-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(d);
    expect(csp).toContain("img-src 'self' data: blob: https://image.torob.com https://tile.openstreetmap.org");
  });
  it("development additionally allows eval (React debugging) and nothing else changes", () => {
    expect(buildCsp("x", true)).toContain("'unsafe-eval'");
    expect(buildCsp("x", false)).not.toContain("'unsafe-eval'");
  });
  it("nonces are unpredictable and unique", () => {
    const set = new Set(Array.from({ length: 200 }, () => newNonce()));
    expect(set.size).toBe(200);
    for (const n of set) expect(n).toMatch(/^[A-Za-z0-9+/=]{40,}$/);
  });
  it("strict styles (opt-in): <style> needs the nonce and only style ATTRIBUTES stay inline; default keeps unsafe-inline", () => {
    const strict = buildCsp("abc", false, true);
    expect(strict).toContain("style-src 'self' 'nonce-abc'"); expect(strict).toContain("style-src-attr 'unsafe-inline'");
    expect(strict.match(/style-src [^;]*/)![0]).not.toContain("unsafe-inline");
    expect(buildCsp("abc", false)).toContain("style-src 'self' 'unsafe-inline'");
  });
});
