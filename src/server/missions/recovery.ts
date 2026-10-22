import type { DatabaseSync } from "node:sqlite";
import type { DeclaredHours } from "@/domain/types";
import { COMPARABILITY_FA, type SellerComparisonResult } from "@/domain/comparison";
import type { RecoveryTrigger } from "@/domain/mission";
import { RECOVERY_TRIGGER_FA } from "@/domain/mission";
import type { BudgetScenario, NextInterval, RecoveryArea, RecoveryFact, RecoveryProduct, RecoveryResult, RecoverySeller, RecoveryVariant } from "@/domain/mission-recovery";
import { buildAdvisorHref } from "@/lib/advisor-url";
import { buildCompareHref } from "@/lib/compare-url";
import { formatToman, toFaDigits } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { buildSellersHref, buildShopHref, ORIGIN_KEYS, type OriginKey } from "@/lib/sellers-url";
import { adviseProducts } from "@/server/advisor/engine";
import { recommendShoppingAreas } from "@/server/areas/recommend";
import { compareSellersForProduct } from "@/server/compare/service";
import { parseTehranLocal } from "@/server/compare/time";
import { NO_SCHEDULE, evaluateHours, toTehranLocal } from "@/server/domain/hours";
import { resolveInquiryContext } from "@/server/inquiry/context";
import { resolveOrigin } from "@/server/sellers/origins";
import { findSellersForProduct } from "@/server/sellers/find";

export interface RecoveryInput {
  trigger: RecoveryTrigger;
  productId: string; variantGroupId: string | null; shopId: string; offerId: string | null;
  district: string | null; radius: number; budget: { min: number | null; max: number | null };
  visit: string | null; reportedPriceToman: number | null; now?: Date;
}

const MAX_ALT = 4;
const originKey = (d: string | null): OriginKey | null => ((ORIGIN_KEYS as readonly string[]).includes(d ?? "") ? (d as OriginKey) : null);
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;

function shopHours(db: DatabaseSync, shopId: string): DeclaredHours {
  const r = db.prepare("SELECT hours_json FROM shops WHERE shop_id = ?").get(shopId) as { hours_json: string } | undefined;
  try { return r ? (JSON.parse(r.hours_json) as DeclaredHours) : NO_SCHEDULE; } catch { return NO_SCHEDULE; }
}

/** next DECLARED opening after the visit instant; null when the schedule is unknown/unsupported (never guessed, no holidays inferred) */
export function nextDeclaredOpening(hours: DeclaredHours, visitAt: Date): NextInterval | null {
  const ev = evaluateHours(hours, visitAt);
  if (ev.status.state !== "closed" || ev.status.nextChange?.to !== "open") return null;
  const at = toTehranLocal(new Date(ev.status.nextChange.at)).iso.slice(0, 16);
  return { atTehran: at, labelFa: `نخستین بازه‌ی اعلام‌شده‌ی بعدی: ${toFaDigits(at.replace("T", " "))} (به وقت تهران؛ طبق اعلام فروشگاه، نه تضمین باز بودن)` };
}

/**
 * Deterministic replanning (no model, no network). Everything it returns is an id-backed dataset record or a plain statement about one.
 * The user's report (price / stock / model) is shown as USER_REPORTED and NEVER written back to a record or used to rank the catalog.
 */
export function planRecovery(db: DatabaseSync, input: RecoveryInput): RecoveryResult {
  const now = input.now ?? new Date();
  const ctxR = resolveInquiryContext(db, { product: input.productId, variant: input.variantGroupId, shop: input.shopId, offer: input.offerId, visit: input.visit, now });
  if (!ctxR.ok) return { ok: false, error: ctxR.error };
  const ctx = ctxR.context;
  const visitAt = parseTehranLocal(input.visit) ?? now;
  const origin = resolveOrigin(db, { preset: input.district });
  const budgetMax = input.budget.max;
  const P0 = ctx.offer.priceToman;
  const R = input.reportedPriceToman;
  const coverageFa: string[] = [];
  const notesFa: string[] = [];

  // ---- alternatives: REAL offers of the SAME selected variant at OTHER shops
  const find = findSellersForProduct(db, { productId: input.productId, variantGroupId: ctx.variant.selectedGroupId, origin, radiusMeters: input.radius, pageSize: 12, includeOutside: true, at: now });
  const pool = find ? [...find.sellers, ...find.outsideRadius].filter((s) => s.shopId !== input.shopId && s.variantMatchStatus === "PLAUSIBLE") : [];
  const ids = [...new Set(pool.map((s) => s.shopId))].slice(0, 8);
  let rows: SellerComparisonResult[] = [];
  let groups: RecoveryVariant[] = [];
  if (ids.length) {
    const cmp = compareSellersForProduct(db, { productId: input.productId, variantGroupId: ctx.variant.selectedGroupId, shopIds: ids.slice(0, 4), origin, radiusMeters: input.radius, visit: input.visit, budget: input.budget, priority: "price", now });
    if (cmp) rows = cmp.sellers.filter((s) => s.representative && (s.tier === "A" || s.tier === "B"));
  }
  const ranked = [...rows].sort((a, b) => scoreFor(input.trigger, a) - scoreFor(input.trigger, b) || (a.distanceMeters ?? 1e9) - (b.distanceMeters ?? 1e9) || a.shopId.localeCompare(b.shopId)).slice(0, MAX_ALT);
  const sellers: RecoverySeller[] = ranked.map((s): RecoverySeller => {
    const rep = s.representative!;
    const price = s.price.priceToman;
    const t: string[] = [];
    if (price !== null && P0 !== null) t.push(price === P0 ? "قیمت ثبت‌شده برابر پیشنهاد فعلی است." : `قیمت ثبت‌شده ${formatToman(Math.abs(price - P0))} ${price > P0 ? "بیشتر" : "کمتر"} از پیشنهاد فعلی است (${toFaDigits(Math.abs(pct(price, P0)))}٪؛ هر دو قیمت ثبت‌شده‌اند، نه امروز).`);
    else if (price === null) t.push("قیمت قابل‌اتکایی ثبت نشده؛ نیاز به استعلام.");
    t.push(s.distanceMeters !== null ? `حدود ${formatDistance(s.distanceMeters)} (خط مستقیم، نه مسیر).` : "فاصله نامعلوم.");
    t.push(s.hours.state === "WITHIN_DECLARED" ? "در زمان مراجعه داخل ساعت اعلام‌شده است." : s.hours.state === "OUTSIDE_DECLARED" ? "در زمان مراجعه خارج از ساعت اعلام‌شده است." : "ساعت کاری برای این زمان نامعلوم است.");
    if (s.tier === "B") t.push("هم‌نسخه بودن فقط احتمالی است؛ مدل دقیق را بپرسید.");
    if (s.budget === "OVER") t.push("قیمت ثبت‌شده بیش از بودجه است."); else if (s.budget === "WITHIN") t.push("قیمت ثبت‌شده داخل بودجه است.");
    return {
      shopId: s.shopId, offerId: rep.offerId, name: s.name, locationLabel: s.locationLabel, distanceMeters: s.distanceMeters, tier: s.tier, priceToman: price,
      priceNoteFa: `${COMPARABILITY_FA[s.price.comparability]}${s.price.ageDaysToday !== null ? ` · ${toFaDigits(s.price.ageDaysToday)} روز پیش از امروز` : ""}`,
      hoursState: s.hours.state, hoursLabelFa: s.hours.labelFa, budget: s.budget, paymentLabelFa: s.payment.labelFa, warrantyLabelFa: s.warranty.labelFa, tradeoffsFa: t,
      hrefs: { shop: buildShopHref(s.shopId, { product: input.productId, variant: ctx.variant.selectedGroupId }) },
    };
  });
  if (!find) coverageFa.push("محصول در داده پیدا نشد.");
  else {
    coverageFa.push(`${toFaDigits(find.counts.shopsAnyVariant)} فروشگاه در نمونه‌ی داده برای این محصول پیشنهاد ثبت‌شده دارند (همه‌ی نسخه‌ها).`);
    if (!pool.length) coverageFa.push("فروشگاه دیگری با پیشنهاد هم‌نسخه (احتمالاً) در این نمونه‌ی انتخابی پیدا نشد؛ این به معنی نبودن کالا در بازار تهران نیست.");
  }
  if (find?.outsideDatasetCoverage) coverageFa.push("نقطه‌ی شروع از فروشگاه‌های نمونه دور است.");

  // ---- other versions of the same product (WRONG_MODEL) — never attached silently
  if (input.trigger === "WRONG_MODEL" && find) {
    groups = find.variant.groups.filter((g) => g.id !== ctx.variant.selectedGroupId).slice(0, 4).map((g): RecoveryVariant => ({ groupId: g.id, label: g.label, offerCount: g.offerCount, href: `/products/${input.productId}?variant=${encodeURIComponent(g.id)}` }));
  }

  // ---- other products of the SAME category and budget
  let products: RecoveryProduct[] = [];
  if (input.trigger === "UNAVAILABLE" || input.trigger === "WRONG_MODEL" || input.trigger === "PRICE_CHANGED" || !sellers.length) {
    const adv = adviseProducts(db, { category: ctx.product.categoryName, budget: input.budget, show: true, limit: 8, offset: 0 });
    products = adv.candidates.filter((c) => c.card.id !== input.productId && c.card.distinctSellers > 0).slice(0, 3).map((c): RecoveryProduct => ({
      productId: c.card.id, title: c.card.title, priceText: c.card.price.status === "reliable" && c.card.price.min !== null ? `از ${formatToman(c.card.price.min)} (ثبت‌شده)` : "قیمت قابل‌اتکا ثبت نشده", distinctSellers: c.card.distinctSellers, sameCategory: true, href: `/products/${c.card.id}`,
    }));
  }

  // ---- district fallback only when real same-variant sellers are absent/thin
  let areas: RecoveryArea[] = [];
  if (sellers.length < 2) {
    const r = recommendShoppingAreas(db, { categoryHint: ctx.product.categoryName, origin: { lat: origin.lat, lon: origin.lon }, limit: 3 });
    areas = r.areas.map((x): RecoveryArea => ({
      areaId: x.area.id, nameFa: x.area.nameFa, geoType: x.area.sourceType === "curated_external" ? "VERIFIED_SHOPPING_DISTRICT" : "DATASET_DENSITY_ESTIMATE", reasonFa: x.area.recommendationReasonFa,
      confidenceFa: x.area.confidence === "high" ? "اطمینان بالا" : x.area.confidence === "medium" ? "اطمینان متوسط" : "اطمینان کم",
      sourcesFa: x.area.sourceType === "curated_external" ? `${toFaDigits(x.area.sources.length)} منبع بررسی‌شده` : "از تراکم داده‌ی هکاتون", verifiedAt: x.area.verifiedAt, distanceMeters: x.distanceMeters,
      mapHref: `/sellers?category=${encodeURIComponent(r.category ?? ctx.product.categoryName)}`,
    }));
    if (areas.length) notesFa.push("منطقه‌ی خرید فقط جای گشتن است؛ فروشنده، پیشنهاد یا موجودی نیست.");
  }

  // ---- hours
  let nextInterval: NextInterval | null = null;
  if (input.trigger === "OUTSIDE_HOURS" || ctx.hours.state === "OUTSIDE_DECLARED") {
    nextInterval = nextDeclaredOpening(shopHours(db, input.shopId), visitAt);
    if (!nextInterval) notesFa.push("بازه‌ی اعلام‌شده‌ی بعدی را نمی‌توان محاسبه کرد؛ حدس نمی‌زنیم. تعطیلات رسمی هم در محاسبه نیست.");
  }
  if (ctx.hours.state === "UNKNOWN") notesFa.push("ساعت کاری این فروشگاه برای زمان انتخابی نامعلوم است؛ بسته حساب نشده و باز هم تضمین نیست.");

  // ---- price scenario (the dataset record is NEVER changed)
  let budgetScenario: BudgetScenario | null = null;
  if (input.trigger === "PRICE_CHANGED" || R !== null) {
    const fit = (x: number | null): "WITHIN" | "OVER" | "UNKNOWN" => (x === null || budgetMax === null ? "UNKNOWN" : x <= budgetMax ? "WITHIN" : "OVER");
    const within = sellers.filter((s) => s.priceToman !== null && budgetMax !== null && s.priceToman <= budgetMax).length;
    budgetScenario = {
      recordedToman: P0, reportedToman: R, deltaToman: R !== null && P0 !== null ? R - P0 : null, deltaPct: R !== null && P0 !== null && P0 > 0 ? pct(R, P0) : null, budgetMaxToman: budgetMax,
      fitRecorded: fit(P0), fitReported: fit(R), overByToman: R !== null && budgetMax !== null && R > budgetMax ? R - budgetMax : null, alternativesWithinBudget: within,
    };
    notesFa.push("قیمت گزارش‌شده‌ی شما تأییدنشده است و قیمت ثبت‌شده‌ی دیتاست را عوض نمی‌کند؛ فقط به‌عنوان سناریوی بودجه سنجیده شد.");
  }

  const facts: RecoveryFact[] = [
    { labelFa: "قیمت ثبت‌شده‌ی پیشنهاد فعلی", valueFa: P0 !== null ? `${formatToman(P0)}${ctx.offer.recordedAtLabel ? ` · ${ctx.offer.recordedAtLabel}` : ""}` : "قیمتی ثبت نشده", provenance: P0 !== null ? "DATASET_RECORDED" : "UNKNOWN" },
    { labelFa: "ساعت اعلام‌شده در زمان مراجعه", valueFa: ctx.hours.labelFa, provenance: ctx.hours.state === "UNKNOWN" ? "UNKNOWN" : "DATASET_RECORDED" },
    { labelFa: "هویت نسخه (حدس الگوریتمی)", valueFa: `سطح ${ctx.offer.tier}${ctx.offer.outsideSelectedVariant ? " — خارج از نسخه‌ی انتخابی" : ""}`, provenance: "DATASET_RECORDED" },
    { labelFa: "موجودی", valueFa: input.trigger === "UNAVAILABLE" ? "طبق گزارش شما موجود نیست (تأییدنشده)" : "تأییدنشده", provenance: input.trigger === "UNAVAILABLE" ? "USER_REPORTED" : "UNKNOWN" },
    ...(R !== null ? [{ labelFa: "قیمتی که فروشنده گفته (گزارش شما)", valueFa: formatToman(R) ?? "—", provenance: "USER_REPORTED" as const }] : []),
    { labelFa: "پرداخت و گارانتی ثبت‌شده", valueFa: `${ctx.payment.labelFa} · ${ctx.offer.warranty.labelFa}`, provenance: ctx.payment.declared || ctx.offer.warranty.kind !== "UNKNOWN" ? "DATASET_RECORDED" : "UNKNOWN" },
  ];
  notesFa.push(`دلیل بازیابی: ${RECOVERY_TRIGGER_FA[input.trigger]}.`);

  const shopIdsForCompare = [input.shopId, ...sellers.map((s) => s.shopId)];
  return {
    ok: true,
    plan: {
      trigger: input.trigger, facts, sellers, variants: groups, products, areas, nextInterval, budgetScenario, coverageFa, notesFa,
      hrefs: {
        sellers: buildSellersHref({ product: input.productId, variant: ctx.variant.selectedGroupId, origin: originKey(input.district), radius: input.radius, bmin: input.budget.min, bmax: input.budget.max }),
        compare: buildCompareHref({ product: input.productId, variant: ctx.variant.selectedGroupId, shops: shopIdsForCompare.slice(0, 4), origin: originKey(input.district), radius: input.radius, bmin: input.budget.min, bmax: input.budget.max, visit: input.visit }),
        product: ctx.product.productHref, discover: buildAdvisorHref({ category: ctx.product.categoryName }),
      },
    },
  };
}

/** lower = better for the given trigger (a stable, explainable ordering; ties fall back to distance) */
function scoreFor(trigger: RecoveryTrigger, s: SellerComparisonResult): number {
  const hours = s.hours.state === "WITHIN_DECLARED" ? 0 : s.hours.state === "UNKNOWN" ? 1 : 2;
  const pay = s.payment.bucket === "IN_PERSON_DECLARED" ? 0 : s.payment.bucket === "DECLARED_CHANNEL_UNKNOWN" ? 1 : 2;
  const war = s.warranty.kind === "MONTHS" ? 0 : s.warranty.kind === "UNKNOWN" ? 1 : 2;
  const budget = s.budget === "WITHIN" || s.budget === "NOT_SET" ? 0 : s.budget === "UNKNOWN" ? 1 : 2;
  const tier = s.tier === "A" ? 0 : 1;
  switch (trigger) {
    case "OUTSIDE_HOURS": return hours * 10 + tier;
    case "PAYMENT_WARRANTY": return pay * 10 + war * 3 + tier;
    case "PRICE_CHANGED": return budget * 10 + tier;
    default: return tier * 10 + hours;
  }
}
