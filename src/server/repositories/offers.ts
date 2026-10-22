import type { DatabaseSync } from "node:sqlite";
import { isComparisonEligible } from "@/domain/quality";
import type { Offer } from "@/domain/types";
import { haversineMeters } from "@/server/domain/geo";
import { clamp, clip, LIMITS } from "./shared";

export interface OfferView {
  offer: Offer;
  /** Exact source text of the recorded price ("null" when absent). Display this, not a guess. */
  priceRaw: string | null;
  unitHint: "per_metre" | "roll_or_pack" | "unknown";
  shop: { id: string; name: string; locationLabel: string | null; lat: number | null; lon: number | null };
  distanceMeters: number | null;
  flagCodes: string[];
  /** May this offer enter a numeric price ranking? (null price, outliers, mismatched variants, duplicates are excluded) */
  comparisonEligible: boolean;
  /** Always "unconfirmed": the dataset has no stock signal. */
  stock: "unconfirmed";
}

type Row = {
  offer_id: string; product_id: string; shop_id: string; seller_title: string; description: string | null; price_toman_raw: string | null; price_toman: number | null;
  price_changed_at: string | null; warranty_months: number | null; warranty_provider: string | null; warranty_description: string | null; unit_hint: OfferView["unitHint"];
  name: string; location_label: string | null; lat: number | null; lon: number | null; flags: string | null;
};

/** All recorded offers for a product — variants are NEVER collapsed; each row keeps its raw seller title. */
export function listOffersForProduct(
  db: DatabaseSync,
  productId: string,
  opts: { limit?: number; near?: { lat: number; lon: number }; sort?: "price" | "distance" | "source" } = {},
): OfferView[] {
  const limit = clamp(opts.limit, 50, LIMITS.offersMax);
  const rows = db
    .prepare(
      `SELECT o.offer_id, o.product_id, o.shop_id, o.seller_title, o.description, o.price_toman_raw, o.price_toman, o.price_changed_at,
              o.warranty_months, o.warranty_provider, o.warranty_description, o.unit_hint,
              s.name, s.location_label, s.lat, s.lon,
              (SELECT group_concat(code) FROM quality_flags f WHERE f.entity_type='offer' AND f.entity_id = o.offer_id) AS flags
       FROM offers o JOIN shops s ON s.shop_id = o.shop_id
       WHERE o.product_id = ? ORDER BY o.source_row LIMIT ?`,
    )
    .all(productId, LIMITS.offersMax) as Row[];
  const views = rows.map((r): OfferView => {
    const codes = r.flags ? r.flags.split(",") : [];
    return {
      offer: {
        id: r.offer_id, productId: r.product_id, shopId: r.shop_id, sellerTitle: r.seller_title, priceToman: r.price_toman,
        lastPriceChangedAt: r.price_changed_at, description: clip(r.description),
        warranty: r.warranty_months === null && !r.warranty_provider && !r.warranty_description ? null : { description: r.warranty_description, periodMonths: r.warranty_months, provider: r.warranty_provider },
      },
      priceRaw: r.price_toman_raw,
      unitHint: r.unit_hint,
      shop: { id: r.shop_id, name: r.name, locationLabel: r.location_label, lat: r.lat, lon: r.lon },
      distanceMeters: opts.near && r.lat !== null && r.lon !== null ? haversineMeters(opts.near.lat, opts.near.lon, r.lat, r.lon) : null,
      flagCodes: codes,
      comparisonEligible: r.price_toman !== null && isComparisonEligible(codes),
      stock: "unconfirmed",
    };
  });
  if (opts.sort === "price") views.sort((a, b) => (a.offer.priceToman ?? Infinity) - (b.offer.priceToman ?? Infinity));
  else if (opts.sort === "distance") views.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  return views.slice(0, limit);
}
