import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Private access to the LIVE (billable) model. The public site never reaches it: without the admin token every request is served by the
 * offline planner, which is labelled as such. The token is a server env secret (AGENT_LIVE_ADMIN_TOKEN, ≥ 24 chars); the browser only ever holds a
 * derived HttpOnly cookie (sha256 of the token), never the token itself after login.
 */
export const ADMIN_HEADER = "x-hamghadam-admin";
export const ADMIN_COOKIE = "hg_admin";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export function adminToken(env: Record<string, string | undefined> = process.env): string | null {
  const t = env.AGENT_LIVE_ADMIN_TOKEN ?? "";
  return t.length >= 24 ? t : null;
}
export const adminCookieValue = (token: string) => digest(token).toString("hex");

function cookieOf(h: { get(n: string): string | null }, name: string): string | null {
  for (const part of (h.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** true only when a token is configured AND the request carries it (header) or its derived cookie. No token configured ⇒ nobody is admin. */
export function isAdmin(h: { get(n: string): string | null }, env: Record<string, string | undefined> = process.env): boolean {
  const token = adminToken(env);
  if (!token) return false;
  const hdr = h.get(ADMIN_HEADER);
  if (hdr && safeEqual(digest(hdr), digest(token))) return true;
  const c = cookieOf(h, ADMIN_COOKIE);
  return !!c && safeEqual(Buffer.from(c, "utf8"), Buffer.from(adminCookieValue(token), "utf8"));
}
