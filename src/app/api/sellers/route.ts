import { NextResponse } from "next/server";
import { z } from "zod";
import { json, parseQuery, readGuardedJson, withDb } from "@/server/api";
import { findSellersForProduct } from "@/server/sellers/find";
import { resolveOrigin } from "@/server/sellers/origins";
import { parseLl, SellersInputSchema, toFindInput } from "@/server/sellers/params";

export const dynamic = "force-dynamic";

/**
 * GET /api/sellers?product=…&variant=…&o=ferdowsi|sheikh-hadi|baharestan|map&ll=lat,lon&r=1000…
 * Coordinates are snapped to a ~100 m grid on the server. Precise GPS must use POST (never the URL).
 */
export function GET(req: Request) {
  const p = parseQuery(SellersInputSchema, req.url);
  if (!p.ok) return p.response;
  return withDb((db) => {
    const origin = resolveOrigin(db, { preset: p.data.o, point: p.data.o === "gps" ? null : parseLl(p.data.ll) });
    const r = findSellersForProduct(db, toFindInput(p.data, origin));
    return r ? json(r) : json({ error: "NOT_FOUND" }, 404);
  });
}

const PostBody = z.object({
  gps: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
}).passthrough();

/** POST /api/sellers { gps:{lat,lon}, product, variant, r, … } — keeps precise coordinates out of URLs and server logs. */
export async function POST(req: Request) {
  const g = await readGuardedJson(req);
  if (!g.ok) return g.response;
  const body = g.body;
  const gps = PostBody.safeParse(body);
  const rest = SellersInputSchema.safeParse(body);
  if (!gps.success || !rest.success) {
    const issues = [...(gps.success ? [] : gps.error.issues), ...(rest.success ? [] : rest.error.issues)].map((i) => ({ path: i.path.join("."), message: i.message }));
    return NextResponse.json({ error: "INVALID_INPUT", issues }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return withDb((db) => {
    const origin = resolveOrigin(db, { point: gps.data.gps, gps: true });
    const r = findSellersForProduct(db, toFindInput(rest.data, origin));
    return r ? json(r) : json({ error: "NOT_FOUND" }, 404);
  });
}
