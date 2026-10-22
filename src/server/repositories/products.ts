import type { DatabaseSync } from "node:sqlite";
import type { Product, ProductSpec } from "@/domain/types";
import { buildMatchQuery } from "@/server/domain/text";
import { clamp, clampOffset, getFlags, LIMITS, type FlagView } from "./shared";

export interface ProductSummary {
  id: string;
  title: string | null;
  categoryName: string;
  brandName: string | null;
  model: string | null;
  imageUrl: string | null;
  offerCount: number;
  pricedOfferCount: number;
}

export interface SearchResult {
  items: ProductSummary[];
  /** "and": every token matched. "or_fallback": nothing matched all tokens, so any-token results are returned and MUST be labelled as looser matches. */
  strategy: "and" | "or_fallback" | "empty_query";
  limit: number;
  offset: number;
}

type SummaryRow = { product_id: string; persian_title: string | null; category_name: string; brand_name: string | null; model: string | null; image: string | null; offer_count: number; priced_offer_count: number };
const toSummary = (r: SummaryRow): ProductSummary => ({
  id: r.product_id, title: r.persian_title, categoryName: r.category_name, brandName: r.brand_name, model: r.model,
  imageUrl: r.image, offerCount: Number(r.offer_count), pricedOfferCount: Number(r.priced_offer_count),
});

const SEARCH_SQL = `
  SELECT p.product_id, p.persian_title, p.category_name, p.brand_name, p.model, json_extract(p.images_json, '$[0]') AS image,
         p.offer_count, p.priced_offer_count,
         bm25(product_fts, 6.0, 2.0, 1.0, 8.0, 1.0) AS score
  FROM product_fts JOIN products p ON p.rowid = product_fts.rowid
  WHERE product_fts MATCH ?
  ORDER BY score, p.product_id
  LIMIT ? OFFSET ?`;

/**
 * Deterministic full-text product search over Persian-normalised text (title, brand, category,
 * model keys, seller titles). Bounded (limit ≤ 50, offset ≤ 1000). Not a typo-correcting search.
 */
export function searchProducts(db: DatabaseSync, query: string, opts: { limit?: number; offset?: number } = {}): SearchResult {
  const limit = clamp(opts.limit, 20, LIMITS.searchMax);
  const offset = clampOffset(opts.offset);
  const q = buildMatchQuery(query);
  if (!q) return { items: [], strategy: "empty_query", limit, offset };
  const stmt = db.prepare(SEARCH_SQL);
  let rows = stmt.all(q.and, limit, offset) as SummaryRow[];
  let strategy: SearchResult["strategy"] = "and";
  if (rows.length === 0 && offset === 0 && q.tokens.length > 1) {
    rows = stmt.all(q.or, limit, offset) as SummaryRow[];
    strategy = "or_fallback";
  }
  return { items: rows.map(toSummary), strategy, limit, offset };
}

export interface ProductDetail {
  product: Product;
  offerCount: number;
  pricedOfferCount: number;
  flags: FlagView[];
}

export function getProduct(db: DatabaseSync, id: string): ProductDetail | null {
  const r = db.prepare("SELECT product_id, brand_name, category_name, model, persian_title, images_json, specs_json, offer_count, priced_offer_count FROM products WHERE product_id = ?").get(id) as
    | { product_id: string; brand_name: string | null; category_name: string; model: string | null; persian_title: string | null; images_json: string | null; specs_json: string | null; offer_count: number; priced_offer_count: number }
    | undefined;
  if (!r) return null;
  return {
    product: {
      id: r.product_id, title: r.persian_title ?? "", categoryName: r.category_name, brandName: r.brand_name, model: r.model,
      imageUrls: r.images_json ? (JSON.parse(r.images_json) as string[]) : [],
      specs: r.specs_json ? (JSON.parse(r.specs_json) as ProductSpec[]) : [],
    },
    offerCount: Number(r.offer_count),
    pricedOfferCount: Number(r.priced_offer_count),
    flags: getFlags(db, "product", id),
  };
}

