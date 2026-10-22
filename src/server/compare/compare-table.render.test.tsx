import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { VariantGroup } from "@/domain/advisor";
import { compareSellers, type EngineSeller } from "./engine";
import type { EngineOffer } from "./identity";
import { parseWeeklyHours } from "@/server/domain/hours";
import { CompareTable } from "@/components/compare/compare-table";

const G = { id: "unknown|HDW1200", label: "g", unitHint: "unknown", modelKey: "HDW1200", offerCount: 3, eligibleOffers: 3, sampleTitle: "t", flags: [], price: { status: "reliable", label: "", min: null, median: null, max: null, reliableCount: 0, unitHint: null, staleShare: null, spreadRatio: null, pricedOffers: 0, totalOffers: 0, excluded: {} } } as VariantGroup;
let n = 0;
const offer = (shopId: string, price: number | null, over: Partial<EngineOffer> = {}): EngineOffer => ({ offerId: `offer_${shopId}${++n}`, productId: "product_x", shopId, sellerTitle: "دوربین HDW1200", priceToman: price, priceRaw: price === null ? null : String(price), priceOutOfRange: false, priceChangedAt: "2026-10-10T08:00:00Z", unitHint: "unknown", modelKeys: ["HDW1200"], flags: [], groupId: G.id, sourceRow: n, warranty: { months: 12, provider: "شرکتی", description: null }, ...over });
const seller = (id: string, offers: EngineOffer[], over: Partial<EngineSeller> = {}): EngineSeller => ({ shopId: id, name: `فروشگاه-${id}`, locationLabel: "فردوسی", lat: 35.692, lon: 51.4225, hours: parseWeeklyHours(null).hours, payment: [{ providerName: "ترب‌پی", channel: "unknown" }], offers, ...over });

const data = compareSellers({
  product: { id: "product_x", title: "دوربین", categoryName: "c" }, groups: [G], selected: G, needsConfirmation: false,
  sellers: [seller("a", [offer("a", 4_100_000)]), seller("b", [offer("b", 4_200_000)]), seller("c", [offer("c", null, { flags: ["NULL_PRICE"], priceChangedAt: null })]), seller("d", [offer("d", 50_000, { groupId: "per_metre|X", unitHint: "per_metre" })])],
  peerPrices: [], snapshotRef: "2026-10-13T00:00:00Z", now: new Date("2026-10-22T09:00:00Z"), visitAt: new Date("2026-10-22T09:00:00Z"), visitIsNow: true,
  origin: { source: "manual", lat: 35.6921, lon: 51.4225, label: "فردوسی" }, radiusMeters: 1000, budget: { min: null, max: 4_150_000 }, strictBudget: false, priority: "price", requestedShopIds: ["a", "b", "c", "d"], candidates: [], notices: [],
});

const ui = () => render(<CompareTable data={data} shopHref={(s) => `/shops/${s.shopId}`} missionHref={(s) => `/missions/new?shop=${s.shopId}`} removeHref={(s) => `/compare?without=${s.shopId}`} />);

describe("CompareTable", () => {
  it("one column per seller, ranked ones first, mismatched ones marked 'بدون رتبه'", () => {
    ui();
    const cols = screen.getAllByTestId("compare-col");
    expect(cols).toHaveLength(4);
    expect(cols.map((c) => c.getAttribute("data-shop-id"))).toEqual(["a", "b", "c", "d"]);
    expect(within(cols[0]!).getByTestId("rank-badge")).toHaveTextContent("رتبه‌ی ۱");
    expect(within(cols[3]!).getByTestId("rank-badge")).toHaveTextContent("بدون رتبه");
  });
  it("shows the raw price string, unknown price (not zero), and the incomparable unit seller's price flagged as not comparable", () => {
    const { container } = ui();
    expect(container.textContent).toContain("raw: 4100000");
    expect(screen.getByText("قیمتی ثبت نشده")).toBeInTheDocument();
    expect(screen.getByText("زمان ثبت قیمت نامعلوم")).toBeInTheDocument();
    expect(container.textContent).toContain("با سایر پیشنهادها هم‌واحد/هم‌مدل نیست");
    expect(container.textContent).not.toMatch(/(^|[^۰-۹٬])۰ تومان/);
  });
  it("budget row distinguishes within / over / unknown / not comparable", () => {
    ui();
    const row = screen.getByTestId("row-budget");
    for (const t of ["داخل بودجه", "بیش از بودجه", "نسبت به بودجه نامعلوم", "با بودجه سنجیده نمی‌شود"]) expect(row).toHaveTextContent(t);
  });
  it("hours are 'declared' only; payment shows the unknown channel as unknown; warranty from the offer", () => {
    ui();
    expect(screen.getByTestId("row-hours").textContent).toMatch(/ساعت کاری اعلام نشده/);
    expect(screen.getByTestId("row-hours").textContent).not.toMatch(/بسته است|باز است/);
    expect(screen.getByTestId("row-payment").textContent).toContain("کانال نامعلوم");
    expect(screen.getByTestId("row-warranty").textContent).toContain("گارانتی ۱۲ ماهه");
  });
  it("distance is straight-line and never a travel time; no tap-to-call, every action is a plain link, inquiry is manual", () => {
    const { container } = ui();
    expect(screen.getByTestId("row-distance")).toHaveTextContent("نه زمان پیاده‌روی یا رانندگی");
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(screen.getAllByTestId("prepare-inquiry")).toHaveLength(4);
    expect(screen.getAllByTestId("prepare-inquiry")[0]).toHaveTextContent("دستی");
    expect(container.textContent).not.toMatch(/ارسال شد|پاسخ داد|موجود است/);
  });
  it("offers and reasons stay inspectable with ids; the pinned label column and an accessible scroll region exist", () => {
    const { container } = ui();
    expect(container.querySelectorAll("[data-offer-id]").length).toBe(4);
    expect(container.querySelectorAll('[data-testid="reasons"] [data-reason]').length).toBeGreaterThan(8);
    expect(screen.getByRole("region", { name: /جدول مقایسه/ })).toHaveAttribute("tabindex", "0");
    expect(container.querySelector("tbody th[scope=row]")?.className).toContain("sticky");
  });
});
