import type { DatabaseSync } from "node:sqlite";
import type { ActivityShop, CategoryActivityResponse } from "@/domain/sellers";
import { haversineMeters, isValidCoordinate } from "@/lib/geo";
import { getDensityIndex } from "@/server/areas/density";

/**
 * CATEGORY_ACTIVITY_ONLY: shops whose `category_names` list the product's category but that have NO offer for the
 * selected product (any variant). They are an exploratory lead — NEVER counted as sellers of the exact product.
 */
export function findCategoryActivityShops(
  db: DatabaseSync,
  args: { category: string; productId?: string | null; origin?: { lat: number; lon: number } | null; radiusMeters?: number; limit?: number },
): CategoryActivityResponse {
  const idx = getDensityIndex(db);
  const withOffer = new Set<string>();
  if (args.productId) for (const r of db.prepare("SELECT DISTINCT shop_id AS s FROM offers WHERE product_id = ?").all(args.productId) as Array<{ s: string }>) withOffer.add(r.s);
  const o = args.origin && isValidCoordinate(args.origin.lat, args.origin.lon) ? args.origin : null;
  const radius = args.radiusMeters ?? 1000;
  const listing = (idx.listingByCategory.get(args.category) ?? []).filter((s) => !withOffer.has(s.id));
  const items: ActivityShop[] = listing.map((s) => ({
    shopId: s.id, name: "", locationLabel: s.label, lat: s.lat, lon: s.lon,
    distanceMeters: o ? haversineMeters(o.lat, o.lon, s.lat, s.lon) : null,
    evidenceFa: `در shops.csv دسته‌ی «${args.category}» جزو فعالیت‌های اعلام‌شده‌ی این فروشگاه است؛ برای این محصول پیشنهادی ثبت نشده.`,
    hasMatchingOffer: false,
  }));
  items.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.shopId.localeCompare(b.shopId));
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
  const shown = items.slice(0, limit);
  const names = new Map<string, string>();
  if (shown.length) for (const r of db.prepare(`SELECT shop_id AS id, name FROM shops WHERE shop_id IN (${shown.map(() => "?").join(",")})`).all(...shown.map((s) => s.shopId)) as Array<{ id: string; name: string }>) names.set(r.id, r.name);
  for (const s of shown) s.name = names.get(s.shopId) ?? "";
  return {
    state: "CATEGORY_ACTIVITY_ONLY", category: args.category, total: items.length,
    withinRadius: o ? items.filter((s) => (s.distanceMeters as number) <= radius).length : items.length, shops: shown,
    disclaimerFa: "فعال در این حوزه؛ داشتن این کالا تأیید نشده. این فروشگاه‌ها جزو فروشندگان محصول شمرده نمی‌شوند.",
  };
}
