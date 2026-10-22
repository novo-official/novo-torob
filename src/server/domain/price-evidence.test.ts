import { describe, expect, it } from "vitest";
import { buildPriceEvidence, describePriceStatus, type OfferForEvidence } from "./price-evidence";

const o = (price: number | null, flags: string[] = [], unitHint = "unknown", shopId = `s${Math.random()}`): OfferForEvidence => ({ shopId, price, unitHint, flags });

describe("buildPriceEvidence", () => {
  it("reliable range from comparable offers only; median is exact", () => {
    const e = buildPriceEvidence([o(100), o(120), o(140)]);
    expect(e).toMatchObject({ status: "reliable", min: 100, median: 120, max: 140, reliableCount: 3, unitHint: "unknown" });
  });
  it("a single offer is reliable but flagged by reliableCount = 1", () => {
    expect(buildPriceEvidence([o(5)])).toMatchObject({ status: "reliable", reliableCount: 1, min: 5, max: 5, spreadRatio: 1 });
  });
  it("no priced offers → no_price and no numbers", () => {
    const e = buildPriceEvidence([o(null, ["NULL_PRICE"])]);
    expect(e).toMatchObject({ status: "no_price", min: null, median: null, max: null });
    expect(describePriceStatus(e)).toBe("قیمت قابل اتکا موجود نیست");
  });
  it("priced but all excluded (outlier, duplicate, mismatch) → no_eligible, with reasons counted", () => {
    const e = buildPriceEvidence([o(900, ["PRICE_PEER_OUTLIER_HIGH"]), o(5, ["VARIANT_MODEL_MISMATCH"]), o(7, ["EXACT_DUPLICATE_OFFER"])]);
    expect(e.status).toBe("no_eligible");
    expect(e.excluded).toEqual({ PRICE_PEER_OUTLIER_HIGH: 1, VARIANT_MODEL_MISMATCH: 1, EXACT_DUPLICATE_OFFER: 1 });
  });
  it("outliers and mismatched variants are excluded from min/max", () => {
    const e = buildPriceEvidence([o(100), o(110), o(1, ["PRICE_PEER_OUTLIER_LOW"]), o(9000, ["PRICE_PEER_OUTLIER_HIGH"]), o(300, ["VARIANT_MODEL_MISMATCH"])]);
    expect(e).toMatchObject({ status: "reliable", min: 100, max: 110, reliableCount: 2 });
    expect(e.pricedOffers).toBe(5);
  });
  it("never mixes unit groups: per-metre next to unknown-unit → mixed_units, no range", () => {
    const e = buildPriceEvidence([o(39000, [], "per_metre"), o(3900000, [], "unknown")]);
    expect(e.status).toBe("mixed_units");
    expect(describePriceStatus(e)).toMatch(/واحد/);
  });
  it("refuses a single range when comparable offers spread beyond 3× (the 12× wire case)", () => {
    const e = buildPriceEvidence([o(39000), o(39000), o(110675), o(78500), o(65800), o(468000)]);
    expect(e.status).toBe("wide_spread");
    expect(e.spreadRatio).toBeGreaterThan(3);
    expect(describePriceStatus(e)).toContain("×");
  });
  it("counts distinct sellers (not offers) and stale share", () => {
    const e = buildPriceEvidence([o(1, [], "unknown", "A"), o(2, ["TIMESTAMP_STALE"], "unknown", "A"), o(3, ["TIMESTAMP_STALE"], "unknown", "B")]);
    expect(e.distinctSellers).toBe(2);
    expect(e.staleShare).toBeCloseTo(0.67, 2);
  });
  it("stale price is reported, not excluded", () => {
    expect(buildPriceEvidence([o(10, ["TIMESTAMP_STALE"])]).status).toBe("reliable");
  });
  it("empty input is safe", () => {
    expect(buildPriceEvidence([])).toMatchObject({ status: "no_price", totalOffers: 0, distinctSellers: 0 });
  });
});
