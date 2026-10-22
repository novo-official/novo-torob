import type { DatabaseSync } from "node:sqlite";
import { IDENTITY_EVIDENCE_FA, COMPARABILITY_FA } from "@/domain/comparison";
import type { ContextFact, InquiryContext, InquiryContextError, InquiryContextResult } from "@/domain/inquiry";
import { categoryProfile } from "@/domain/inquiry-questions";
import { buildAdvisorHref } from "@/lib/advisor-url";
import { buildCompareHref } from "@/lib/compare-url";
import { formatToman, toFaDigits } from "@/lib/format";
import { safeShopLink } from "@/lib/hours-table";
import { formatTehranDate } from "@/lib/seller-labels";
import { buildSellersHref, buildShopHref } from "@/lib/sellers-url";
import { compareSellersForProduct } from "@/server/compare/service";

const PRODUCT = /^product_[0-9a-f]{8,40}$/;
const SHOP = /^shop_[0-9a-f]{8,40}$/;
const OFFER = /^offer_[0-9a-f]{8,40}$/;
export const PSEUDONYM_NOTE = "نام فروشگاه در داده‌ی هکاتون برای حفظ حریم خصوصی مستعار است و ممکن است نام واقعی مغازه نباشد؛ نشانی و مختصات هم در سطح پاساژ/ساختمان‌اند.";

export interface ResolveInput { product: string | null; variant: string | null; shop: string | null; offer: string | null; visit?: string | null; now?: Date }

/**
 * THE single server-side source of truth for an inquiry: URL ids are untrusted; every fact (price, time, warranty, payment,
 * hours, identity tier) is re-read from the real DB through the Phase 5 comparison service. No phone/contact is ever read.
 */
export function resolveInquiryContext(db: DatabaseSync, input: ResolveInput): InquiryContextResult {
  const fail = (error: InquiryContextError, candidates?: Array<{ offerId: string; sellerTitle: string; tier: "A" | "B" | "C" | "D" }>): InquiryContextResult => ({
    ok: false, error, candidates,
    recovery: {
      sellersHref: input.product && PRODUCT.test(input.product) ? buildSellersHref({ product: input.product }) : "/sellers",
      compareHref: input.product && PRODUCT.test(input.product) ? buildCompareHref({ product: input.product }) : "/compare",
    },
  });
  const { product, shop, offer } = input;
  if (!product || !PRODUCT.test(product) || !shop || !SHOP.test(shop) || (offer && !OFFER.test(offer))) return fail("INVALID_ID");

  const shopRow = db.prepare("SELECT shop_id, name, location_label, address, lat, lon, website_url, instagram_url FROM shops WHERE shop_id = ?").get(shop) as
    | { shop_id: string; name: string; location_label: string | null; address: string | null; lat: number | null; lon: number | null; website_url: string | null; instagram_url: string | null }
    | undefined;
  if (!shopRow) return fail("SHOP_NOT_FOUND");
  const exists = db.prepare("SELECT 1 AS x FROM products WHERE product_id = ?").get(product);
  if (!exists) return fail("PRODUCT_NOT_FOUND");

  let offerId = offer;
  if (offerId) {
    const o = db.prepare("SELECT product_id, shop_id FROM offers WHERE offer_id = ?").get(offerId) as { product_id: string; shop_id: string } | undefined;
    if (!o) return fail("OFFER_NOT_FOUND");
    if (o.product_id !== product || o.shop_id !== shop) return fail("OFFER_MISMATCH"); // never show another shop's/product's offer as this one
  }

  const cmp = compareSellersForProduct(db, { productId: product, variantGroupId: input.variant, shopIds: [shop], visit: input.visit ?? null, now: input.now });
  if (!cmp) return fail("PRODUCT_NOT_FOUND");
  if (input.variant && !cmp.variant.groups.some((g) => g.id === input.variant)) return fail("VARIANT_UNKNOWN");
  const seller = cmp.sellers.find((s) => s.shopId === shop);
  if (!seller || seller.offers.length === 0) return fail("OFFER_NOT_FOUND");
  if (!offerId) {
    if (seller.offers.length > 1) return fail("OFFER_REQUIRED", seller.offers.map((x) => ({ offerId: x.identity.offerId, sellerTitle: x.identity.rawSellerTitle, tier: x.identity.tier })));
    offerId = seller.offers[0]!.identity.offerId;
  }
  const entry = seller.offers.find((x) => x.identity.offerId === offerId);
  if (!entry) return fail("OFFER_NOT_FOUND");

  const sel = cmp.variant.selected;
  const id = entry.identity;
  const pe = entry.price;
  const shared = (db.prepare("SELECT count(*) AS n FROM shops WHERE round(lat,5) = round(?,5) AND round(lon,5) = round(?,5) AND shop_id != ?").get(shopRow.lat ?? 0, shopRow.lon ?? 0, shop) as { n: number }).n;
  const httpsOnly = (l: { href: string; label: string } | null) => (l && l.href.startsWith("https://") ? l : null);
  const recordedAtLabel = pe.recordedAtKnown ? `ثبت‌شده در ${formatTehranDate(pe.recordedAt)}` : null;
  const outside = !!sel && id.variantGroupId !== sel.id;

  const unknownsFa = [
    "موجودی فیزیکی (هیچ‌وقت از داده تأیید نمی‌شود)",
    "قیمت امروز (قیمت ثبت‌شده فقط زمان ثبت داده را نشان می‌دهد)",
    ...(id.tier !== "A" || outside || cmp.variant.needsConfirmation ? ["مدل/نسخه‌ی دقیق (از روی عنوان فروشنده حدس زده شده)"] : []),
    ...(entry.warranty.kind === "UNKNOWN" ? ["گارانتی (ثبت نشده؛ نبودنش نیست)"] : []),
    ...(seller.payment.bucket !== "IN_PERSON_DECLARED" ? ["پرداخت حضوری/اقساط برای این کالا"] : []),
    ...(seller.hours.state === "UNKNOWN" ? ["ساعت کاری"] : []),
  ];
  const facts: ContextFact[] = [
    { key: "price", labelFa: "قیمت ثبت‌شده", valueFa: pe.priceToman !== null ? `${formatToman(pe.priceToman)}${recordedAtLabel ? ` · ${recordedAtLabel}` : ""}` : "قیمتی ثبت نشده", provenance: pe.priceToman !== null ? "DATASET_RECORDED" : "UNKNOWN", noteFa: `${COMPARABILITY_FA[pe.comparability]}${pe.ageDaysToday !== null ? ` · ${toFaDigits(pe.ageDaysToday)} روز پیش از امروز` : ""}` },
    { key: "warranty", labelFa: "گارانتی", valueFa: entry.warranty.labelFa, provenance: entry.warranty.kind === "UNKNOWN" ? "UNKNOWN" : "DATASET_RECORDED" },
    { key: "payment", labelFa: "پرداخت", valueFa: seller.payment.labelFa, provenance: seller.payment.declared ? "DATASET_RECORDED" : "UNKNOWN" },
    { key: "hours", labelFa: "ساعت در زمان بازدید", valueFa: seller.hours.labelFa, provenance: seller.hours.state === "UNKNOWN" ? "UNKNOWN" : "DATASET_RECORDED", noteFa: "طبق اعلام فروشگاه؛ باز بودن واقعی تأییدشده نیست" },
    { key: "stock", labelFa: "موجودی", valueFa: "تأییدنشده", provenance: "UNKNOWN" },
  ];

  const context: InquiryContext = {
    product: { id: product, title: cmp.product!.title, categoryName: cmp.product!.categoryName, productHref: `/products/${product}${sel ? `?variant=${encodeURIComponent(sel.id)}` : ""}` },
    variant: { selectedGroupId: sel?.id ?? null, label: sel?.label ?? null, modelKey: sel?.modelKey ?? null, unitHint: sel?.unitHint ?? id.unitHint, needsConfirmation: cmp.variant.needsConfirmation },
    shop: {
      id: shop, name: shopRow.name, locationLabel: shopRow.location_label, address: shopRow.address, pseudonymNoteFa: PSEUDONYM_NOTE, sharedCoordinates: shared,
      website: httpsOnly(safeShopLink("website", shopRow.website_url)), instagram: httpsOnly(safeShopLink("instagram", shopRow.instagram_url)),
      shopHref: buildShopHref(shop, { product, variant: sel?.id ?? null }),
    },
    offer: {
      id: id.offerId, sellerTitle: id.rawSellerTitle, priceToman: pe.priceToman, priceRaw: pe.priceRaw, recordedAt: pe.recordedAt, recordedAtLabel, ageDaysToday: pe.ageDaysToday,
      unitHint: id.unitHint, packQuantity: id.packQuantity?.value ?? null, tier: id.tier, identityEvidenceFa: id.evidence.map((e) => IDENTITY_EVIDENCE_FA[e]), comparabilityFa: COMPARABILITY_FA[pe.comparability],
      warranty: entry.warranty, flags: pe.flags, outsideSelectedVariant: outside,
    },
    otherOffersOfShop: seller.offers.filter((x) => x.identity.offerId !== id.offerId).map((x) => ({ offerId: x.identity.offerId, sellerTitle: x.identity.rawSellerTitle, tier: x.identity.tier })),
    payment: seller.payment, hours: seller.hours,
    visit: { atTehran: cmp.criteria.visitAtTehran, isNow: cmp.criteria.visitIsNow, input: input.visit && !cmp.criteria.visitIsNow ? input.visit : null },
    category: categoryProfile(cmp.product!.categoryName), facts, unknownsFa,
    routes: {
      sellersHref: buildSellersHref({ product, variant: sel?.id ?? null }),
      compareHref: buildCompareHref({ product, variant: sel?.id ?? null, shops: [shop] }),
      discoverHref: buildAdvisorHref({ category: cmp.product!.categoryName }),
    },
    contactChannel: "NONE_VERIFIED",
  };
  return { ok: true, context };
}
