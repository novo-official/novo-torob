import { z } from "zod";
import { json, parseQuery, withDb } from "@/server/api";
import { planRecovery } from "@/server/missions/recovery";
import { DISTRICTS } from "@/domain/mission";

export const dynamic = "force-dynamic";
const nullish = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const int = (min: number, max: number) => z.string().regex(/^\d{1,13}$/).optional().transform((v) => (v === undefined ? null : Number(v))).refine((v) => v === null || (v >= min && v <= max), "range");
const Query = z.object({
  trigger: z.enum(["UNAVAILABLE", "PRICE_CHANGED", "WRONG_MODEL", "NO_REPLY", "OUTSIDE_HOURS", "PAYMENT_WARRANTY"]),
  product: z.string().regex(/^product_[0-9a-f]{8,40}$/), shop: z.string().regex(/^shop_[0-9a-f]{8,40}$/), offer: nullish(60), variant: nullish(120),
  district: z.enum(DISTRICTS).optional().transform((v) => v ?? null), radius: int(100, 50_000), bmin: int(1, 1e12), bmax: int(1, 1e12), reported: int(1, 1e12),
  visit: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional().transform((v) => v ?? null),
});

/**
 * GET /api/missions/recovery — READ-ONLY. Computes alternatives/trade-offs from dataset ids; the "reported" amount is the user's own
 * unverified number and is only echoed into a scenario. No mission data is received or stored here (missions live in the browser).
 */
export function GET(req: Request) {
  const p = parseQuery(Query, req.url);
  if (!p.ok) return p.response;
  const q = p.data;
  return withDb((db) => {
    const r = planRecovery(db, { trigger: q.trigger, productId: q.product, variantGroupId: q.variant, shopId: q.shop, offerId: q.offer, district: q.district, radius: q.radius ?? 1000, budget: { min: q.bmin, max: q.bmax }, visit: q.visit, reportedPriceToman: q.reported });
    return r.ok ? json(r.plan) : json({ error: r.error }, r.error === "INVALID_ID" || r.error === "VARIANT_UNKNOWN" ? 400 : r.error === "OFFER_REQUIRED" || r.error === "OFFER_MISMATCH" ? 409 : 404);
  });
}
