// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clientKey, isCrossSite, proxyHops, RateLimiter, Semaphore } from "./guard";

describe("rate limiter", () => {
  it("allows N per minute, then reports a wait; recovers after the window", () => {
    let t = 0; const r = new RateLimiter(3, 100, () => t);
    expect([r.check("a"), r.check("a"), r.check("a")]).toEqual([0, 0, 0]);
    expect(r.check("a")).toBeGreaterThan(0); t = 61_000; expect(r.check("a")).toBe(0);
  });
  it("is per client and BOUNDED (LRU cap) — memory cannot grow without limit", () => {
    const r = new RateLimiter(5, 50);
    for (let i = 0; i < 5000; i++) r.check(`ip${i}`);
    expect(r.size).toBeLessThanOrEqual(50);
    expect(new RateLimiter(1).check("x")).toBe(0);
  });
});
describe("concurrency gate", () => {
  it("caps in-flight work and releases", () => {
    const s = new Semaphore(2); expect([s.tryAcquire(), s.tryAcquire(), s.tryAcquire()]).toEqual([true, true, false]); s.release(); expect(s.tryAcquire()).toBe(true); s.release(); s.release(); s.release(); expect(s.inFlight).toBe(0);
  });
});
describe("request identity and CSRF", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
  it("client key is a coarse bucket, never message content; X-Forwarded-For is IGNORED unless a trusted proxy is declared", () => {
    expect(clientKey(h({ "x-forwarded-for": "1.2.3.4" }), true)).toBe("1.2.3.4"); expect(clientKey(h({ "x-forwarded-for": "<script>" }), true)).toBe("local"); expect(clientKey(h({}), true)).toBe("local");
    // untrusted (default): rotating the header must not create new buckets
    expect(clientKey(h({ "x-forwarded-for": "1.2.3.4" }), false)).toBe("shared"); expect(clientKey(h({ "x-forwarded-for": "5.6.7.8" }), false)).toBe("shared");
  });
  it("behind a proxy that APPENDS to X-Forwarded-For the client-sent (left) entries cannot choose the bucket", () => {
    // attacker sends "X-Forwarded-For: 6.6.6.6"; the trusted proxy appends the address it saw → the rightmost entry is the real client
    expect(clientKey(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), true, 1)).toBe("203.0.113.9");
    expect(clientKey(h({ "x-forwarded-for": "7.7.7.7, 203.0.113.9" }), true, 1)).toBe("203.0.113.9"); // rotating the spoofed part changes nothing
    expect(clientKey(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" }), true, 2)).toBe("203.0.113.9"); // two trusted hops
    expect(clientKey(h({ "x-forwarded-for": "10.0.0.2" }), true, 2)).toBe("local"); // fewer entries than hops → never fall back to a spoofable value
    expect(proxyHops({})).toBe(1); expect(proxyHops({ TRUST_PROXY_HOPS: "2" })).toBe(2); expect(proxyHops({ TRUST_PROXY_HOPS: "99" })).toBe(5); expect(proxyHops({ TRUST_PROXY_HOPS: "abc" })).toBe(1); expect(proxyHops({ TRUST_PROXY_HOPS: "0" })).toBe(1);
  });
  it("refuses cross-site browser requests, allows same-origin and header-less clients", () => {
    expect(isCrossSite(h({ "sec-fetch-site": "cross-site" }), "http://a.test/x")).toBe(true);
    expect(isCrossSite(h({ origin: "https://evil.example", host: "a.test" }), "http://a.test/x")).toBe(true);
    expect(isCrossSite(h({ origin: "http://a.test", host: "a.test" }), "http://a.test/x")).toBe(false);
    expect(isCrossSite(h({}), "http://a.test/x")).toBe(false);
    expect(isCrossSite(h({ origin: "not a url" }), "http://a.test/x")).toBe(true);
  });
});
