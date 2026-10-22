import type { DatabaseSync } from "node:sqlite";
import type { MissionFacts } from "@/domain/mission-recovery";
import { buildAdvisorHref } from "@/lib/advisor-url";
import { buildCompareHref } from "@/lib/compare-url";
import { externalMapLink, isValidCoordinate } from "@/lib/geo";
import { buildSellersHref } from "@/lib/sellers-url";
import { fetchProductRows } from "@/server/catalog/rows";
import { resolveInquiryContext } from "@/server/inquiry/context";

/** Re-derives what a mission displays. The mission never carries prices/titles: whatever it claims is re-checked here, read-only. */
export function loadMissionFacts(db: DatabaseSync, i: { product: string; variant: string | null; shop: string | null; offer: string | null; visit: string | null; now?: Date }): MissionFacts {
  const row = fetchProductRows(db, [i.product]).get(i.product);
  const hrefs = { sellers: buildSellersHref({ product: i.product, variant: i.variant }), compare: buildCompareHref({ product: i.product, variant: i.variant }), discover: buildAdvisorHref({}) };
  if (!row) return { product: null, context: null, error: "PRODUCT_NOT_FOUND", shopMapHref: null, hrefs };
  const base = { id: i.product, title: row.title, categoryName: row.categoryName, productHref: `/products/${i.product}${i.variant ? `?variant=${encodeURIComponent(i.variant)}` : ""}` };
  if (!i.shop) return { product: base, context: null, error: null, shopMapHref: null, hrefs: { ...hrefs, discover: buildAdvisorHref({ category: row.categoryName }) } };
  const r = resolveInquiryContext(db, { product: i.product, variant: i.variant, shop: i.shop, offer: i.offer, visit: i.visit, now: i.now });
  if (!r.ok) return { product: base, context: null, error: r.error, candidates: r.candidates, shopMapHref: null, hrefs };
  const pt = db.prepare("SELECT lat, lon FROM shops WHERE shop_id = ?").get(i.shop) as { lat: number | null; lon: number | null } | undefined;
  const shopMapHref = pt && pt.lat !== null && pt.lon !== null && isValidCoordinate(pt.lat, pt.lon) ? externalMapLink(pt.lat, pt.lon) : null;
  return { product: base, context: r.context, error: null, shopMapHref, hrefs: { sellers: r.context.routes.sellersHref, compare: r.context.routes.compareHref, discover: r.context.routes.discoverHref } };
}
