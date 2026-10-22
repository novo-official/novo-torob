import type { DatabaseSync } from "node:sqlite";
import type { VariantGroup } from "@/domain/advisor";
import { flagDef, isComparisonEligible } from "@/domain/quality";
import type {
  SellerMatch, SellerOfferLine, SellerPriceEvidence, SellersCounts, SellersFilters, SellersResponse, SellersSort, VariantMatchStatus,
} from "@/domain/sellers";
import type { DeclaredHours } from "@/domain/types";
import { haversineMeters, isValidCoordinate, RADIUS_OPTIONS, boundingBox } from "@/lib/geo";
import { buildVariantGroups } from "@/server/catalog/detail";
import { fetchProductRows, priceSummary } from "@/server/catalog/rows";
import { evaluateHours, NO_SCHEDULE } from "@/server/domain/hours";
import { areSiblingKeys, keysCompatible } from "@/server/domain/text";
import { recommendShoppingAreas } from "@/server/areas/recommend";

export const SELLERS_LIMITS = { pageSizeMax: 50, pageSizeDefault: 12, offerRowsMax: 3000, outsideShown: 10 } as const;
const IDENTITY_FLAGS = new Set(["VARIANT_MODEL_MISMATCH", "VARIANT_MODEL_UNCONFIRMED"]);
const PAYMENT_PROVIDERS = ["ترب‌پی", "اسنپ‌پی", "دیجی پی", "تارا", "ازکی‌وام"] as const;
export const KNOWN_PAYMENT_PROVIDERS: readonly string[] = PAYMENT_PROVIDERS;

export interface FindSellersInput {
  productId: string;
  /** the Phase 3 Selection's variantGroupId; unknown ids are ignored (and reported) */
  variantGroupId?: string | null;
  origin?: { lat: number; lon: number; source: "manual" | "gps"; label?: string | null; defaulted?: boolean } | null;
  radiusMeters?: number;
  showUncertain?: boolean;
  sort?: SellersSort;
  openNow?: boolean;
  reliablePriceOnly?: boolean;
  paymentProvider?: string | null;
  page?: number;
  pageSize?: number;
  /** evaluation instant for declared hours (tests); default = now */
  at?: Date;
  /** also return real matches beyond the radius even when some are inside */
  includeOutside?: boolean;
  /** shop-detail use: restrict the aggregation to one shop (counts are then only meaningful for that shop) */
  onlyShopId?: string;
}

type Raw = {
  offer_id: string; shop_id: string; seller_title: string; price_toman: number | null; price_toman_raw: string | null; unit_hint: "per_metre" | "roll_or_pack" | "unknown";
  model_keys: string; price_changed_at: string | null; flags: string | null;
  name: string; address: string | null; location_label: string | null; lat: number | null; lon: number | null; hours_json: string; payment_json: string | null;
};

const RANK: Record<VariantMatchStatus, number> = { PLAUSIBLE: 0, UNCERTAIN: 1, UNSELECTED: 2, CONFLICTING: 3 };
const bestOf = (a: VariantMatchStatus, b: VariantMatchStatus) => (RANK[a] <= RANK[b] ? a : b);

/**
 * How does ONE offer relate to the variant the user selected? "PLAUSIBLE" is a heuristic read of the seller title;
 * it is never "confirmed". Conflicts (different unit or sibling model code) are NEVER silently swapped in.
 */
export function classifyOffer(args: {
  offerGroup: Pick<VariantGroup, "id" | "unitHint" | "modelKey">;
  selected: Pick<VariantGroup, "id" | "unitHint" | "modelKey"> | null;
  needsConfirmation: boolean;
}): { status: VariantMatchStatus; evidence: SellerOfferLine["variantEvidence"] } {
  const { offerGroup, selected, needsConfirmation } = args;
  if (!selected) {
    if (needsConfirmation) return { status: "UNSELECTED", evidence: "variant_not_selected" };
    return { status: "PLAUSIBLE", evidence: offerGroup.modelKey ? "model_key_match" : "product_id_only" };
  }
  // same group the user chose: product_id matches and the title names no different model — plausible, never "confirmed"
  if (offerGroup.id === selected.id) return { status: "PLAUSIBLE", evidence: selected.modelKey ? "model_key_match" : "product_id_only" };
  if (offerGroup.unitHint !== selected.unitHint) return { status: "CONFLICTING", evidence: "unit_mismatch" };
  if (!offerGroup.modelKey || !selected.modelKey) return { status: "UNCERTAIN", evidence: "no_model_key" };
  if (keysCompatible([selected.modelKey], [offerGroup.modelKey])) return { status: "PLAUSIBLE", evidence: "model_key_match" };
  if (areSiblingKeys(selected.modelKey, offerGroup.modelKey)) return { status: "CONFLICTING", evidence: "sibling_model" };
  return { status: "UNCERTAIN", evidence: "unrelated_model" };
}

function priceEvidence(lines: SellerOfferLine[], at: Date): SellerPriceEvidence {
  const plausible = lines.filter((l) => l.variantMatch === "PLAUSIBLE");
  if (!plausible.length) return { status: "no_reliable_price", min: null, max: null, eligibleOffers: 0, newestAt: null, newestAgeDays: null, stale: false, noteFa: "فقط پیشنهادهای نسخه‌ی نامطمئن دارد؛ قیمتی برای نسخه‌ی انتخابی نمایش داده نمی‌شود." };
  const eligible = plausible.filter((l) => l.comparisonEligible && l.priceToman !== null);
  if (!eligible.length) {
    const anyPrice = plausible.some((l) => l.priceToman !== null);
    return { status: "no_reliable_price", min: null, max: null, eligibleOffers: 0, newestAt: null, newestAgeDays: null, stale: false, noteFa: anyPrice ? "قیمت ثبت‌شده پرت یا نامعتبر است و قابل اتکا نیست." : "قیمتی برای این پیشنهاد ثبت نشده است." };
  }
  const prices = eligible.map((l) => l.priceToman as number);
  const dates = eligible.map((l) => l.priceChangedAt).filter((d): d is string => !!d).sort();
  const newestAt = dates.at(-1) ?? null;
  const ms = newestAt ? at.getTime() - Date.parse(newestAt) : NaN;
  return {
    status: "recorded", min: Math.min(...prices), max: Math.max(...prices), eligibleOffers: eligible.length, newestAt,
    newestAgeDays: Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null,
    stale: eligible.every((l) => l.flags.includes("TIMESTAMP_STALE")), noteFa: null,
  };
}

export function findSellersForProduct(db: DatabaseSync, input: FindSellersInput): SellersResponse | null {
  const rows = fetchProductRows(db, [input.productId]);
  const prod = rows.get(input.productId);
  if (!prod) return null;

  const raws = db
    .prepare(
      `SELECT o.offer_id, o.shop_id, o.seller_title, o.price_toman, o.price_toman_raw, o.unit_hint, o.model_keys, o.price_changed_at,
              (SELECT group_concat(code) FROM quality_flags f WHERE f.entity_type='offer' AND f.entity_id = o.offer_id) AS flags,
              s.name, s.address, s.location_label, s.lat, s.lon, s.hours_json, s.payment_json
       FROM offers o JOIN shops s ON s.shop_id = o.shop_id
       WHERE o.product_id = ? ORDER BY o.source_row LIMIT ${SELLERS_LIMITS.offerRowsMax}`,
    )
    .all(input.productId) as unknown as Raw[];

  const productKeys = prod.modelKeys ? prod.modelKeys.split(" ") : [];
  const { groups, assignment } = buildVariantGroups(productKeys, raws);
  const notices: string[] = [];
  const hasIdentityRisk = raws.some((r) => r.flags?.includes("VARIANT_MODEL_MISMATCH") || r.flags?.includes("UNIT_AMBIGUOUS"));
  const needsConfirmation = groups.length > 1 || hasIdentityRisk;
  let selected: VariantGroup | null = null;
  if (input.variantGroupId) {
    selected = groups.find((g) => g.id === input.variantGroupId) ?? null;
    if (!selected) notices.push("نسخه‌ی ذخیره‌شده در انتخاب شما دیگر در این محصول پیدا نشد؛ لطفاً دوباره انتخاب کنید.");
  }

  const filters: SellersFilters = {
    radiusMeters: Math.min(Math.max(Math.trunc(input.radiusMeters ?? 1000), 100), 50_000),
    showUncertain: !!input.showUncertain,
    sort: input.sort ?? "distance",
    openNow: !!input.openNow,
    reliablePriceOnly: !!input.reliablePriceOnly,
    paymentProvider: input.paymentProvider ?? null,
  };
  const pageSize = Math.min(Math.max(Math.trunc(input.pageSize ?? SELLERS_LIMITS.pageSizeDefault), 1), SELLERS_LIMITS.pageSizeMax);
  const page = Math.max(Math.trunc(input.page ?? 1), 1);
  const o = input.origin && isValidCoordinate(input.origin.lat, input.origin.lon) ? input.origin : null;
  if (input.origin && !o) notices.push("مختصات نقطه‌ی شروع معتبر نیست؛ فاصله محاسبه نشد.");
  if (o?.defaulted) notices.push(`نقطه‌ی شروع پیش‌فرض «${o.label ?? "فردوسی"}» است؛ آن را به محله‌ی خودتان تغییر دهید.`);
  const at = input.at ?? new Date();

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const sharedCoords = new Map<string, number>();
  for (const r of raws) if (r.lat !== null && r.lon !== null) sharedCoords.set(`${r.lat.toFixed(5)},${r.lon.toFixed(5)}`, 0);

  // ---- per shop aggregation (offers stay separate; shops are grouped)
  const byShop = new Map<string, { raw: Raw; lines: SellerOfferLine[] }>();
  for (const r of raws) {
    if (input.onlyShopId && r.shop_id !== input.onlyShopId) continue;
    if (r.lat === null || r.lon === null || !isValidCoordinate(r.lat, r.lon)) continue; // invalid coordinates can never become a pin
    const g = groupById.get(assignment.get(r.offer_id) ?? "");
    if (!g) continue;
    const cls = classifyOffer({ offerGroup: g, selected, needsConfirmation });
    const flags = r.flags ? r.flags.split(",") : [];
    const line: SellerOfferLine = {
      offerId: r.offer_id, sellerTitle: r.seller_title, variantMatch: cls.status, variantEvidence: cls.evidence, priceRaw: r.price_toman_raw, priceToman: r.price_toman,
      unitHint: r.unit_hint, priceChangedAt: r.price_changed_at, flags: flags.filter((f) => !!flagDef(f)),
      comparisonEligible: r.price_toman !== null && isComparisonEligible(flags.filter((f) => !IDENTITY_FLAGS.has(f))),
    };
    const e = byShop.get(r.shop_id) ?? { raw: r, lines: [] };
    e.lines.push(line);
    byShop.set(r.shop_id, e);
  }

  const visible = (l: SellerOfferLine) => l.variantMatch === "PLAUSIBLE" || filters.showUncertain;
  let hiddenUncertain = 0;
  let hiddenConflicting = 0;
  const all: SellerMatch[] = [];
  const hoursCache = (h: string): DeclaredHours => { try { return JSON.parse(h) as DeclaredHours; } catch { return NO_SCHEDULE; } };
  for (const [shopId, { raw, lines }] of byShop) {
    const shown = lines.filter(visible);
    if (!shown.length) {
      const worst = lines.reduce<VariantMatchStatus>((acc, l) => bestOf(acc, l.variantMatch), "CONFLICTING");
      if (worst === "CONFLICTING") hiddenConflicting++;
      else hiddenUncertain++;
      continue;
    }
    const providers = raw.payment_json ? (JSON.parse(raw.payment_json) as Array<{ providerName: string }>).map((p) => p.providerName) : [];
    const evalr = evaluateHours(hoursCache(raw.hours_json), at);
    const lat = raw.lat as number;
    const lon = raw.lon as number;
    all.push({
      shopId, name: raw.name, locationLabel: raw.location_label, address: raw.address, lat, lon,
      distanceMeters: o ? haversineMeters(o.lat, o.lon, lat, lon) : null,
      offerIds: shown.map((l) => l.offerId), offerCount: shown.length, plausibleOfferCount: shown.filter((l) => l.variantMatch === "PLAUSIBLE").length,
      hiddenOfferCount: lines.length - shown.length,
      variantMatchStatus: shown.reduce<VariantMatchStatus>((acc, l) => bestOf(acc, l.variantMatch), "CONFLICTING"),
      offers: shown,
      declaredSchedule: { status: evalr.status, atTehran: evalr.evidence.tehranTime },
      payment: { declared: providers.length > 0, providers },
      priceEvidence: priceEvidence(shown, at),
      locationEvidence: { source: "shops.csv lat/lon", sharedWithShops: 0, noteFa: "مختصات ثبت‌شده در داده؛ ممکن است در سطح پاساژ/ساختمان باشد، نه دقیقاً واحد فروشگاه." },
      stock: "unconfirmed",
    });
  }
  // shared coordinates (mall-level): count other matched shops sitting on the exact same point
  const coordCount = new Map<string, number>();
  for (const s of all) { const k = `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`; coordCount.set(k, (coordCount.get(k) ?? 0) + 1); }
  const globalShared = db.prepare("SELECT count(*) AS n FROM shops WHERE round(lat,5) = ? AND round(lon,5) = ?");
  for (const s of all) {
    const own = coordCount.get(`${s.lat.toFixed(5)},${s.lon.toFixed(5)}`) ?? 1;
    const total = Number((globalShared.get(Math.round(s.lat * 1e5) / 1e5, Math.round(s.lon * 1e5) / 1e5) as { n: number }).n);
    s.locationEvidence.sharedWithShops = Math.max(own, total) - 1;
  }

  const within = (s: SellerMatch) => (o ? (s.distanceMeters as number) <= filters.radiusMeters : true);
  const passes = (s: SellerMatch) =>
    (!filters.openNow || s.declaredSchedule.status.state === "open") &&
    (!filters.reliablePriceOnly || s.priceEvidence.status === "recorded") &&
    (!filters.paymentProvider || s.payment.providers.includes(filters.paymentProvider));

  const cmp = (a: SellerMatch, b: SellerMatch): number => {
    const tie = a.shopId.localeCompare(b.shopId);
    if (filters.sort === "price") return (a.priceEvidence.min ?? Infinity) - (b.priceEvidence.min ?? Infinity) || (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0) || tie;
    if (filters.sort === "recent") return (b.priceEvidence.newestAt ?? "").localeCompare(a.priceEvidence.newestAt ?? "") || (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0) || tie;
    return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.name.localeCompare(b.name) || tie;
  };

  const filtered = all.filter(passes);
  const inside = filtered.filter(within).sort(cmp);
  const outside = filtered.filter((s) => !within(s)).sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.shopId.localeCompare(b.shopId));
  const pageItems = inside.slice((page - 1) * pageSize, page * pageSize);

  const counts: SellersCounts = {
    shopsAnyVariant: byShop.size,
    shopsTotal: all.length,
    shopsWithinRadius: all.filter(within).length,
    shopsAfterFilters: inside.length,
    offersTotal: all.reduce((n, s) => n + s.offerCount, 0),
    offersWithinRadius: all.filter(within).reduce((n, s) => n + s.offerCount, 0),
    shopsHiddenUncertain: hiddenUncertain,
    shopsHiddenConflicting: hiddenConflicting,
  };

  // radius hints: which larger rings really contain more matches
  const radiusHints: SellersResponse["radiusHints"] = [];
  if (o) {
    let prev = inside.length;
    for (const r of RADIUS_OPTIONS) {
      if (r <= filters.radiusMeters) continue;
      const n = filtered.filter((s) => (s.distanceMeters as number) <= r).length;
      if (n > prev) { radiusHints.push({ radiusMeters: r, shops: n }); prev = n; }
    }
  }

  // coverage warning: no dataset shop within 5 km of the origin (says nothing about Tehran in general)
  let outsideDatasetCoverage = false;
  if (o) {
    const bb = boundingBox(o.lat, o.lon, 5000);
    const near = db.prepare("SELECT s.lat AS lat, s.lon AS lon FROM shop_geo g JOIN shops s ON s.rowid = g.id WHERE g.min_lat >= ? AND g.max_lat <= ? AND g.min_lon >= ? AND g.max_lon <= ? LIMIT 400").all(bb.minLat, bb.maxLat, bb.minLon, bb.maxLon) as Array<{ lat: number; lon: number }>;
    outsideDatasetCoverage = !near.some((p) => haversineMeters(o.lat, o.lon, p.lat, p.lon) <= 5000);
    if (outsideDatasetCoverage) notices.push("در داده‌ی هکاتون هیچ فروشگاهی تا ۵ کیلومتری این نقطه ثبت نشده؛ این به معنی نبود فروشگاه در آن منطقه‌ی تهران نیست، فقط داده‌ی ما آنجا را پوشش نمی‌دهد.");
  }

  let situation: SellersResponse["situation"] = "OK";
  if (!raws.length) situation = "NO_OFFERS";
  else if (needsConfirmation && !selected && !filters.showUncertain) situation = "VARIANT_UNCONFIRMED";
  else if (all.length === 0) situation = "NO_RELIABLE_VARIANT_MATCH";
  else if (o && inside.length === 0) situation = "NO_SHOP_IN_RADIUS";

  if (hiddenUncertain + hiddenConflicting > 0 && !filters.showUncertain) notices.push(`${new Intl.NumberFormat("fa-IR").format(hiddenUncertain + hiddenConflicting)} فروشگاه فقط پیشنهاد نسخه‌های نامطمئن یا متفاوت دارند و پنهان شده‌اند.`);

  const sparse = !input.onlyShopId && (situation !== "OK" || counts.shopsAfterFilters < 3);
  const areaLeads = sparse ? recommendShoppingAreas(db, { categoryHint: prod.categoryName, origin: o, limit: 3 }).areas : [];

  return {
    state: "MATCHED_OFFER_SELLERS",
    product: { id: prod.id, title: prod.title, categoryName: prod.categoryName, price: priceSummary(prod.ev) },
    variant: { needsConfirmation, selectedGroupId: selected?.id ?? null, groups, unresolved: needsConfirmation && (!selected || !selected.modelKey) },
    origin: o ? { source: o.source, lat: o.lat, lon: o.lon, label: o.label ?? null, defaulted: !!o.defaulted } : null,
    filters, sellers: pageItems, page, pageSize, hasMore: inside.length > page * pageSize, counts,
    outsideRadius: situation === "NO_SHOP_IN_RADIUS" || input.includeOutside ? outside.slice(0, SELLERS_LIMITS.outsideShown) : [],
    radiusHints, outsideDatasetCoverage, situation, notices, areaLeads,
    selection: { productId: prod.id, variantGroupId: selected?.id ?? null, unitHint: selected?.unitHint ?? null, priceStatus: (selected?.price ?? priceSummary(prod.ev)).status },
  };
}
