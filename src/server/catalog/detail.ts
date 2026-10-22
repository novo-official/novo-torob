import type { DatabaseSync } from "node:sqlite";
import type { ProductCard, Selection, VariantGroup } from "@/domain/advisor";
import { flagDef } from "@/domain/quality";
import type { ProductSpec } from "@/domain/types";
import { buildPriceEvidence, type OfferForEvidence } from "@/server/domain/price-evidence";
import { keysCompatible, modelRelation, type UnitHint } from "@/server/domain/text";
import { getFlags, type FlagView } from "@/server/repositories/shared";
import { fetchProductRows, priceSummary, safeImageUrl, toCard, variantSignals } from "./rows";

export interface OfferLine {
  offerId: string;
  /** RAW seller title, never rewritten */
  sellerTitle: string;
  priceRaw: string | null;
  priceToman: number | null;
  unitHint: UnitHint;
  priceChangedAt: string | null;
  flags: Array<{ code: string; severity: "info" | "warn" | "error"; reason: string }>;
  comparisonEligible: boolean;
  variantGroupId: string;
}

export interface ProductDetailView {
  card: ProductCard;
  images: string[];
  specs: ProductSpec[];
  variantGroups: VariantGroup[];
  offers: OfferLine[];
  offersShown: number;
  flags: FlagView[];
  /** true when offers disagree on model code or unit, so the exact variant must be confirmed before comparing sellers */
  needsVariantConfirmation: boolean;
}

type Raw = { offer_id: string; shop_id: string; seller_title: string; price_toman: number | null; price_toman_raw: string | null; unit_hint: UnitHint; model_keys: string; price_changed_at: string | null; flags: string | null };

const IDENTITY_FLAGS = new Set(["VARIANT_MODEL_MISMATCH", "VARIANT_MODEL_UNCONFIRMED"]);
const SHOWN_OFFERS = 12;

/** Offers of one product, grouped by (unit hint × model-code family). A group is "the same sellable variant" only by this evidence. */
export function buildVariantGroups(productKeys: readonly string[], rows: Raw[]): { groups: VariantGroup[]; assignment: Map<string, string> } {
  const clusters: Array<{ keys: string[]; rows: Raw[] }> = [];
  const nokey: Raw[] = [];
  for (const r of rows) {
    const ks = r.model_keys ? r.model_keys.split(" ") : [];
    if (!ks.length) { nokey.push(r); continue; }
    const hit = clusters.find((c) => keysCompatible(c.keys, ks));
    if (hit) { hit.keys.push(...ks); hit.rows.push(r); } else clusters.push({ keys: [...ks], rows: [r] });
  }
  // label key = the most frequent key among the group's offers (ties → shorter, then alphabetical): stable and readable
  const mostCommon = (keys: string[]): string => {
    const freq = new Map<string, number>();
    for (const k of keys) freq.set(k, (freq.get(k) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]![0];
  };
  const buckets: Array<{ modelKey: string | null; keys: string[]; rows: Raw[] }> = clusters.map((c) => ({ modelKey: mostCommon(c.keys), keys: c.keys, rows: c.rows }));
  // key-less offers join the single cluster when there is exactly one; otherwise they stay an "unspecified" group
  if (nokey.length) {
    if (buckets.length === 1) buckets[0]!.rows.push(...nokey);
    else buckets.push({ modelKey: null, keys: [], rows: nokey });
  }
  const groups: VariantGroup[] = [];
  const assignment = new Map<string, string>();
  for (const b of buckets) {
    const byUnit = new Map<UnitHint, Raw[]>();
    for (const r of b.rows) (byUnit.get(r.unit_hint) ?? byUnit.set(r.unit_hint, []).get(r.unit_hint)!).push(r);
    for (const [unit, rs] of byUnit) {
      const id = `${unit}|${b.modelKey ?? "any"}`;
      const rel = b.modelKey ? modelRelation(productKeys, b.keys) : "unknown";
      const offers: OfferForEvidence[] = rs.map((r) => ({
        shopId: r.shop_id, price: r.price_toman, unitHint: r.unit_hint,
        // inside a variant group the identity flags are the very thing being grouped, so they must not block its own price range
        flags: (r.flags ? r.flags.split(",") : []).filter((f) => !IDENTITY_FLAGS.has(f)),
      }));
      const ev = buildPriceEvidence(offers);
      const flagSet = new Set(rs.flatMap((r) => (r.flags ? r.flags.split(",") : [])));
      if (rel === "sibling") flagSet.add("VARIANT_MODEL_MISMATCH");
      else if (rel === "unrelated") flagSet.add("VARIANT_MODEL_UNCONFIRMED");
      groups.push({
        id, unitHint: unit, modelKey: b.modelKey, offerCount: rs.length, eligibleOffers: ev.reliableCount,
        sampleTitle: rs[0]!.seller_title,
        label: `${b.modelKey ? `کد مدل ${b.modelKey}` : "کد مدل نامشخص"}${unit === "per_metre" ? " — قیمت متری" : unit === "roll_or_pack" ? " — حلقه/بسته" : ""}`,
        flags: [...flagSet].filter((f) => flagDef(f)).sort(),
        price: { ...priceSummary({ status: ev.status, reliableCount: ev.reliableCount, min: ev.min, median: ev.median, max: ev.max, unitHint: ev.unitHint, spreadRatio: ev.spreadRatio, staleShare: ev.staleShare, totalOffers: ev.totalOffers, pricedOffers: ev.pricedOffers, distinctSellers: ev.distinctSellers, excluded: ev.excluded }) },
      });
      for (const r of rs) assignment.set(r.offer_id, id);
    }
  }
  groups.sort((a, b) => b.offerCount - a.offerCount || a.id.localeCompare(b.id));
  return { groups, assignment };
}

export function getProductDetail(db: DatabaseSync, id: string): ProductDetailView | null {
  const row = fetchProductRows(db, [id]).get(id);
  if (!row) return null;
  const raws = db
    .prepare(
      `SELECT o.offer_id, o.shop_id, o.seller_title, o.price_toman, o.price_toman_raw, o.unit_hint, o.model_keys, o.price_changed_at,
              (SELECT group_concat(code) FROM quality_flags f WHERE f.entity_type='offer' AND f.entity_id = o.offer_id) AS flags
       FROM offers o WHERE o.product_id = ? ORDER BY o.source_row LIMIT 400`,
    )
    .all(id) as unknown as Raw[];
  const productKeys = row.modelKeys ? row.modelKeys.split(" ") : [];
  const { groups, assignment } = buildVariantGroups(productKeys, raws);

  const flagRows = db.prepare("SELECT entity_id AS id, code, severity, reason FROM quality_flags WHERE entity_type='offer' AND entity_id IN (SELECT offer_id FROM offers WHERE product_id = ?) ORDER BY id").all(id) as Array<{ id: string; code: string; severity: "info" | "warn" | "error"; reason: string }>;
  const byOffer = new Map<string, OfferLine["flags"]>();
  for (const f of flagRows) (byOffer.get(f.id) ?? byOffer.set(f.id, []).get(f.id)!).push({ code: f.code, severity: f.severity, reason: f.reason });

  const offers: OfferLine[] = raws.slice(0, SHOWN_OFFERS).map((r) => {
    const fl = byOffer.get(r.offer_id) ?? [];
    return {
      offerId: r.offer_id, sellerTitle: r.seller_title, priceRaw: r.price_toman_raw, priceToman: r.price_toman, unitHint: r.unit_hint, priceChangedAt: r.price_changed_at,
      flags: fl, comparisonEligible: r.price_toman !== null && !fl.some((f) => flagDef(f.code)?.blocksComparison), variantGroupId: assignment.get(r.offer_id) ?? "",
    };
  });

  let specs: ProductSpec[] = [];
  try { specs = row.specsJson ? (JSON.parse(row.specsJson) as ProductSpec[]) : []; } catch { specs = []; }
  let images: string[] = [];
  try { images = row.imagesJson ? (JSON.parse(row.imagesJson) as string[]).map((u) => safeImageUrl(JSON.stringify([u]))).filter((u): u is string => !!u) : []; } catch { images = []; }

  const signals = variantSignals(db, id);
  return {
    card: toCard(row, signals), images, specs, variantGroups: groups, offers, offersShown: offers.length, flags: getFlags(db, "product", id),
    needsVariantConfirmation: groups.length > 1 || signals.modelMismatch > 0 || signals.unitAmbiguous > 0,
  };
}

/** The identity handed to Phase 4. Pure: it validates ids against the product's own variant groups. */
export function buildSelection(db: DatabaseSync, productId: string, opts: { variantGroupId?: string | null; budget?: { min: number | null; max: number | null }; source: Selection["source"] }): Selection | null {
  const d = getProductDetail(db, productId);
  if (!d) return null;
  const group = opts.variantGroupId ? d.variantGroups.find((g) => g.id === opts.variantGroupId) ?? null : null;
  return {
    productId, productTitle: d.card.title, categoryName: d.card.categoryName,
    variantGroupId: group?.id ?? null, unitHint: group?.unitHint ?? null, priceStatus: (group?.price ?? d.card.price).status,
    budget: opts.budget ?? { min: null, max: null }, source: opts.source,
  };
}
