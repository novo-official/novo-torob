/**
 * Abuse guards for the agent endpoints. All state is in-process and BOUNDED (LRU-capped map, fixed-size windows) so it cannot grow
 * without limit, and keyed by a coarse client id — never by message content. No user data is stored here.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly perMinute: number, private readonly maxKeys = 2000, private readonly now: () => number = Date.now) {}
  /** returns 0 when allowed, otherwise the seconds to wait */
  check(key: string): number {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < 60_000);
    if (arr.length >= this.perMinute) { this.hits.set(key, arr); return Math.max(1, Math.ceil((60_000 - (t - arr[0]!)) / 1000)); }
    arr.push(t);
    this.hits.delete(key); // refresh LRU position
    this.hits.set(key, arr);
    if (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
    return 0;
  }
  get size() { return this.hits.size; }
}

export class Semaphore {
  private active = 0;
  constructor(private readonly max: number) {}
  tryAcquire(): boolean { if (this.active >= this.max) return false; this.active++; return true; }
  release(): void { this.active = Math.max(0, this.active - 1); }
  get inFlight() { return this.active; }
}

/** Number of trusted reverse proxies in front of the app (TRUST_PROXY_HOPS, default 1, clamped 1..5). Only used when TRUST_PROXY_HEADERS=1. */
export function proxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.TRUST_PROXY_HOPS ?? "1", 10);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 1;
}

/**
 * Coarse client key (a bucket label only, never logged with content). X-Forwarded-For is attacker-controlled unless a trusted reverse proxy
 * OVERWRITES it, so it is honoured ONLY when TRUST_PROXY_HEADERS=1 (set it only behind such a proxy). Otherwise every client shares one bucket:
 * rotating the header cannot dodge the limit. Limits are per process — see docs/deployment-packet.md (single instance until a shared limiter exists).
 */
export function clientKey(h: { get(n: string): string | null }, trustProxy: boolean = process.env.TRUST_PROXY_HEADERS === "1", hops: number = proxyHops()): string {
  if (!trustProxy) return "shared";
  // A proxy that APPENDS to X-Forwarded-For leaves any client-sent entries on the LEFT, so the first entry is spoofable. The entry added by the
  // nearest trusted proxy is the `hops`-th from the RIGHT (default 1). With a proxy that overwrites the header there is one entry and both readings agree.
  const parts = h.get("x-forwarded-for")?.split(",").map((x) => x.trim()) ?? [];
  const f = parts.length >= hops ? parts[parts.length - hops] : undefined;
  const ip = f && /^[0-9a-fA-F:.]{3,45}$/.test(f) ? f : "local";
  return ip.slice(0, 45);
}

/** Same-origin check for state-changing endpoints (they use no cookies, but we still refuse cross-site browser requests). */
export function isCrossSite(h: { get(n: string): string | null }, reqUrl: string): boolean {
  const site = h.get("sec-fetch-site");
  if (site === "cross-site") return true;
  const origin = h.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host !== new URL(reqUrl).host && new URL(origin).host !== h.get("host"); } catch { return true; }
}
