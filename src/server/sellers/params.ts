import { z } from "zod";
import type { FindSellersInput } from "@/server/sellers/find";

const flag = z.preprocess((v) => v === "1" || v === "true" || v === true, z.boolean());
const optStr = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

/** Shared by GET (query string) and POST (JSON body). Coordinates are validated and snapped later by `resolveOrigin`. */
export const SellersInputSchema = z.object({
  product: z.string().regex(/^product_[0-9a-f]{8,40}$/),
  variant: optStr(120),
  o: optStr(20),
  ll: optStr(40),
  r: z.coerce.number().int().min(100).max(50_000).default(1000),
  uncertain: flag.default(false),
  sort: z.enum(["distance", "price", "recent"]).default("distance"),
  open: flag.default(false),
  reliable: flag.default(false),
  pay: optStr(30),
  page: z.coerce.number().int().min(1).max(50).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  outside: flag.default(false),
});
export type SellersInputParsed = z.infer<typeof SellersInputSchema>;

export function parseLl(v: string | null): { lat: number; lon: number } | null {
  if (!v) return null;
  const [a, b, ...rest] = v.split(",");
  if (rest.length || a === undefined || b === undefined) return null;
  const lat = Number(a);
  const lon = Number(b);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export function toFindInput(p: SellersInputParsed, origin: FindSellersInput["origin"]): FindSellersInput {
  return {
    productId: p.product, variantGroupId: p.variant, origin, radiusMeters: p.r, showUncertain: p.uncertain, sort: p.sort,
    openNow: p.open, reliablePriceOnly: p.reliable, paymentProvider: p.pay, page: p.page, pageSize: p.pageSize, includeOutside: p.outside,
  };
}
