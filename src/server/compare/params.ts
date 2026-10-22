import { z } from "zod";
import type { RankingPriority } from "@/domain/comparison";
import type { CompareInput } from "./service";
import type { ResolvedOrigin } from "@/server/sellers/origins";

const nullishStr = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const flag = z.preprocess((v) => v === "1" || v === "true" || v === true, z.boolean());
const optMoney = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(1).max(1_000_000_000_000).optional());

/** Shared by GET (query) and POST (JSON). Shops are a comma list (GET) or an array (POST). */
export const CompareInputSchema = z.object({
  product: z.string().regex(/^product_[0-9a-f]{8,40}$/),
  variant: nullishStr(120),
  shops: z.preprocess((v) => (Array.isArray(v) ? v.join(",") : v), z.string().max(400).regex(/^(shop_[0-9a-f]{8,40})?(,shop_[0-9a-f]{8,40}){0,9}$/, "shops must be shop ids").optional().default("")),
  o: nullishStr(20),
  ll: nullishStr(40),
  r: z.coerce.number().int().min(100).max(50_000).default(1000),
  visit: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullish().transform((v) => v ?? null),
  bmin: optMoney,
  bmax: optMoney,
  strict: flag.default(false),
  prio: z.enum(["price", "distance", "hours", "payment", "warranty"]).default("price"),
});
export type CompareInputParsed = z.infer<typeof CompareInputSchema>;

export function toCompareInput(p: CompareInputParsed, origin: ResolvedOrigin | null): CompareInput {
  return {
    productId: p.product, variantGroupId: p.variant, shopIds: p.shops ? p.shops.split(",").filter(Boolean) : [], origin: origin ? { lat: origin.lat, lon: origin.lon, source: origin.source, label: origin.label } : null,
    radiusMeters: p.r, visit: p.visit, budget: { min: p.bmin ?? null, max: p.bmax ?? null }, strictBudget: p.strict, priority: p.prio as RankingPriority,
  };
}
