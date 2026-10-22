import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AreaRecommendation } from "@/domain/shopping-area";
import type { SellerMatch } from "@/domain/sellers";
import { AreaLeadCard } from "./area-lead-card";
import { SellerCard } from "./seller-card";

const seller = (over: Partial<SellerMatch> = {}): SellerMatch => ({
  shopId: "shop_abc12345", name: "فروشگاه نمونه", locationLabel: "فردوسی", address: "تهران، خیابان فردوسی", lat: 35.692, lon: 51.4225, distanceMeters: 754,
  offerIds: ["offer_1"], offerCount: 1, plausibleOfferCount: 1, hiddenOfferCount: 0, variantMatchStatus: "PLAUSIBLE",
  offers: [{ offerId: "offer_1", sellerTitle: "شارژر ۲۰ وات", variantMatch: "PLAUSIBLE", variantEvidence: "product_id_only", priceRaw: "2000000", priceToman: 2_000_000, unitHint: "unknown", priceChangedAt: "2026-10-07T10:00:00Z", flags: [], comparisonEligible: true }],
  declaredSchedule: { status: { state: "unknown", declared: true, reasonCode: "NO_SCHEDULE" }, atTehran: "2026-10-22T12:00:00+03:30" },
  payment: { declared: false, providers: [] },
  priceEvidence: { status: "recorded", min: 2_000_000, max: 2_000_000, eligibleOffers: 1, newestAt: "2026-10-07T10:00:00Z", newestAgeDays: 15, stale: false, noteFa: null },
  locationEvidence: { source: "shops.csv lat/lon", sharedWithShops: 0, noteFa: "مختصات ثبت‌شده در داده؛ ممکن است در سطح پاساژ/ساختمان باشد." },
  stock: "unconfirmed", ...over,
});
const CARD = { detailHref: "/shops/shop_abc12345", handoffHref: "/compare?product=p&shop=shop_abc12345", selected: false } as const;

describe("SellerCard honesty", () => {
  it("shows distance as straight-line, recorded price with its date, unconfirmed stock — and NO phone / tel: link", () => {
    const { container } = render(<ul><SellerCard seller={seller()} {...CARD} /></ul>);
    expect(screen.getByTestId("distance").textContent).toMatch(/متر/);
    expect(screen.getByText(/قیمت ثبت‌شده در داده، نه قیمت امروز/)).toBeTruthy();
    expect(screen.getByText("موجودی تأییدنشده")).toBeTruthy();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.textContent).not.toMatch(/[۰-۹]+\s*(دقیقه|ساعت)|زمان (پیاده|رانندگی)|با ماشین/); // only the explicit "not a route" disclaimer may mention walking
    expect(container.textContent).not.toMatch(/\b09\d{9}\b/);
  });
  it("unknown hours are labelled as not declared — never 'closed'", () => {
    render(<ul><SellerCard seller={seller()} {...CARD} /></ul>);
    expect(screen.getByText("ساعت کاری اعلام نشده")).toBeTruthy();
    expect(screen.queryByText(/^بسته/)).toBeNull();
  });
  it("uncertain variants carry an explicit warning; conflicting ones are red-flagged", () => {
    const { rerender } = render(<ul><SellerCard seller={seller({ variantMatchStatus: "UNCERTAIN" })} {...CARD} /></ul>);
    expect(screen.getByText(/نسخه‌ی نامطمئن/)).toBeTruthy();
    rerender(<ul><SellerCard seller={seller({ variantMatchStatus: "CONFLICTING" })} {...CARD} /></ul>);
    expect(screen.getByText(/نسخه‌ی متفاوت/)).toBeTruthy();
  });
  it("a shop without a reliable price shows the reason instead of a number", () => {
    render(<ul><SellerCard seller={seller({ priceEvidence: { status: "no_reliable_price", min: null, max: null, eligibleOffers: 0, newestAt: null, newestAgeDays: null, stale: false, noteFa: "قیمتی برای این پیشنهاد ثبت نشده است." } })} {...CARD} /></ul>);
    expect(screen.getByText("قیمتی برای این پیشنهاد ثبت نشده است.")).toBeTruthy();
  });
  it("stale price and mall-level shared coordinates are called out", () => {
    render(<ul><SellerCard seller={seller({ priceEvidence: { ...seller().priceEvidence, stale: true }, locationEvidence: { ...seller().locationEvidence, sharedWithShops: 3 } })} {...CARD} /></ul>);
    expect(screen.getByText(/قیمت قدیمی/)).toBeTruthy();
    expect(screen.getByText(/فروشگاه با مختصات یکسان/)).toBeTruthy();
  });
  it("offers inside one card stay separate and hidden variants are counted, not merged", () => {
    const two = seller({ offerCount: 2, hiddenOfferCount: 1, offers: [seller().offers[0]!, { ...seller().offers[0]!, offerId: "offer_2", sellerTitle: "شارژر ۳۰ وات" }] });
    const { container } = render(<ul><SellerCard seller={two} {...CARD} /></ul>);
    expect(within(container).getByText("۲ پیشنهاد")).toBeTruthy();
    expect(container.textContent).toMatch(/۱ پیشنهاد دیگر از این فروشگاه برای نسخه‌های دیگر/);
  });
  it("hand-off link goes to the Phase 5 route and the external map link only carries the DESTINATION", () => {
    const { container } = render(<ul><SellerCard seller={seller()} {...CARD} /></ul>);
    expect(container.querySelector('a[href^="/compare?"]')).toBeTruthy();
    const osm = container.querySelector('a[href^="https://www.openstreetmap.org/"]') as HTMLAnchorElement;
    expect(osm.rel).toContain("noopener");
    expect(osm.href).toContain("mlat=35.692");
  });
});

const area = (over: Partial<AreaRecommendation["area"]> = {}): AreaRecommendation => ({
  area: {
    id: "curated-x", nameFa: "پاساژ نمونه", kind: "mall", center: { lat: 35.695, lon: 51.4118 }, coordinateBasisFa: "گره‌ی OSM", areaLabelFa: "بازار تهران", categoryTags: ["x"],
    recommendationReasonFa: "بورس موبایل", sourceType: "curated_external", verifiedAt: "2026-10-22", confidence: "medium", disclaimerFa: "این یک سرنخ جغرافیایی است، نه موجودی.",
    sources: [{ supports: "claim", title: "گزارش", publisher: "ناشر", url: "https://example.ir/a", publishedAt: "2026-01-01", quote: "نقل" }, { supports: "coordinates", title: "نقشه", publisher: "OSM", url: "https://www.openstreetmap.org/node/1" }], ...over,
  },
  distanceMeters: 900, evidence: [{ textFa: "منبع می‌گوید بورس موبایل است", source: "source_ref" }], inference: [{ textFa: "دسته‌ی پاوربانک از موبایل برداشت شد" }], matchedCategories: ["x"], density: null,
});

describe("AreaLeadCard (SHOPPING_DISTRICT_SUGGESTION)", () => {
  it("says it is NOT a seller, separates evidence from inference, lists sources with dates and a disclaimer", () => {
    const { container } = render(<ul><AreaLeadCard rec={area()} /></ul>);
    expect(screen.getByText("پیشنهاد منطقه — فروشنده نیست")).toBeTruthy();
    expect(screen.getByText(/شواهد \(قابل‌ردیابی\)/)).toBeTruthy();
    expect(screen.getByText(/برداشت سیستم \(استنباط\)/)).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="area-sources"] a').length).toBe(2);
    expect(container.textContent).toMatch(/بررسی منابع:/);
    expect(container.textContent).toMatch(/نه موجودی/);
  });
  it("dataset-density areas are labelled as estimates with low confidence", () => {
    render(<ul><AreaLeadCard rec={{ ...area({ sourceType: "dataset_category_density", confidence: "low", sources: [{ supports: "dataset", title: "داده", publisher: "هکاتون", dataset: { files: ["shops.csv"], fields: ["category_names"] } }] }), density: { shopsListing: 12, shopsWithOffers: 7 } }} /></ul>);
    expect(screen.getByText(/برآورد از داده/)).toBeTruthy();
    expect(screen.getByText(/۱۲ فروشگاه این دسته را اعلام کرده‌اند/)).toBeTruthy();
  });
});
