import { z } from "zod";
import { json, parseQuery, withDb } from "@/server/api";
import { resolveOrigin } from "@/server/sellers/origins";
import { findCategoryActivityShops } from "@/server/sellers/activity";
import { parseLl } from "@/server/sellers/params";

export const dynamic = "force-dynamic";
const Query = z.object({
  category: z.string().trim().min(1).max(120),
  product: z.string().regex(/^product_[0-9a-f]{8,40}$/).optional(),
  o: z.string().trim().max(20).optional(),
  ll: z.string().trim().max(40).optional(),
  r: z.coerce.number().int().min(100).max(50_000).default(1000),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** GET /api/activity — CATEGORY_ACTIVITY_ONLY: shops listing the category with NO offer for the product (exploratory, never "sellers"). */
export function GET(req: Request) {
  const p = parseQuery(Query, req.url);
  if (!p.ok) return p.response;
  return withDb((db) => {
    const origin = resolveOrigin(db, { preset: p.data.o, point: p.data.o === "gps" ? null : parseLl(p.data.ll ?? null) });
    return json(findCategoryActivityShops(db, { category: p.data.category, productId: p.data.product, origin, radiusMeters: p.data.r, limit: p.data.limit }));
  });
}
