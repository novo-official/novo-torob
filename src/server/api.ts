import { NextResponse } from "next/server";
import { z } from "zod";
import { DatabaseUnavailableError, getReadDb } from "@/server/db/connect";
import type { DatabaseSync } from "node:sqlite";
import { clientKey, isCrossSite, RateLimiter } from "@/server/agent/guard";

/** Shared plumbing for route handlers: validated input, uniform errors, no stack traces, no caching of personal queries. */
const NO_STORE = { "Cache-Control": "no-store" };

export function parseQuery<T extends z.ZodTypeAny>(schema: T, url: string): { ok: true; data: z.infer<T> } | { ok: false; response: NextResponse } {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const r = schema.safeParse(params);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    response: NextResponse.json({ error: "INVALID_INPUT", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400, headers: NO_STORE }),
  };
}

export function withDb(handler: (db: DatabaseSync) => NextResponse | Promise<NextResponse>): Promise<NextResponse> | NextResponse {
  try {
    return handler(getReadDb());
  } catch (e) {
    if (e instanceof DatabaseUnavailableError) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: "INTERNAL" }, { status: 500, headers: NO_STORE });
  }
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

// ---- shared zod fragments (also reused by the UI's URL parsing) ----
export const text = (max: number) => z.string().trim().max(max);
export const intParam = (min: number, max: number, def: number) => z.coerce.number().int().min(min).max(max).default(def);
export const optInt = z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(0).max(1_000_000_000_000).optional());

// ---- unsafe-method (POST) guard shared by every JSON POST route ----
// These POSTs are READ-ONLY computations (the body carries GPS so it stays out of URLs/logs). There are no cookies or sessions, so classic CSRF has
// nothing to ride on; the guard still refuses cross-site browser requests, non-JSON bodies and oversize bodies, and bounds the compute cost per client.
const postLimiter = new RateLimiter(Number(process.env.API_POST_RATE_PER_MIN) > 0 ? Number(process.env.API_POST_RATE_PER_MIN) : 120);
const MAX_POST_BYTES = 8_000;
export async function readGuardedJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const fail = (status: number, error: string, extra: Record<string, string> = {}) => ({ ok: false as const, response: NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...extra } }) });
  if (isCrossSite(req.headers, req.url)) return fail(403, "CROSS_SITE");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail(415, "INVALID_INPUT");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_POST_BYTES) return fail(413, "INVALID_INPUT");
  const wait = postLimiter.check(clientKey(req.headers));
  if (wait > 0) return fail(429, "RATE_LIMITED", { "Retry-After": String(wait) });
  let raw: string;
  try { raw = await req.text(); } catch { return fail(400, "INVALID_INPUT"); }
  if (raw.length > MAX_POST_BYTES) return fail(413, "INVALID_INPUT");
  try { return { ok: true, body: JSON.parse(raw) }; } catch { return fail(400, "INVALID_INPUT"); }
}
