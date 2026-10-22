import type { DatabaseSync } from "node:sqlite";
import type { PriceSummary, ProductCard, VariantSignals } from "@/domain/advisor";
import { describePriceStatus } from "@/server/domain/price-evidence";
import type { PriceStatus } from "@/server/domain/price-evidence";

/** Only the image CDN seen in the dataset is allowed; anything else is dropped. */
const IMAGE_HOSTS = new Set(["image.torob.com"]);

export function safeImageUrl(json: string | null): string | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return null;
    for (const u of arr) {
      if (typeof u !== "string") continue;
      const url = new URL(u);
      if (url.protocol === "https:" && IMAGE_HOSTS.has(url.hostname)) return url.href;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export interface ProductRow {
  id: string;
  rowid: number;
  title: string;
  categoryName: string;
  brandName: string | null;
  model: string | null;
  imagesJson: string | null;
  specsJson: string | null;
  specCount: number;
  offerCount: number;
  titleNorm: string;
  brandNorm: string;
  categoryNorm: string;
  modelKeys: string;
  ev: {
    status: PriceStatus;
    reliableCount: number;
    min: number | null;
    median: number | null;
    max: number | null;
    unitHint: string | null;
    spreadRatio: number | null;
    staleShare: number | null;
    totalOffers: number;
    pricedOffers: number;
    distinctSellers: number;
    excluded: Record<string, number>;
  };
}

const COLS = `p.product_id AS id, p.rowid AS rowid, p.persian_title AS title, p.category_name AS categoryName, p.brand_name AS brandName, p.model AS model,
  p.images_json AS imagesJson, p.specs_json AS specsJson, p.spec_count AS specCount, p.offer_count AS offerCount,
  p.title_norm AS titleNorm, p.brand_norm AS brandNorm, p.category_norm AS categoryNorm, p.model_keys AS modelKeys,
  e.status AS e_status, e.reliable_count AS e_rel, e.min_toman AS e_min, e.median_toman AS e_med, e.max_toman AS e_max, e.unit_hint AS e_unit,
  e.spread_ratio AS e_spread, e.stale_share AS e_stale, e.total_offers AS e_total, e.priced_offers AS e_priced, e.distinct_sellers AS e_sellers, e.excluded_json AS e_excl`;

type Raw = Record<string, unknown>;
function toRow(r: Raw): ProductRow {
  return {
    id: r.id as string, rowid: Number(r.rowid), title: (r.title as string | null) ?? "", categoryName: r.categoryName as string,
    brandName: (r.brandName as string | null) ?? null, model: (r.model as string | null) ?? null,
    imagesJson: (r.imagesJson as string | null) ?? null, specsJson: (r.specsJson as string | null) ?? null,
    specCount: Number(r.specCount), offerCount: Number(r.offerCount),
    titleNorm: r.titleNorm as string, brandNorm: r.brandNorm as string, categoryNorm: r.categoryNorm as string, modelKeys: r.modelKeys as string,
    ev: {
      status: ((r.e_status as PriceStatus | null) ?? "no_price"), reliableCount: Number(r.e_rel ?? 0),
      min: (r.e_min as number | null) ?? null, median: (r.e_med as number | null) ?? null, max: (r.e_max as number | null) ?? null,
      unitHint: (r.e_unit as string | null) ?? null, spreadRatio: (r.e_spread as number | null) ?? null, staleShare: (r.e_stale as number | null) ?? null,
      totalOffers: Number(r.e_total ?? 0), pricedOffers: Number(r.e_priced ?? 0), distinctSellers: Number(r.e_sellers ?? 0),
      excluded: r.e_excl ? (JSON.parse(r.e_excl as string) as Record<string, number>) : {},
    },
  };
}

export function fetchProductRows(db: DatabaseSync, ids: readonly string[]): Map<string, ProductRow> {
  const out = new Map<string, ProductRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = db
      .prepare(`SELECT ${COLS} FROM products p LEFT JOIN product_price_evidence e ON e.product_id = p.product_id WHERE p.product_id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk) as Raw[];
    for (const r of rows) out.set(r.id as string, toRow(r));
  }
  return out;
}

export function fetchCategoryRows(db: DatabaseSync, category: string): ProductRow[] {
  const rows = db
    .prepare(`SELECT ${COLS} FROM products p LEFT JOIN product_price_evidence e ON e.product_id = p.product_id WHERE p.category_name = ? ORDER BY p.rowid`)
    .all(category) as Raw[];
  return rows.map(toRow);
}

export function priceSummary(ev: ProductRow["ev"]): PriceSummary {
  return {
    status: ev.status, label: describePriceStatus({ status: ev.status, spreadRatio: ev.spreadRatio }),
    min: ev.min, median: ev.median, max: ev.max, reliableCount: ev.reliableCount,
    unitHint: (ev.unitHint as PriceSummary["unitHint"]) ?? null, staleShare: ev.staleShare, spreadRatio: ev.spreadRatio,
    pricedOffers: ev.pricedOffers, totalOffers: ev.totalOffers, excluded: ev.excluded,
  };
}

const EMPTY_SIGNALS: VariantSignals = { modelMismatch: 0, modelUnconfirmed: 0, unitAmbiguous: 0, noPrice: 0, implausiblePrice: 0, stale: 0 };

/** Counts of identity/quality flags over a product's offers (one grouped query). */
export function variantSignals(db: DatabaseSync, productId: string): VariantSignals {
  const rows = db
    .prepare(
      `SELECT f.code AS code, count(*) AS n FROM offers o JOIN quality_flags f ON f.entity_type = 'offer' AND f.entity_id = o.offer_id
       WHERE o.product_id = ? GROUP BY f.code`,
    )
    .all(productId) as Array<{ code: string; n: number }>;
  const s = { ...EMPTY_SIGNALS };
  for (const r of rows) {
    const n = Number(r.n);
    if (r.code === "VARIANT_MODEL_MISMATCH") s.modelMismatch = n;
    else if (r.code === "VARIANT_MODEL_UNCONFIRMED") s.modelUnconfirmed = n;
    else if (r.code === "UNIT_AMBIGUOUS") s.unitAmbiguous = n;
    else if (r.code === "NULL_PRICE") s.noPrice = n;
    else if (r.code === "PRICE_ABSURD_MAGNITUDE" || r.code === "NONPOSITIVE_PRICE" || r.code === "PRICE_MALFORMED") s.implausiblePrice += n;
    else if (r.code === "TIMESTAMP_STALE") s.stale = n;
  }
  return s;
}

export function toCard(row: ProductRow, signals: VariantSignals): ProductCard {
  return {
    id: row.id, title: row.title, categoryName: row.categoryName, brandName: row.brandName, model: row.model,
    imageUrl: safeImageUrl(row.imagesJson), specCount: row.specCount, offerCount: row.offerCount,
    distinctSellers: row.ev.distinctSellers, price: priceSummary(row.ev), variants: signals,
  };
}
