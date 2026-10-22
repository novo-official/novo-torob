// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { VariantGroup } from "@/domain/advisor";
import type { DeclaredHours } from "@/domain/types";
import { COMPARISON_VERSION, TIER_META } from "@/domain/comparison";
import { NO_SCHEDULE, parseWeeklyHours } from "@/server/domain/hours";
import { compareSellers, evaluatePrice, hoursAtVisit, median, paymentView, warrantyView, UNUSUAL, type EngineInput, type EngineSeller } from "./engine";
import { classifyIdentity, extractPackQuantity, type EngineOffer } from "./identity";
import { ageDays, parseTehranLocal, tehranDate, tehranDayNumber, toTehranLocalInput } from "./time";

// ---------- fixtures ----------
const NOW = new Date("2026-10-22T09:00:00Z"); // Thursday 12:30 Tehran
const SNAP = "2026-10-13T00:02:35.297Z";
const grp = (over: Partial<VariantGroup> = {}): VariantGroup => ({
  id: "unknown|HDW1200", label: "g", unitHint: "unknown", modelKey: "HDW1200", offerCount: 5, eligibleOffers: 5, sampleTitle: "t", flags: [],
  price: { status: "reliable", label: "", min: null, median: null, max: null, reliableCount: 0, unitHint: null, staleShare: null, spreadRatio: null, pricedOffers: 0, totalOffers: 0, excluded: {} }, ...over,
});
const G = grp();
let n = 0;
const offer = (shopId: string, price: number | null, over: Partial<EngineOffer> = {}): EngineOffer => ({
  offerId: `offer_${shopId}_${++n}`, productId: "product_x", shopId, sellerTitle: "دوربین HDW1200", priceToman: price, priceRaw: price === null ? null : String(price), priceOutOfRange: false,
  priceChangedAt: "2026-10-10T08:00:00Z", unitHint: "unknown", modelKeys: ["HDW1200"], flags: [], groupId: G.id, sourceRow: n,
  warranty: { months: null, provider: null, description: null }, ...over,
});
const OPEN_ALL: DeclaredHours = parseWeeklyHours(JSON.stringify(Object.fromEntries(["sat", "sun", "mon", "tue", "wed", "thu", "fri"].map((d) => [d, { status: "declared", shifts: [{ start_time: "09:00:00", end_time: "21:00:00" }] }])))).hours;
const seller = (shopId: string, offers: EngineOffer[], over: Partial<EngineSeller> = {}): EngineSeller => ({
  shopId, name: `فروشگاه ${shopId}`, locationLabel: "فردوسی", lat: 35.692, lon: 51.4225, hours: OPEN_ALL, payment: [], offers, ...over,
});
const input = (sellers: EngineSeller[], over: Partial<EngineInput> = {}): EngineInput => ({
  product: { id: "product_x", title: "دوربین", categoryName: "دوربین" }, groups: [G], selected: G, needsConfirmation: false, sellers,
  peerPrices: [4_000_000, 4_100_000, 4_200_000, 4_300_000, 4_400_000, 4_500_000], snapshotRef: SNAP, now: NOW, visitAt: NOW, visitIsNow: true,
  origin: null, radiusMeters: 1000, budget: { min: null, max: null }, strictBudget: false, priority: "price", requestedShopIds: sellers.map((s) => s.shopId), candidates: [], notices: [], ...over,
});
const byShop = (r: ReturnType<typeof compareSellers>, id: string) => r.sellers.find((s) => s.shopId === id)!;

// ---------- identity gating ----------
describe("identity tiers (never relabel a heuristic as proven)", () => {
  it("A only with the exact model key, same unit and no identity flag", () => {
    expect(classifyIdentity({ offer: offer("s", 1), selected: G })).toEqual({ tier: "A", evidence: ["EXACT_MODEL_KEY"] });
  });
  it("same group but keyless title → B (likely only)", () => {
    expect(classifyIdentity({ offer: offer("s", 1, { modelKeys: [] }), selected: G }).tier).toBe("B");
    expect(classifyIdentity({ offer: offer("s", 1, { modelKeys: [], groupId: "unknown|any" }), selected: grp({ modelKey: null, id: "unknown|any" }) })).toEqual({ tier: "B", evidence: ["SAME_GROUP_NO_KEY"] });
  });
  it("prefix/family key without exact equality → B with FAMILY_KEY_ONLY", () => {
    expect(classifyIdentity({ offer: offer("s", 1, { modelKeys: ["HDW1200CLQP"] }), selected: G })).toEqual({ tier: "B", evidence: ["FAMILY_KEY_ONLY"] });
  });
  it("identity flags cap an exact key at B", () => {
    const r = classifyIdentity({ offer: offer("s", 1, { flags: ["VARIANT_MODEL_MISMATCH"] }), selected: G });
    expect(r.tier).toBe("B");
    expect(r.evidence).toContain("IDENTITY_FLAG_CAP");
    expect(classifyIdentity({ offer: offer("s", 1, { flags: ["UNIT_AMBIGUOUS"] }), selected: G }).tier).toBe("B");
  });
  it("different unit → C; sibling model code → C; unrelated/no key → D; no selection → D", () => {
    expect(classifyIdentity({ offer: offer("s", 1, { groupId: "per_metre|HDW1200", unitHint: "per_metre" }), selected: G })).toEqual({ tier: "C", evidence: ["UNIT_MISMATCH"] });
    const sel = grp({ id: "unknown|GV3P60", modelKey: "GV3P60" });
    expect(classifyIdentity({ offer: offer("s", 1, { groupId: "unknown|GV3P65", modelKeys: ["GV3P65"] }), selected: sel }).tier).toBe("C");
    expect(classifyIdentity({ offer: offer("s", 1, { groupId: "unknown|ZZZ999", modelKeys: ["ZZZ999"] }), selected: sel }).tier).toBe("D");
    expect(classifyIdentity({ offer: offer("s", 1, { groupId: "unknown|any", modelKeys: [] }), selected: sel }).tier).toBe("D");
    expect(classifyIdentity({ offer: offer("s", 1), selected: null })).toEqual({ tier: "D", evidence: ["VARIANT_NOT_SELECTED"] });
  });
  it("only tier A and B are rankable", () => { expect(Object.entries(TIER_META).filter(([, m]) => m.rankable).map(([k]) => k)).toEqual(["A", "B"]); });
});

describe("pack quantity is explicit-only and never normalised", () => {
  it.each([["پک ۱۰ عددی کابل", 10], ["۲ عددی", 2], ["بسته ۵ تایی", 5], ["ست 4 تایی", 4], ["۳ دانه‌ای", 3]] as const)("%s → %i", (t, v) => expect(extractPackQuantity(t)?.value).toBe(v));
  it("no quantity (or 1) → null; metres and watts are not counts", () => {
    for (const t of ["دوربین مداربسته", "کابل ۱۰۰ متری", "شارژر ۲۰ وات", "۱ عددی", "پک ۱"]) expect(extractPackQuantity(t), t).toBeNull();
  });
  it("the odd pack among comparable offers becomes tier C and never wins on price", () => {
    const r = compareSellers(input([
      seller("a", [offer("a", 1_000_000, { sellerTitle: "HDW1200 بسته ۲ عددی" })]),
      seller("b", [offer("b", 2_000_000)]), seller("c", [offer("c", 2_100_000)]),
    ], { peerPrices: [] }));
    expect(byShop(r, "a").tier).toBe("C");
    expect(byShop(r, "a").rank).toBeNull();
    expect(r.verdict.winnerShopId).toBe("b");
  });
});

// ---------- price validity ----------
describe("price comparability", () => {
  const ctx = { peerPrices: [4_000_000, 4_100_000, 4_200_000, 4_300_000, 4_400_000], snapshotRef: SNAP, now: NOW };
  it("null price is UNKNOWN (NO_PRICE), never zero", () => {
    const p = evaluatePrice(offer("s", null, { flags: ["NULL_PRICE"] }), "A", ctx);
    expect(p.comparability).toBe("NO_PRICE");
    expect(p.priceToman).toBeNull();
  });
  it("zero / negative / absurd / out-of-range / non-safe integers can never be trusted", () => {
    for (const o of [offer("s", 0), offer("s", -5), offer("s", 2 ** 60), offer("s", 5_000_000, { priceOutOfRange: true }), offer("s", 5e13, { flags: ["PRICE_ABSURD_MAGNITUDE"] })]) {
      const p = evaluatePrice(o, "A", ctx);
      expect(p.comparability, String(o.priceToman)).toBe("OUTLIER_OR_INVALID");
      expect(p.priceToman).toBeNull();
    }
  });
  it("peer/category outliers and exact duplicates are shown but never trusted", () => {
    for (const f of ["PRICE_PEER_OUTLIER_LOW", "PRICE_PEER_OUTLIER_HIGH", "PRICE_CATEGORY_OUTLIER_LOW", "EXACT_DUPLICATE_OFFER"]) expect(evaluatePrice(offer("s", 4_000_000, { flags: [f] }), "A", ctx).comparability, f).toBe("OUTLIER_OR_INVALID");
  });
  it("stale (flag) and missing/invalid timestamps are not trusted", () => {
    expect(evaluatePrice(offer("s", 4_000_000, { flags: ["TIMESTAMP_STALE"] }), "A", ctx).comparability).toBe("STALE");
    for (const o of [offer("s", 4_000_000, { priceChangedAt: null, flags: ["TIMESTAMP_MISSING"] }), offer("s", 4_000_000, { priceChangedAt: "garbage", flags: ["TIMESTAMP_MALFORMED"] }), offer("s", 4_000_000, { flags: ["TIMESTAMP_FUTURE"] })]) expect(evaluatePrice(o, "A", ctx).comparability).toBe("NO_TIMESTAMP");
  });
  it("a valid record far below peers is a CAUTION (kept, not deleted) and needs ≥5 peers", () => {
    const low = evaluatePrice(offer("s", 2_400_000), "A", ctx);
    expect(low.comparability).toBe("CAUTION");
    expect(low.priceToman).toBe(2_400_000);
    expect(low.cautions).toEqual(["FAR_BELOW_PEERS"]);
    expect(evaluatePrice(offer("s", 2_400_000), "A", { ...ctx, peerPrices: [4_000_000, 4_100_000] }).comparability).toBe("TRUSTED");
    expect(UNUSUAL.minPeers).toBe(5);
  });
  it("tier C/D prices are shown but IDENTITY_BLOCKED", () => expect(evaluatePrice(offer("s", 1_000_000), "C", ctx).comparability).toBe("IDENTITY_BLOCKED"));
  it("raw price string and recorded time are preserved verbatim", () => {
    const p = evaluatePrice(offer("s", 4_000_000, { priceRaw: "4000000", priceChangedAt: "2026-10-10T08:00:00Z" }), "A", ctx);
    expect(p.priceRaw).toBe("4000000");
    expect(p.recordedAt).toBe("2026-10-10T08:00:00Z");
  });
  it("median helper", () => { expect(median([3, 1, 2])).toBe(2); expect(median([1, 2, 3, 4])).toBe(2.5); expect(median([])).toBeNull(); });
});

// ---------- cheapest-claim rules ----------
describe("cheapest claim (a wrong 'cheapest' is worse than declining)", () => {
  const A = (id: string, p: number | null, o: Partial<EngineOffer> = {}) => seller(id, [offer(id, p, o)]);
  it("all tier A, strictly lowest → CHEAPEST_CONFIRMED with the margin", () => {
    const r = compareSellers(input([A("a", 4_100_000), A("b", 4_200_000), A("c", 4_300_000)]));
    expect(r.verdict.kind).toBe("CHEAPEST_CONFIRMED");
    expect(r.verdict.winnerShopId).toBe("a");
    expect(r.verdict.marginToman).toBe(100_000);
    expect(byShop(r, "a").rank).toBe(1);
  });
  it("any tier-B among trusted prices → only a QUALIFIED claim, never CONFIRMED", () => {
    const r = compareSellers(input([A("a", 4_100_000, { modelKeys: [] }), A("b", 4_200_000)]));
    expect(r.verdict.kind).toBe("CHEAPEST_QUALIFIED");
    expect(r.verdict.headlineFa).toContain("قابل‌اتکا");
    expect(r.verdict.detailFa).toContain("از فروشنده تأیید بگیرید");
  });
  it("keyless product (all B) never gets an unconditional claim", () => {
    const g = grp({ id: "unknown|any", modelKey: null });
    const r = compareSellers(input([A("a", 4_100_000, { modelKeys: [], groupId: g.id }), A("b", 4_200_000, { modelKeys: [], groupId: g.id })], { selected: g, groups: [g] }));
    expect(r.verdict.kind).toBe("CHEAPEST_QUALIFIED");
    expect(r.sellers.every((s) => s.tier === "B")).toBe(true);
  });
  it("a tie declares no winner", () => {
    const r = compareSellers(input([A("a", 4_100_000), A("b", 4_100_000), A("c", 4_300_000)]));
    expect(r.verdict.kind).toBe("NO_WINNER_TIE");
    expect(r.verdict.winnerShopId).toBeNull();
  });
  it("one trusted price → no comparative claim; null-price seller is not a winner", () => {
    const r = compareSellers(input([A("a", 4_100_000), A("b", null, { flags: ["NULL_PRICE"] })]));
    expect(r.verdict.kind).toBe("NO_WINNER_INSUFFICIENT");
    expect(r.verdict.winnerShopId).toBeNull();
    expect(byShop(r, "b").price.comparability).toBe("NO_PRICE");
  });
  it("stale/outlier prices never win even when cheapest", () => {
    const r = compareSellers(input([A("a", 1_000_000, { flags: ["TIMESTAMP_STALE"] }), A("b", 900_000, { flags: ["PRICE_PEER_OUTLIER_LOW"] }), A("c", 4_100_000), A("d", 4_200_000)]));
    expect(r.verdict.winnerShopId).toBe("c");
    expect(byShop(r, "a").price.priceToman).toBe(1_000_000);
    expect(byShop(r, "a").reasons.some((x) => x.code === "PRICE_STALE")).toBe(true);
  });
  it("a record far below peers is set aside (kept visible), the claim becomes qualified", () => {
    const r = compareSellers(input([A("a", 2_480_000), A("b", 4_100_000), A("c", 4_200_000)]));
    expect(r.verdict.winnerShopId).toBe("b");
    expect(r.verdict.kind).toBe("CHEAPEST_QUALIFIED");
    expect(r.verdict.setAsideShopIds).toEqual(["a"]);
    expect(byShop(r, "a").price.priceToman).toBe(2_480_000);
    expect(byShop(r, "a").reasons.map((x) => x.code)).toContain("PRICE_UNUSUALLY_LOW");
  });
  it("a winner >30% cheaper than the runner-up is not declared unconditionally", () => {
    const r = compareSellers(input([A("a", 2_900_000), A("b", 4_200_000)], { peerPrices: [] }));
    expect(r.verdict.kind).toBe("CHEAPEST_QUALIFIED");
    expect(r.verdict.detailFa).toContain("بیش از ۳۰٪");
  });
  it("prices more than 3× apart → NO_WINNER_WIDE_SPREAD", () => {
    const r = compareSellers(input([A("a", 1_000_000), A("b", 4_200_000)], { peerPrices: [] }));
    expect(r.verdict.kind).toBe("NO_WINNER_WIDE_SPREAD");
  });
  it("mismatched unit: the cheaper-looking metre offer is shown but excluded; verdict only among comparables", () => {
    const r = compareSellers(input([
      A("a", 50_000, { groupId: "per_metre|HDW1200", unitHint: "per_metre" }), A("b", 4_100_000), A("c", 4_200_000),
    ]));
    expect(byShop(r, "a").tier).toBe("C");
    expect(byShop(r, "a").rank).toBeNull();
    expect(r.verdict.winnerShopId).toBe("b");
    expect(r.sellers.map((s) => s.shopId).slice(-1)).toEqual(["a"]);
  });
  it("only mismatched/unknown candidates → no winner at all", () => {
    expect(compareSellers(input([A("a", 1, { groupId: "per_metre|X", unitHint: "per_metre" }), A("b", 2, { groupId: "roll_or_pack|X", unitHint: "roll_or_pack" })], { peerPrices: [] })).verdict.kind).toBe("NO_WINNER_MISMATCH");
    expect(compareSellers(input([A("a", 100), A("b", 200)], { selected: null, needsConfirmation: true, peerPrices: [] })).verdict.kind).toBe("NO_WINNER_UNKNOWN_IDENTITY");
  });
  it("variant unselected → situation VARIANT_UNCONFIRMED and nothing is ranked", () => {
    const r = compareSellers(input([A("a", 100), A("b", 200)], { selected: null, needsConfirmation: true, peerPrices: [] }));
    expect(r.situation).toBe("VARIANT_UNCONFIRMED");
    expect(r.sellers.every((s) => s.rank === null && s.tier === "D")).toBe(true);
  });
});

// ---------- one shop, many offers ----------
describe("offers are preserved, sellers (not offers) are compared", () => {
  it("every offer of a shop stays visible with its own tier/price; one card per shop", () => {
    const s = seller("a", [offer("a", 4_300_000), offer("a", 4_100_000), offer("a", 900_000, { groupId: "per_metre|HDW1200", unitHint: "per_metre" })]);
    const r = compareSellers(input([s, seller("b", [offer("b", 4_200_000)])]));
    expect(r.sellers.filter((x) => x.shopId === "a")).toHaveLength(1);
    const a = byShop(r, "a");
    expect(a.offers).toHaveLength(3);
    expect(a.offers.map((o) => o.identity.offerId).sort()).toEqual(s.offers.map((o) => o.offerId).sort());
    expect(a.offers.find((o) => o.identity.unitHint === "per_metre")!.identity.tier).toBe("C");
    expect(a.price.priceToman).toBe(4_100_000); // cheapest COMPARABLE offer represents the shop; the metre offer never does
    expect(a.reasons.map((x) => x.code)).toContain("MULTIPLE_OFFERS_SAME_SHOP");
  });
  it("a shop without any offer for the product is shown as tier D, not dropped, not ranked", () => {
    const r = compareSellers(input([seller("a", [offer("a", 4_100_000)]), seller("z", [])]));
    expect(byShop(r, "z").tier).toBe("D");
    expect(byShop(r, "z").rank).toBeNull();
    expect(byShop(r, "z").reasons.some((x) => x.textFa.includes("پیشنهادی ثبت نکرده"))).toBe(true);
  });
});

// ---------- budget ----------
describe("budget handling", () => {
  const s3 = () => [seller("a", [offer("a", 4_100_000)]), seller("b", [offer("b", 5_000_000)]), seller("c", [offer("c", null, { flags: ["NULL_PRICE"] })])];
  it("WITHIN / OVER / UNKNOWN are three different answers (unknown is never yes or no)", () => {
    const r = compareSellers(input(s3(), { budget: { min: null, max: 4_500_000 }, peerPrices: [] }));
    expect([byShop(r, "a").budget, byShop(r, "b").budget, byShop(r, "c").budget]).toEqual(["WITHIN", "OVER", "UNKNOWN"]);
  });
  it("strict budget lists unknowns separately", () => {
    const r = compareSellers(input(s3(), { budget: { min: null, max: 4_500_000 }, strictBudget: true, peerPrices: [] }));
    expect(r.budgetGroups).toEqual({ within: ["a"], over: ["b"], unknown: ["c"] });
  });
  it("no budget → NOT_SET; untrusted prices are UNKNOWN relative to a budget; mismatched are NOT_COMPARABLE", () => {
    expect(compareSellers(input(s3(), { peerPrices: [] })).sellers.every((s) => s.budget === "NOT_SET")).toBe(true);
    const r = compareSellers(input([seller("a", [offer("a", 1_000_000, { flags: ["TIMESTAMP_STALE"] })]), seller("b", [offer("b", 1, { groupId: "per_metre|X", unitHint: "per_metre" })])], { budget: { min: null, max: 5_000_000 }, peerPrices: [] }));
    expect([byShop(r, "a").budget, byShop(r, "b").budget]).toEqual(["UNKNOWN", "NOT_COMPARABLE"]);
  });
  it("min budget works too", () => {
    const r = compareSellers(input([seller("a", [offer("a", 4_100_000)])], { budget: { min: 5_000_000, max: null }, peerPrices: [] }));
    expect(byShop(r, "a").budget).toBe("OVER");
  });
});

// ---------- dates / timezone ----------
describe("Asia/Tehran dates", () => {
  it("calendar-day ages are Tehran days, not 24h blocks", () => {
    // 2026-10-21T20:30Z is already 2026-10-22 00:00 in Tehran
    expect(tehranDate(new Date("2026-10-21T20:30:00Z"))).toBe("2026-10-22");
    expect(tehranDate(new Date("2026-10-21T20:29:00Z"))).toBe("2026-10-21");
    expect(ageDays("2026-10-21T20:29:00Z", new Date("2026-10-21T20:31:00Z"))).toBe(1);
    expect(ageDays("2026-10-10T08:00:00Z", NOW)).toBe(12);
    expect(tehranDayNumber(new Date("2026-10-22T00:00:00Z")) - tehranDayNumber(new Date("2026-10-21T00:00:00Z"))).toBe(1);
  });
  it("invalid / absent dates give null and the age is never negative", () => {
    expect(ageDays(null, NOW)).toBeNull();
    expect(ageDays("not a date", NOW)).toBeNull();
    expect(ageDays("2027-01-01T00:00:00Z", NOW)).toBe(0);
  });
  it("distinguishes elapsed-today from snapshot-relative age", () => {
    const p = evaluatePrice(offer("s", 4_000_000, { priceChangedAt: "2026-09-03T06:24:59.762Z" }), "A", { peerPrices: [], snapshotRef: SNAP, now: NOW });
    expect(p.ageDaysToday).toBe(49);
    expect(p.ageDaysAtSnapshot).toBe(40);
    expect(p.staleBySnapshotRule).toBe(false);
  });
  it("visit input «YYYY-MM-DDTHH:mm» is Tehran wall-clock; invalid values are rejected", () => {
    const d = parseTehranLocal("2026-10-24T17:30")!;
    expect(d.toISOString()).toBe("2026-10-24T14:00:00.000Z");
    expect(toTehranLocalInput(d)).toBe("2026-10-24T17:30");
    for (const bad of ["2026-02-31T10:00", "2026-13-01T10:00", "2026-10-24T25:00", "2026-10-24 10:00", "", null, undefined, "x"]) expect(parseTehranLocal(bad as string), String(bad)).toBeNull();
  });
});

// ---------- hours / payment / warranty ----------
describe("declared hours, payment channel, warranty", () => {
  const week = (over: Record<string, unknown> = {}) => parseWeeklyHours(JSON.stringify({
    sat: { status: "declared", shifts: [{ start_time: "09:00:00", end_time: "13:00:00" }, { start_time: "16:00:00", end_time: "20:00:00" }] },
    sun: { status: "declared", shifts: [{ start_time: "00:00:00", end_time: "00:00:00" }] }, // placeholder only
    thu: { status: "declared", shifts: [{ start_time: "10:00:00", end_time: "19:00:00" }] },
    fri: { status: "closed", shifts: [] }, ...over,
  })).hours;
  const at = (iso: string) => new Date(`${iso}+03:30`);
  it("3 states only, with real split shifts", () => {
    const h = week();
    expect(hoursAtVisit(h, at("2026-10-24T10:00:00")).state).toBe("WITHIN_DECLARED"); // Saturday morning shift
    expect(hoursAtVisit(h, at("2026-10-24T14:30:00")).state).toBe("OUTSIDE_DECLARED"); // between the two shifts
    expect(hoursAtVisit(h, at("2026-10-24T17:00:00")).state).toBe("WITHIN_DECLARED"); // second shift
    expect(hoursAtVisit(h, at("2026-10-23T11:00:00")).state).toBe("OUTSIDE_DECLARED"); // Friday explicitly closed
  });
  it("placeholder-only day and missing schedule are UNKNOWN, never closed", () => {
    expect(hoursAtVisit(week(), at("2026-10-25T12:00:00")).state).toBe("UNKNOWN");
    expect(hoursAtVisit(NO_SCHEDULE, at("2026-10-24T10:00:00")).state).toBe("UNKNOWN");
    expect(hoursAtVisit(NO_SCHEDULE, NOW).labelFa).toContain("بسته حساب نمی‌شود");
  });
  it("never claims real-time confirmation", () => {
    for (const d of [at("2026-10-24T10:00:00"), at("2026-10-24T14:30:00")]) expect(hoursAtVisit(week(), d).labelFa).toMatch(/طبق اعلام فروشگاه/);
  });
  it("visit time changes the ranking when hours are the priority", () => {
    const a = seller("a", [offer("a", 4_100_000)], { hours: week() });
    const b = seller("b", [offer("b", 4_200_000)], { hours: OPEN_ALL });
    const at14 = compareSellers(input([a, b], { priority: "hours", visitAt: at("2026-10-24T14:30:00") }));
    expect(at14.sellers.map((s) => s.shopId)).toEqual(["b", "a"]);
    const at10 = compareSellers(input([a, b], { priority: "hours", visitAt: at("2026-10-24T10:00:00") }));
    expect(at10.sellers[0]!.hours.state).toBe("WITHIN_DECLARED");
    expect(at10.sellers.map((s) => s.shopId)).toEqual(["a", "b"]); // both within → price tie-break
  });
  it("payment: in_person vs unknown channel vs undeclared are distinct and provider names preserved", () => {
    expect(paymentView([{ providerName: "ترب‌پی", channel: "in_person" }, { providerName: "تارا", channel: "unknown" }]).bucket).toBe("IN_PERSON_DECLARED");
    const unk = paymentView([{ providerName: "اسنپ‌پی", channel: "unknown" }]);
    expect(unk.bucket).toBe("DECLARED_CHANNEL_UNKNOWN");
    expect(unk.labelFa).toContain("اسنپ‌پی");
    expect(unk.labelFa).toContain("معلوم نیست");
    expect(paymentView([]).bucket).toBe("UNDECLARED");
    expect(paymentView([]).labelFa).toContain("پشتیبانی‌نشدن نیست");
  });
  it("warranty: absent = unknown (not 'none'); explicit 'بدون گارانتی' is NONE_DECLARED; test-at-delivery is not a warranty", () => {
    expect(warrantyView(null).kind).toBe("UNKNOWN");
    expect(warrantyView({ months: null, provider: null, description: null }).kind).toBe("UNKNOWN");
    expect(warrantyView({ months: null, provider: "بدون گارانتی", description: null }).kind).toBe("NONE_DECLARED");
    expect(warrantyView({ months: 12, provider: "شرکتی", description: null })).toMatchObject({ kind: "MONTHS", months: 12 });
    expect(warrantyView({ months: null, provider: "تست و تحویل در حضور مشتری", description: null }).kind).toBe("TEST_AT_DELIVERY");
    expect(warrantyView({ months: null, provider: null, description: "ضمانت اصالت کالا" }).kind).toBe("DESCRIPTION");
  });
});

// ---------- ranking determinism ----------
describe("deterministic, explainable ranking", () => {
  const fixed = [
    seller("a", [offer("a", 4_300_000)], { lat: 35.6921, lon: 51.4225, payment: [{ providerName: "ترب‌پی", channel: "in_person" }] }),
    seller("b", [offer("b", 4_100_000)], { lat: 35.70, lon: 51.43 }),
    seller("c", [offer("c", 4_200_000, { warranty: { months: 18, provider: "شرکتی", description: null } })], { lat: 35.6950, lon: 51.4230 }),
  ];
  const mk = () => fixed;
  const origin = { source: "manual" as const, lat: 35.6921, lon: 51.4225, label: "فردوسی" };
  it("priority changes the order but never the facts", () => {
    const ids = (p: "price" | "distance" | "payment" | "warranty") => compareSellers(input(mk(), { origin, priority: p, peerPrices: [] })).sellers.map((s) => s.shopId);
    expect(ids("price")).toEqual(["b", "c", "a"]);
    expect(ids("distance")).toEqual(["a", "c", "b"]);
    expect(ids("payment")[0]).toBe("a");
    expect(ids("warranty")[0]).toBe("c");
  });
  it("same input → identical JSON; input order does not matter; ties break on shop id", () => {
    const a = JSON.stringify(compareSellers(input(mk(), { origin, peerPrices: [] })));
    expect(JSON.stringify(compareSellers(input(mk(), { origin, peerPrices: [] })))).toBe(a);
    const shuffled = JSON.stringify(compareSellers(input([...mk()].reverse(), { origin, peerPrices: [] })).sellers.map((s) => [s.shopId, s.rank]));
    expect(shuffled).toBe(JSON.stringify(compareSellers(input(mk(), { origin, peerPrices: [] })).sellers.map((s) => [s.shopId, s.rank])));
    const tie = compareSellers(input([seller("z", [offer("z", 4_100_000)]), seller("y", [offer("y", 4_100_000)])], { peerPrices: [] }));
    expect(tie.sellers.map((s) => s.shopId)).toEqual(["y", "z"]);
    expect(tie.sellers[1]!.tiedWithPrevious).toBe(true);
  });
  it("does not mutate its input", () => {
    const i = input(mk(), { origin });
    const snap = JSON.stringify(i);
    compareSellers(i);
    expect(JSON.stringify(i)).toBe(snap);
  });
  it("every reason carries its evidence and a Persian sentence; the summary names the chosen priority", () => {
    const r = compareSellers(input(mk(), { origin, peerPrices: [] }));
    for (const s of r.sellers) { expect(s.reasons.length).toBeGreaterThan(2); for (const x of s.reasons) { expect(x.textFa).toMatch(/[؀-ۿ]/); expect(x.evidence).toBeTypeOf("object"); } }
    expect(r.sellers[0]!.summaryFa).toContain("قیمت قابل‌اتکا");
    expect(r.engineVersion).toBe(COMPARISON_VERSION);
  });
  it("distance: straight-line metres, unknown without an origin or valid coordinates (never NaN)", () => {
    const r = compareSellers(input([seller("a", [offer("a", 1)], { lat: null, lon: null }), seller("b", [offer("b", 2)])], { origin, peerPrices: [] }));
    expect(byShop(r, "a").distanceMeters).toBeNull();
    expect(byShop(r, "a").reasons.map((x) => x.code)).toContain("DISTANCE_UNKNOWN");
    expect(byShop(r, "b").distanceMeters).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain("NaN");
    expect(compareSellers(input([seller("a", [offer("a", 1)])], { peerPrices: [] })).sellers[0]!.distanceMeters).toBeNull();
  });
  it("radius is informative only: a chosen shop beyond it is flagged, not dropped", () => {
    const r = compareSellers(input([seller("far", [offer("far", 4_100_000)], { lat: 35.75, lon: 51.5 })], { origin, radiusMeters: 500, peerPrices: [] }));
    expect(r.sellers).toHaveLength(1);
    expect(r.sellers[0]!.withinRadius).toBe(false);
  });
  it("stock is always unconfirmed and no seller response is fabricated", () => {
    const r = compareSellers(input(mk(), { origin }));
    expect(r.sellers.every((s) => s.stock === "unconfirmed")).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/ارسال شد|موجود است|پاسخ فروشنده/);
  });
  it("situations: zero / one / none comparable", () => {
    expect(compareSellers(input([])).situation).toBe("NO_SELLERS_SELECTED");
    expect(compareSellers(input([seller("a", [offer("a", 1)])], { peerPrices: [] })).situation).toBe("SINGLE_SELLER");
    expect(compareSellers(input([seller("a", [offer("a", 1, { groupId: "per_metre|X", unitHint: "per_metre" })]), seller("b", [offer("b", 1, { groupId: "per_metre|X", unitHint: "per_metre" })])], { peerPrices: [] })).situation).toBe("NO_COMPARABLE_SELLERS");
    expect(compareSellers(input([], { product: null })).situation).toBe("PRODUCT_NOT_FOUND");
  });
});
