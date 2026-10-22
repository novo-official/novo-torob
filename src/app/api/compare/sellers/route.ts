import { NextResponse } from "next/server";
import { z } from "zod";
import { json, parseQuery, readGuardedJson, withDb } from "@/server/api";
import { CompareInputSchema, toCompareInput } from "@/server/compare/params";
import { compareSellersForProduct } from "@/server/compare/service";
import { resolveOrigin } from "@/server/sellers/origins";
import { parseLl } from "@/server/sellers/params";

export const dynamic = "force-dynamic";

/**
 * GET /api/compare/sellers?product=…&variant=…&shops=a,b[,c,d]&o=ferdowsi&r=1000&visit=2026-10-24T17:30&bmax=…&strict=1&prio=price|distance|hours|payment|warranty
 * Seller comparison (Phase 5). Coordinates are snapped to ~100 m; precise GPS must use POST.
 */
export function GET(req: Request) {
  const p = parseQuery(CompareInputSchema, req.url);
  if (!p.ok) return p.response;
  return withDb((db) => {
    const origin = p.data.o || p.data.ll ? resolveOrigin(db, { preset: p.data.o, point: p.data.o === "gps" ? null : parseLl(p.data.ll) }) : null;
    const r = compareSellersForProduct(db, toCompareInput(p.data, origin));
    return r ? json(r) : json({ error: "NOT_FOUND" }, 404);
  });
}

const Gps = z.object({ gps: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }) }).passthrough();

/** POST { gps:{lat,lon}, product, shops:[…], … } — keeps precise coordinates out of URLs and logs. */
export async function POST(req: Request) {
  const g = await readGuardedJson(req);
  if (!g.ok) return g.response;
  const body = g.body;
  const gps = Gps.safeParse(body);
  const rest = CompareInputSchema.safeParse(body);
  if (!gps.success || !rest.success) {
    const issues = [...(gps.success ? [] : gps.error.issues), ...(rest.success ? [] : rest.error.issues)].map((i) => ({ path: i.path.join("."), message: i.message }));
    return NextResponse.json({ error: "INVALID_INPUT", issues }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return withDb((db) => {
    const origin = resolveOrigin(db, { point: gps.data.gps, gps: true });
    const r = compareSellersForProduct(db, toCompareInput(rest.data, origin));
    return r ? json(r) : json({ error: "NOT_FOUND" }, 404);
  });
}
