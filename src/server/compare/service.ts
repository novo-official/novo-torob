import type { DatabaseSync } from "node:sqlite";
import type { ComparisonCandidate, RankingPriority, SellerComparisonResponse } from "@/domain/comparison";
import { COMPARE_LIMITS } from "@/domain/comparison";
import type { DeclaredHours } from "@/domain/types";
import { flagDef } from "@/domain/quality";
import { isValidCoordinate } from "@/lib/geo";
import { buildVariantGroups } from "@/server/catalog/detail";
import { fetchProductRows } from "@/server/catalog/rows";
import { NO_SCHEDULE } from "@/server/domain/hours";
import { findSellersForProduct } from "@/server/sellers/find";
import { compareSellers, type EngineSeller } from "./engine";
import type { EngineOffer } from "./identity";
import { parseTehranLocal } from "./time";

export interface CompareInput {
  productId: string;
  variantGroupId?: string | null;
  shopIds: string[];
  origin?: { lat: number; lon: number; source: "manual" | "gps"; label: string } | null;
  radiusMeters?: number;
  /** «YYYY-MM-DDTHH:mm» as Asia/Tehran wall-clock time; absent/invalid → now */
  visit?: string | null;
  budget?: { min: number | null; max: number | null };
  strictBudget?: boolean;
  priority?: RankingPriority;
  now?: Date;
}

const OFFER_LIMIT = 3000;
const SHOP_ID = /^shop_[0-9a-f]{8,40}$/;
const IDENTITY_FLAGS = new Set(["VARIANT_MODEL_MISMATCH", "UNIT_AMBIGUOUS", "VARIANT_MODEL_UNCONFIRMED"]);

type RawOffer = {
  offer_id: string; product_id: string; shop_id: string; seller_title: string; price_toman: number | null; price_toman_raw: string | null; price_out_of_range: number;
  price_changed_at: string | null; unit_hint: "per_metre" | "roll_or_pack" | "unknown"; model_keys: string | null; source_row: number | null;
  warranty_months: number | null; warranty_provider: string | null; warranty_description: string | null; flags: string | null;
};
type ShopRow = { shop_id: string; name: string; location_label: string | null; lat: number | null; lon: number | null; hours_json: string; payment_json: string | null };

export function snapshotRefOf(db: DatabaseSync): string | null {
  const r = db.prepare("SELECT snapshot_ref AS s FROM import_runs WHERE status = 'complete' ORDER BY id DESC LIMIT 1").get() as { s: string | null } | undefined;
  return r?.s ?? null;
}

export function compareSellersForProduct(db: DatabaseSync, input: CompareInput): SellerComparisonResponse | null {
  const prod = fetchProductRows(db, [input.productId]).get(input.productId);
  if (!prod) return null;
  const now = input.now ?? new Date();
  const notices: string[] = [];

  const raws = db
    .prepare(
      `SELECT o.offer_id, o.product_id, o.shop_id, o.seller_title, o.price_toman, o.price_toman_raw, o.price_out_of_range, o.price_changed_at, o.unit_hint, o.model_keys, o.source_row,
              o.warranty_months, o.warranty_provider, o.warranty_description,
              (SELECT group_concat(code) FROM quality_flags f WHERE f.entity_type='offer' AND f.entity_id = o.offer_id) AS flags
       FROM offers o WHERE o.product_id = ? ORDER BY o.source_row LIMIT ${OFFER_LIMIT}`,
    )
    .all(input.productId) as unknown as RawOffer[];

  const productKeys = prod.modelKeys ? prod.modelKeys.split(" ") : [];
  const { groups, assignment } = buildVariantGroups(productKeys, raws.map((r) => ({ ...r, flags: r.flags })) as never);
  const hasIdentityRisk = raws.some((r) => r.flags?.includes("VARIANT_MODEL_MISMATCH") || r.flags?.includes("UNIT_AMBIGUOUS"));
  const needsConfirmation = groups.length > 1 || hasIdentityRisk;
  let selected = input.variantGroupId ? (groups.find((g) => g.id === input.variantGroupId) ?? null) : null;
  if (input.variantGroupId && !selected) notices.push("نسخه‌ی ذخیره‌شده در انتخاب شما دیگر پیدا نشد؛ لطفاً دوباره انتخاب کنید.");
  if (!selected && !needsConfirmation && groups.length === 1) selected = groups[0]!;

  const toOffer = (r: RawOffer): EngineOffer => ({
    offerId: r.offer_id, productId: r.product_id, shopId: r.shop_id, sellerTitle: r.seller_title, priceToman: r.price_toman, priceRaw: r.price_toman_raw,
    priceOutOfRange: r.price_out_of_range === 1, priceChangedAt: r.price_changed_at, unitHint: r.unit_hint, modelKeys: r.model_keys ? r.model_keys.split(" ") : [],
    flags: r.flags ? r.flags.split(",") : [], groupId: assignment.get(r.offer_id) ?? "", sourceRow: r.source_row,
    warranty: { months: r.warranty_months, provider: r.warranty_provider, description: r.warranty_description },
  });
  const offers = raws.map(toOffer);

  // peers: eligible prices of the SELECTED variant across all shops (only to flag unusually low/high records)
  const peerPrices = selected
    ? offers.filter((o) => o.groupId === selected!.id && o.priceToman !== null && !o.priceOutOfRange && Number.isSafeInteger(o.priceToman) && o.priceChangedAt &&
        !o.flags.some((f) => !!flagDef(f)?.blocksComparison && !IDENTITY_FLAGS.has(f)) && !o.flags.some((f) => f === "TIMESTAMP_MISSING" || f === "TIMESTAMP_MALFORMED" || f === "TIMESTAMP_FUTURE"))
        .map((o) => o.priceToman as number)
    : [];

  // requested sellers (2–4; fewer is allowed and handled)
  const ids = [...new Set(input.shopIds)].slice(0, COMPARE_LIMITS.maxSellers);
  if (new Set(input.shopIds).size > COMPARE_LIMITS.maxSellers) notices.push(`حداکثر ${COMPARE_LIMITS.maxSellers} فروشگاه هم‌زمان مقایسه می‌شود؛ بقیه کنار گذاشته شد.`);
  const sellers: EngineSeller[] = [];
  for (const id of ids) {
    if (!SHOP_ID.test(id)) { notices.push("شناسه‌ی یکی از فروشگاه‌ها معتبر نیست و نادیده گرفته شد."); continue; }
    const s = db.prepare("SELECT shop_id, name, location_label, lat, lon, hours_json, payment_json FROM shops WHERE shop_id = ?").get(id) as ShopRow | undefined;
    if (!s) { notices.push("یکی از فروشگاه‌های انتخابی در داده پیدا نشد و نادیده گرفته شد."); continue; }
    let hours: DeclaredHours = NO_SCHEDULE;
    try { hours = JSON.parse(s.hours_json) as DeclaredHours; } catch { /* unknown, never closed */ }
    let payment: EngineSeller["payment"] = [];
    try { payment = s.payment_json ? (JSON.parse(s.payment_json) as EngineSeller["payment"]) : []; } catch { /* undeclared */ }
    sellers.push({
      shopId: s.shop_id, name: s.name, locationLabel: s.location_label,
      lat: s.lat !== null && s.lon !== null && isValidCoordinate(s.lat, s.lon) ? s.lat : null, lon: s.lat !== null && s.lon !== null && isValidCoordinate(s.lat, s.lon) ? s.lon : null,
      hours, payment, offers: offers.filter((o) => o.shopId === s.shop_id),
    });
  }

  // visit time
  const parsedVisit = parseTehranLocal(input.visit ?? null);
  if (input.visit && !parsedVisit) notices.push("زمان بازدید معتبر نیست؛ زمان فعلی استفاده شد.");
  const visitAt = parsedVisit ?? now;

  // candidates to add: nearby offer-linked sellers of the same Selection, not already chosen
  const near = findSellersForProduct(db, {
    productId: input.productId, variantGroupId: selected?.id ?? null, origin: input.origin ?? null, radiusMeters: input.radiusMeters ?? 1000,
    showUncertain: !selected, pageSize: 16, at: now,
  });
  const candidates: ComparisonCandidate[] = (near?.sellers ?? [])
    .filter((s) => !sellers.some((x) => x.shopId === s.shopId))
    .slice(0, 12)
    .map((s) => ({ shopId: s.shopId, name: s.name, locationLabel: s.locationLabel, distanceMeters: s.distanceMeters, offerCount: s.offerCount, variantMatchStatus: s.variantMatchStatus }));

  return compareSellers({
    product: { id: prod.id, title: prod.title, categoryName: prod.categoryName },
    groups, selected, needsConfirmation, sellers, peerPrices, snapshotRef: snapshotRefOf(db), now, visitAt, visitIsNow: !parsedVisit,
    origin: input.origin ? { ...input.origin } : null, radiusMeters: input.radiusMeters ?? 1000, budget: input.budget ?? { min: null, max: null },
    strictBudget: !!input.strictBudget, priority: input.priority ?? "price", requestedShopIds: ids, candidates, notices,
  });
}
