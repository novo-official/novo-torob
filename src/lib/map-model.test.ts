// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAreaPins, buildShopPins, originPin } from "./map-model";

describe("map marker semantics", () => {
  const shops = [
    { id: "shop_a", name: "الف", lat: 35.69, lon: 51.42, distanceMeters: 100 },
    { id: "shop_b", name: "ب", lat: 35.7, lon: 51.43, distanceMeters: 200 },
  ];
  it("single shops are 'shop' pins whose label says shop", () => {
    const pins = buildShopPins(shops);
    expect(pins.map((p) => p.kind)).toEqual(["shop", "shop"]);
    expect(pins[0]!.label).toMatch(/^فروشگاه:/);
  });
  it("shops with the exact same coordinate (mall-level) collapse into ONE group pin that lists all ids", () => {
    const pins = buildShopPins([...shops, { id: "shop_c", name: "ج", lat: 35.69, lon: 51.42, distanceMeters: 100 }, { id: "shop_d", name: "د", lat: 35.69, lon: 51.42, distanceMeters: 100 }]);
    const g = pins.find((p) => p.kind === "shop-group")!;
    expect(pins).toHaveLength(2);
    expect(g.ids.sort()).toEqual(["shop_a", "shop_c", "shop_d"]);
    expect(g.label).toMatch(/سطح پاساژ/);
    expect(g.label).not.toMatch(/دقیق(اً)? موقعیت واحد\b(?!\))/);
  });
  it("area pins are a different kind with a label that says it is NOT a seller", () => {
    const [a] = buildAreaPins([{ id: "curated-x", name: "لاله‌زار", lat: 35.689, lon: 51.4225, sourceType: "curated_external" }]);
    expect(a!.kind).toBe("area");
    expect(a!.label).toMatch(/فروشنده نیست/);
    expect(a!.label).toMatch(/منبع بیرونی/);
    const [d] = buildAreaPins([{ id: "density-x", name: "پاساژ", lat: 35.69, lon: 51.42, sourceType: "dataset_category_density" }]);
    expect(d!.label).toMatch(/برآورد از تراکم داده/);
  });
  it("invalid or repeated-zero coordinates never become pins", () => {
    expect(buildShopPins([{ id: "x", name: "x", lat: NaN, lon: 51, distanceMeters: null }, { id: "y", name: "y", lat: 0, lon: 0, distanceMeters: null }, { id: "z", name: "z", lat: 200, lon: 51, distanceMeters: null }])).toEqual([]);
    expect(buildAreaPins([{ id: "a", name: "a", lat: NaN, lon: NaN, sourceType: "curated_external" }])).toEqual([]);
    expect(originPin(NaN, 1, "x")).toBeNull();
  });
  it("origin pin is its own kind", () => expect(originPin(35.69, 51.42, "فردوسی")!.kind).toBe("origin"));
  it("kinds are distinct across all three families", () => {
    const kinds = new Set([...buildShopPins(shops), ...buildAreaPins([{ id: "a", name: "a", lat: 35.7, lon: 51.4, sourceType: "curated_external" }]), originPin(35.69, 51.42, "x")!].map((p) => p.kind));
    expect(kinds).toEqual(new Set(["shop", "area", "origin"]));
  });
});
