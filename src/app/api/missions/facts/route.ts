import { z } from "zod";
import { json, parseQuery, withDb } from "@/server/api";
import { loadMissionFacts } from "@/server/missions/facts";

export const dynamic = "force-dynamic";
const nullish = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const Query = z.object({
  product: z.string().regex(/^product_[0-9a-f]{8,40}$/), shop: nullish(60), offer: nullish(60), variant: nullish(120),
  visit: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional().transform((v) => v ?? null),
});

/** GET /api/missions/facts — READ-ONLY. A mission lives in the browser; this only re-derives dataset facts for the ids it names. */
export function GET(req: Request) {
  const p = parseQuery(Query, req.url);
  if (!p.ok) return p.response;
  return withDb((db) => json(loadMissionFacts(db, p.data)));
}
