import type { DatabaseSync } from "node:sqlite";
import { EVIDENCE_RULES_VERSION } from "@/domain/quality";
import { buildPriceEvidence, type OfferForEvidence } from "@/server/domain/price-evidence";

export interface EvidenceStats {
  [status: string]: number;
}

/** Fill product_price_evidence from offers + quality flags (keyset chunks → bounded memory). */
export function computeProductEvidence(db: DatabaseSync): EvidenceStats {
  const stats: EvidenceStats = {};
  const nextIds = db.prepare("SELECT product_id FROM products WHERE product_id > ? ORDER BY product_id LIMIT 3000");
  const rowsIn = db.prepare(
    `SELECT o.product_id, o.shop_id, o.price_toman, o.unit_hint, o.price_changed_at, o.source_row,
            (SELECT group_concat(code) FROM quality_flags f WHERE f.entity_type = 'offer' AND f.entity_id = o.offer_id) AS flags
     FROM offers o WHERE o.product_id > ? AND o.product_id <= ? ORDER BY o.product_id, o.source_row`,
  );
  const ins = db.prepare(
    `INSERT INTO product_price_evidence(product_id, status, reliable_count, min_toman, median_toman, max_toman, unit_hint, spread_ratio, stale_share,
       newest_at, oldest_at, total_offers, priced_offers, distinct_sellers, excluded_json, rules_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  let prev = "";
  for (;;) {
    const ids = nextIds.all(prev) as Array<{ product_id: string }>;
    if (!ids.length) break;
    const last = ids[ids.length - 1]!.product_id;
    const rows = rowsIn.all(prev, last) as unknown as Array<{ product_id: string; shop_id: string; price_toman: number | null; unit_hint: string; price_changed_at: string | null; flags: string | null }>;
    const byProduct = new Map<string, typeof rows>();
    for (const r of rows) (byProduct.get(r.product_id) ?? byProduct.set(r.product_id, []).get(r.product_id)!).push(r);
    db.exec("BEGIN");
    for (const { product_id } of ids) {
      const rs = byProduct.get(product_id) ?? [];
      const offers: OfferForEvidence[] = rs.map((r) => ({ shopId: r.shop_id, price: r.price_toman, unitHint: r.unit_hint, flags: r.flags ? r.flags.split(",") : [] }));
      const e = buildPriceEvidence(offers);
      const dates = rs.map((r) => r.price_changed_at).filter((d): d is string => !!d).sort();
      ins.run(product_id, e.status, e.reliableCount, e.min, e.median, e.max, e.unitHint, e.spreadRatio, e.staleShare, dates.at(-1) ?? null, dates[0] ?? null, e.totalOffers, e.pricedOffers, e.distinctSellers, Object.keys(e.excluded).length ? JSON.stringify(e.excluded) : null, EVIDENCE_RULES_VERSION);
      stats[e.status] = (stats[e.status] ?? 0) + 1;
    }
    db.exec("COMMIT");
    prev = last;
  }
  return stats;
}
