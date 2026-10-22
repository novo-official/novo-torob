import { describe, expect, it } from "vitest";
import { computeFeatures, score, WEIGHTS, type RankFeatures } from "./rank";
import { analyzeQuery } from "./analyze";
import type { Vocabulary } from "./vocab";

const V: Vocabulary = { size: 0, doc: () => 100, hasPrefix: () => true, fuzzy: () => [] };
const base: RankFeatures = { exactModel: false, compatibleModel: false, offerOnlyModel: false, titleCoverage: 1, categoryCoverage: 0, phrase: false, brand: false, titleLead: false, categoryLead: false, bm25Position: 0.5, distinctSellers: 1, hasReliablePrice: false, partial: false };

describe("ranking: relevance dominates, coverage is secondary", () => {
  it("seller coverage + reliable price can add at most 4 points", () => {
    expect(WEIGHTS.sellers + WEIGHTS.reliablePrice).toBeLessThanOrEqual(4);
  });
  it("an exact model match with ONE seller beats a non-model match with 1000 sellers", () => {
    const exact = score({ ...base, exactModel: true, distinctSellers: 1 });
    const popular = score({ ...base, titleCoverage: 1, distinctSellers: 1000, hasReliablePrice: true });
    expect(exact).toBeGreaterThan(popular);
  });
  it("better title coverage beats more sellers", () => {
    expect(score({ ...base, titleCoverage: 1, distinctSellers: 1 })).toBeGreaterThan(score({ ...base, titleCoverage: 0.5, distinctSellers: 500, hasReliablePrice: true }));
  });
  it("sellers can only break a near-tie", () => {
    const a = score({ ...base, distinctSellers: 1 });
    const b = score({ ...base, distinctSellers: 30 });
    expect(b - a).toBeGreaterThan(0);
    expect(b - a).toBeLessThanOrEqual(WEIGHTS.sellers);
  });
  it("offer count alone is not a feature at all", () => {
    expect(Object.keys(base)).not.toContain("offerCount");
  });
  it("partial matches are penalised below full matches", () => {
    expect(score({ ...base, partial: true })).toBeLessThan(score(base));
  });
  it("model identity order: exact > prefix-family > only-in-offer-titles", () => {
    const e = score({ ...base, exactModel: true });
    const c = score({ ...base, compatibleModel: true });
    const o = score({ ...base, offerOnlyModel: true });
    expect(e).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(o);
  });
  it("score is deterministic", () => {
    expect(score(base)).toBe(score({ ...base }));
  });
});

describe("computeFeatures", () => {
  const P = { titleNorm: "گوشی سامسونگ a54 5g", brandNorm: "سامسونگ", categoryNorm: "گوشی موبایل", modelKeys: "A54", distinctSellers: 3, hasReliablePrice: true };
  it("detects title lead + category lead for a head word", () => {
    const f = computeFeatures(analyzeQuery("گوشی", V), P, 1, false);
    expect(f.titleLead).toBe(true);
    expect(f.categoryLead).toBe(true);
  });
  it("an accessory category does not get the category lead", () => {
    const f = computeFeatures(analyzeQuery("گوشی", V), { ...P, titleNorm: "قاب گوشی", categoryNorm: "کیف و کاور گوشی" }, 1, false);
    expect(f.titleLead).toBe(false);
    expect(f.categoryLead).toBe(false);
  });
  it("recognises an exact model key", () => {
    const f = computeFeatures(analyzeQuery("A54ZZ", V), { ...P, modelKeys: "A54ZZ" }, 1, false);
    expect(f.exactModel).toBe(true);
  });
  it("a model that is in the product's own title is NOT offer-only", () => {
    const f = computeFeatures(analyzeQuery("a54zz", V), { ...P, titleNorm: "گوشی a54zz", modelKeys: "" }, 1, false);
    expect(f.offerOnlyModel).toBe(false);
  });
  it("a model that only appears in seller titles is flagged as offer-only", () => {
    const f = computeFeatures(analyzeQuery("LC1D95AM7", V), { ...P, modelKeys: "LC1D50M7" }, 1, false);
    expect(f.exactModel).toBe(false);
    expect(f.offerOnlyModel).toBe(true);
  });
});
