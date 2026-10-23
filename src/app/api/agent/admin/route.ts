import { NextResponse } from "next/server";
import { adminCookieValue, adminToken, ADMIN_COOKIE } from "@/server/agent/admin";
import { createHash, timingSafeEqual } from "node:crypto";
import { clientKey, isCrossSite, RateLimiter } from "@/server/agent/guard";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
// a guessing budget for the whole process: 10 attempts per minute, shared
const attempts = new RateLimiter(10);

/**
 * POST /api/agent/admin { token } → sets the admin cookie (HttpOnly, SameSite=Strict) that unlocks the PRIVATE live model for this browser.
 * With no AGENT_LIVE_ADMIN_TOKEN configured this endpoint does nothing (404-shaped): the public site has no admin surface.
 */
export async function POST(req: Request) {
  const token = adminToken();
  if (!token) return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
  if (isCrossSite(req.headers, req.url)) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  if (attempts.check(clientKey(req.headers)) > 0) return NextResponse.json({ ok: false }, { status: 429, headers: NO_STORE });
  let given = "";
  try { const b = (await req.json()) as { token?: unknown }; given = typeof b.token === "string" ? b.token.slice(0, 200) : ""; } catch { /* invalid */ }
  const h = (s: string) => createHash("sha256").update(s, "utf8").digest();
  if (!timingSafeEqual(h(given), h(token))) return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(ADMIN_COOKIE, adminCookieValue(token), { httpOnly: true, sameSite: "strict", secure, path: "/api/agent", maxAge: 2 * 3600 });
  return res;
}
