import dns from "node:dns/promises";
import net from "node:net";

/**
 * The ONLY way the agent layer may reach the network. SSRF-hardened:
 *  - https only, no credentials, port 443 only, exact host allowlist (decided by CODE/config, never by the model or by page content)
 *  - every resolved address is checked against private/loopback/link-local/reserved ranges
 *  - redirects are followed manually (≤ 2) and each hop is re-validated against the SAME allowlist
 *  - response size, time and content-type are bounded
 * Known limit (documented): DNS is resolved by us and again by the HTTP client, so a hostile allowlisted DNS server could still
 * rebind between the two; allowlisted hosts are therefore limited to a reviewed registry of manufacturer/publisher domains.
 */
export type SafeFetchCode = "BAD_URL" | "NOT_HTTPS" | "HOST_NOT_ALLOWED" | "BAD_PORT" | "PRIVATE_ADDRESS" | "REDIRECT_BLOCKED" | "TOO_LARGE" | "TIMEOUT" | "BAD_CONTENT_TYPE" | "HTTP_ERROR" | "NETWORK";
export class SafeFetchError extends Error {
  constructor(public readonly code: SafeFetchCode, message: string) { super(message); this.name = "SafeFetchError"; }
}

export interface SafeFetchOptions {
  allowedHosts: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  resolver?: (host: string) => Promise<string[]>;
}
export interface SafeFetchResult { url: string; status: number; contentType: string; text: string; bytes: number }

export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("2001:db8") || x.startsWith("64:ff9b");
  }
  return true; // not an IP at all → treat as unsafe
}

const defaultResolver = async (host: string) => (await dns.lookup(host, { all: true })).map((r) => r.address);
const TYPES = /^(text\/html|application\/xhtml\+xml|application\/json|text\/plain)\b/i;

export function validateTarget(raw: string, allowedHosts: readonly string[]): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SafeFetchError("BAD_URL", "invalid URL"); }
  if (u.protocol !== "https:") throw new SafeFetchError("NOT_HTTPS", "only https is allowed");
  if (u.username || u.password) throw new SafeFetchError("BAD_URL", "credentials in URL");
  if (u.port && u.port !== "443") throw new SafeFetchError("BAD_PORT", "only port 443");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (net.isIP(host) || host === "localhost" || !host.includes(".")) throw new SafeFetchError("HOST_NOT_ALLOWED", "IP literals and bare hosts are never allowed");
  if (!allowedHosts.some((h) => h.toLowerCase() === host)) throw new SafeFetchError("HOST_NOT_ALLOWED", `host ${host} is not allowlisted`);
  return u;
}

export async function safeFetchText(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const f = opts.fetchImpl ?? fetch;
  const resolve = opts.resolver ?? defaultResolver;
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const maxRedirects = opts.maxRedirects ?? 2;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 8_000);
  try {
    let current = validateTarget(rawUrl, opts.allowedHosts);
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let addrs: string[];
      try { addrs = await resolve(current.hostname); } catch { throw new SafeFetchError("NETWORK", "DNS resolution failed"); }
      if (!addrs.length || addrs.some(isPrivateAddress)) throw new SafeFetchError("PRIVATE_ADDRESS", "host resolves to a non-public address");
      let res: Response;
      try {
        res = await f(current.toString(), { redirect: "manual", signal: ac.signal, headers: { "User-Agent": "HamghadamBot/0.1 (hackathon prototype; read-only)", Accept: "text/html,application/json;q=0.9,text/plain;q=0.5" } });
      } catch (e) {
        if (ac.signal.aborted) throw new SafeFetchError("TIMEOUT", "timeout");
        throw new SafeFetchError("NETWORK", e instanceof Error ? e.name : "network error");
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || hop === maxRedirects) throw new SafeFetchError("REDIRECT_BLOCKED", "too many or empty redirects");
        try { current = validateTarget(new URL(loc, current).toString(), opts.allowedHosts); } catch { throw new SafeFetchError("REDIRECT_BLOCKED", "redirect target is not allowlisted"); }
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new SafeFetchError("HTTP_ERROR", `status ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (!TYPES.test(ct)) throw new SafeFetchError("BAD_CONTENT_TYPE", ct.slice(0, 40) || "none");
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) throw new SafeFetchError("TOO_LARGE", "declared size too large");
      const reader = res.body?.getReader();
      if (!reader) throw new SafeFetchError("NETWORK", "no body");
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        let r: ReadableStreamReadResult<Uint8Array>;
        try { r = await reader.read(); } catch { throw new SafeFetchError(ac.signal.aborted ? "TIMEOUT" : "NETWORK", "read failed"); }
        if (r.done) break;
        total += r.value.byteLength;
        if (total > maxBytes) { await reader.cancel().catch(() => undefined); throw new SafeFetchError("TOO_LARGE", "body too large"); }
        chunks.push(r.value);
      }
      return { url: current.toString(), status: res.status, contentType: ct, text: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)), bytes: total };
    }
    throw new SafeFetchError("REDIRECT_BLOCKED", "redirect loop");
  } finally {
    clearTimeout(timer);
  }
}

/** Visible text of an HTML page, with scripts/styles/templates/iframes/comments removed (untrusted markup never reaches the model). */
export function htmlToText(html: string, max = 200_000): string {
  const t = html.slice(0, max * 2)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|iframe|object|embed|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article)\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
  return t.slice(0, max).trim();
}
