import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";

/**
 * 1. Next.js answers 500 when a dynamic path segment contains malformed percent-escapes (e.g. /products/%E0%A4%A): turn that into the normal 404 page.
 * 2. Phase 9.1: a fresh CSP nonce per request (see src/lib/csp.ts). Next reads the nonce from the request's CSP header and stamps its own inline scripts.
 */
export function proxy(req: NextRequest) {
  try {
    decodeURIComponent(req.nextUrl.pathname);
  } catch {
    return NextResponse.rewrite(new URL("/not-found-malformed-path", req.url));
  }
  const csp = buildCsp(newNonce(), process.env.NODE_ENV === "development", process.env.CSP_STRICT_STYLES === "1");
  const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

// everything except build assets: pages AND api responses carry the policy
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
