// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ShoppingArea } from "@/domain/shopping-area";
import { CURATED_AREAS, CURATED_REGISTRY, CURATED_REJECTED } from "./curated";
import { buildRegistry, validateArea } from "./validate";

const TODAY = "2026-10-22";
const good = (over: Partial<ShoppingArea> = {}): ShoppingArea => ({
  id: "curated-test-area", nameFa: "منطقه‌ی آزمایشی", kind: "street", center: { lat: 35.69, lon: 51.42 }, coordinateBasisFa: "نقطه‌ای روی خیابان", areaLabelFa: "تهران",
  categoryTags: ["پاوربانک و شارژر همراه"], recommendationReasonFa: "دلیل", sourceType: "curated_external", verifiedAt: "2026-10-01", confidence: "medium", disclaimerFa: "سرنخ است",
  sources: [
    { supports: "claim", title: "گزارش", publisher: "ناشر", url: "https://example.ir/a", publishedAt: "2026-01-01" },
    { supports: "coordinates", title: "نقشه", publisher: "OSM", url: "https://www.openstreetmap.org/node/1" },
  ], ...over,
});

describe("shopping-area validation (source + date requirements)", () => {
  it("accepts a fully sourced area", () => expect(validateArea(good(), TODAY)).toEqual([]));
  it("rejects a curated area without sources", () => expect(validateArea(good({ sources: [] }), TODAY).join()).toMatch(/without sources/));
  it("rejects invalid / non-https / credentialed source URLs", () => {
    for (const url of ["http://example.ir/a", "javascript:alert(1)", "ftp://x.y/z", "https://u:p@example.ir/", "not a url", ""]) {
      const a = good({ sources: [{ supports: "claim", title: "t", publisher: "p", url }, { supports: "coordinates", title: "t", publisher: "p", url: "https://www.openstreetmap.org/node/1" }] });
      expect(validateArea(a, TODAY).join(), url).toMatch(/invalid source url/);
    }
  });
  it("needs BOTH a claim source and a coordinate source", () => {
    const only = good().sources.filter((s) => s.supports === "claim");
    expect(validateArea(good({ sources: only }), TODAY).join()).toMatch(/coordinates/);
  });
  it("rejects a missing, malformed or FUTURE verification date", () => {
    expect(validateArea(good({ verifiedAt: "" }), TODAY).join()).toMatch(/verifiedAt/);
    expect(validateArea(good({ verifiedAt: "1405/07/30" }), TODAY).join()).toMatch(/verifiedAt/);
    expect(validateArea(good({ verifiedAt: "2026-12-01" }), TODAY).join()).toMatch(/future/);
  });
  it("rejects coordinates outside Tehran, NaN, or (0,0)", () => {
    for (const c of [{ lat: 32.6, lon: 51.6 }, { lat: NaN, lon: 51.4 }, { lat: 0, lon: 0 }]) expect(validateArea(good({ center: c }), TODAY).join()).toMatch(/coordinates/);
  });
  it("'high' needs two independent claim sources; density can never be 'high'", () => {
    expect(validateArea(good({ confidence: "high" }), TODAY).join()).toMatch(/≥2/);
    const dens = good({ sourceType: "dataset_category_density", confidence: "high", sources: [{ supports: "dataset", title: "d", publisher: "p", dataset: { files: ["shops.csv"], fields: ["category_names"] } }] });
    expect(validateArea(dens, TODAY).join()).toMatch(/can never be 'high'/);
  });
  it("registry rejects duplicate ids and near-duplicate coordinates, keeps the rest", () => {
    const r = buildRegistry([good(), good(), good({ id: "curated-other-id", center: { lat: 35.69001, lon: 51.42001 } }), good({ id: "curated-far", center: { lat: 35.7, lon: 51.43 } })], TODAY);
    expect(r.valid.map((a) => a.id)).toEqual(["curated-test-area", "curated-far"]);
    expect(r.rejected).toHaveLength(2);
  });
});

describe("the shipped curated registry", () => {
  it("has no rejected entries and every entry carries provenance + a verification date", () => {
    expect(CURATED_REJECTED).toEqual([]);
    expect(CURATED_REGISTRY.length).toBe(CURATED_AREAS.length);
    expect(CURATED_REGISTRY.length).toBeGreaterThanOrEqual(3);
    for (const a of CURATED_REGISTRY) {
      expect(a.sourceType).toBe("curated_external");
      expect(a.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.sources.every((s) => s.url?.startsWith("https://"))).toBe(true);
      expect(a.sources.some((s) => s.supports === "claim") && a.sources.some((s) => s.supports === "coordinates")).toBe(true);
      expect(a.disclaimerFa).toMatch(/موجودی/);
    }
  });
  it("area centres are distinct real Tehran coordinates", () => {
    const keys = new Set(CURATED_REGISTRY.map((a) => `${a.center.lat.toFixed(4)},${a.center.lon.toFixed(4)}`));
    expect(keys.size).toBe(CURATED_REGISTRY.length);
  });
});
