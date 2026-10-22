// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { openRealDb } from "../../../tests/helpers/real-db";
import { buildShopPins } from "@/lib/map-model";
import { recommendShoppingAreas } from "@/server/areas/recommend";
import { findCategoryActivityShops } from "./activity";
import { findSellersForProduct } from "./find";
import { getOriginPresets, resolveOrigin } from "./origins";

const db = openRealDb();
afterAll(() => db?.close());
const q = <T,>(sql: string, ...p: Array<string | number>) => db!.prepare(sql).all(...p) as T[];
const one = <T,>(sql: string, ...p: Array<string | number>) => db!.prepare(sql).get(...p) as T;

// independent distance: spherical law of cosines (a different formula from the service's haversine)
const R = 6371008.8;
const lawOfCosines = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180;
  return R * Math.acos(Math.min(1, Math.sin(a * r) * Math.sin(c * r) + Math.cos(a * r) * Math.cos(c * r) * Math.cos((d - b) * r)));
};
const AT = new Date("2026-10-24T08:30:00Z"); // a Saturday, 12:00 in Tehran

describe.skipIf(!db)("nearby sellers on the real dataset", () => {
  const presets = db ? getOriginPresets(db) : [];
  const ferdowsi = presets.find((p) => p.id === "ferdowsi")!;
  const O = { lat: ferdowsi?.lat, lon: ferdowsi?.lon, source: "manual" as const, label: "فردوسی" };
  // a product with many shops and ONE dominant keyless variant group
  const big = db ? one<{ p: string; s: number }>("SELECT product_id p, count(DISTINCT shop_id) s FROM offers GROUP BY product_id HAVING s >= 10 ORDER BY s DESC LIMIT 1") : null;
  const sel = (productId: string) => {
    const r = findSellersForProduct(db!, { productId, origin: O, radiusMeters: 10000, at: AT })!;
    const g = [...r.variant.groups].sort((a, b) => b.offerCount - a.offerCount)[0];
    return g?.id ?? null;
  };

  it("01 the chosen product has ≥ 10 shops in the dataset (demo product)", () => {
    expect(big!.s).toBeGreaterThanOrEqual(10);
  });

  it("02 results inside the radius are sorted by distance and every shop is inside the radius", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 3000, at: AT, pageSize: 50 })!;
    expect(r.situation).toBe("OK");
    expect(r.sellers.length).toBeGreaterThanOrEqual(10);
    const d = r.sellers.map((s) => s.distanceMeters!);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(Math.max(...d)).toBeLessThanOrEqual(3000);
  });

  it("03 radius monotonicity: a larger radius never loses a shop", () => {
    const v = sel(big!.p);
    const ids = (r: number) => new Set(findSellersForProduct(db!, { productId: big!.p, variantGroupId: v, origin: O, radiusMeters: r, at: AT, pageSize: 50 })!.sellers.map((s) => s.shopId));
    const [a, b, c] = [ids(500), ids(1000), ids(5000)];
    for (const id of a) expect(b.has(id)).toBe(true);
    for (const id of b) expect(c.has(id)).toBe(true);
    expect(c.size).toBeGreaterThanOrEqual(b.size);
  });

  it("04 every card traces back to real offers: offer.product_id = product and offer.shop_id = card shop", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 5000, at: AT, pageSize: 50 })!;
    for (const s of r.sellers) {
      expect(s.offerIds.length).toBe(s.offerCount);
      for (const id of s.offerIds) {
        const row = one<{ product_id: string; shop_id: string }>("SELECT product_id, shop_id FROM offers WHERE offer_id = ?", id);
        expect(row.product_id).toBe(big!.p);
        expect(row.shop_id).toBe(s.shopId);
      }
    }
  });

  it("05 zero-offer shops never appear, however near they are", () => {
    const zero = q<{ shop_id: string }>("SELECT shop_id FROM shops WHERE offer_count = 0 AND lat IS NOT NULL").map((r) => r.shop_id);
    expect(zero.length).toBeGreaterThan(100);
    const zeroSet = new Set(zero);
    for (const pid of [big!.p, ...q<{ product_id: string }>("SELECT product_id FROM offers GROUP BY product_id HAVING count(DISTINCT shop_id) >= 5 LIMIT 5").map((r) => r.product_id)]) {
      const r = findSellersForProduct(db!, { productId: pid, origin: O, radiusMeters: 50000, showUncertain: true, at: AT, pageSize: 50, includeOutside: true })!;
      for (const s of [...r.sellers, ...r.outsideRadius]) expect(zeroSet.has(s.shopId)).toBe(false);
    }
  });

  it("06 a shop that sells OTHER products but not this one is not a seller of this one", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 50000, showUncertain: true, at: AT, pageSize: 50 })!;
    const sellerIds = new Set(r.sellers.map((s) => s.shopId));
    const withOffer = new Set(q<{ s: string }>("SELECT DISTINCT shop_id s FROM offers WHERE product_id = ?", big!.p).map((x) => x.s));
    for (const id of sellerIds) expect(withOffer.has(id)).toBe(true);
    const other = q<{ s: string }>("SELECT DISTINCT shop_id s FROM offers WHERE product_id != ? LIMIT 3000", big!.p).map((x) => x.s).find((s) => !withOffer.has(s))!;
    expect(sellerIds.has(other)).toBe(false);
  });

  it("07 distinct shops vs raw offers: repeated (product, shop) pairs collapse into ONE card with the right offer count", () => {
    const rep = one<{ p: string; s: string; n: number }>("SELECT product_id p, shop_id s, count(*) n FROM offers GROUP BY product_id, shop_id HAVING n >= 3 ORDER BY n DESC LIMIT 1");
    expect(rep.n).toBeGreaterThanOrEqual(3);
    const r = findSellersForProduct(db!, { productId: rep.p, origin: null, showUncertain: true, at: AT, pageSize: 50, radiusMeters: 50000 })!;
    const cards = r.sellers.filter((s) => s.shopId === rep.s);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.offerCount + cards[0]!.hiddenOfferCount).toBe(rep.n);
    expect(new Set(r.sellers.map((s) => s.shopId)).size).toBe(r.sellers.length);
    const distinctShops = one<{ n: number }>("SELECT count(DISTINCT shop_id) n FROM offers WHERE product_id = ?", rep.p).n;
    expect(r.counts.shopsAnyVariant).toBe(Number(distinctShops));
    expect(r.counts.offersTotal).toBeGreaterThanOrEqual(r.counts.shopsTotal);
  });

  it("08 the selected exact variant is not silently swapped: default lists contain only PLAUSIBLE offers of the selected group", () => {
    const multi = one<{ p: string }>("SELECT product_id p FROM offers GROUP BY product_id HAVING count(DISTINCT unit_hint) > 1 AND count(DISTINCT shop_id) >= 5 LIMIT 1");
    const probe = findSellersForProduct(db!, { productId: multi.p, origin: null, showUncertain: true, at: AT, pageSize: 50 })!;
    expect(probe.variant.needsConfirmation).toBe(true);
    const chosen = probe.variant.groups.find((g) => g.unitHint === "per_metre") ?? probe.variant.groups[0]!;
    const r = findSellersForProduct(db!, { productId: multi.p, variantGroupId: chosen.id, origin: null, at: AT, pageSize: 50 })!;
    for (const s of r.sellers) for (const o of s.offers) { expect(o.variantMatch).toBe("PLAUSIBLE"); expect(o.unitHint === chosen.unitHint).toBe(true); }
    const all = findSellersForProduct(db!, { productId: multi.p, variantGroupId: chosen.id, origin: null, showUncertain: true, at: AT, pageSize: 50 })!;
    const statuses = new Set(all.sellers.flatMap((s) => s.offers.map((o) => o.variantMatch)));
    expect(statuses.has("CONFLICTING") || statuses.has("UNCERTAIN")).toBe(true);
    for (const s of all.sellers) for (const o of s.offers) if (o.variantMatch === "CONFLICTING") expect(s.variantMatchStatus === "CONFLICTING" || s.offers.some((x) => x.variantMatch !== "CONFLICTING")).toBe(true);
  });

  it("09 no variant chosen while several exist → situation VARIANT_UNCONFIRMED and NO sellers are claimed", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, origin: O, radiusMeters: 3000, at: AT })!;
    expect(r.variant.needsConfirmation).toBe(true);
    expect(r.situation).toBe("VARIANT_UNCONFIRMED");
    expect(r.sellers).toEqual([]);
    expect(r.counts.shopsAnyVariant).toBeGreaterThan(0);
    const shown = findSellersForProduct(db!, { productId: big!.p, origin: O, radiusMeters: 3000, showUncertain: true, at: AT })!;
    expect(shown.sellers.length).toBeGreaterThan(0);
    expect(shown.sellers.every((s) => s.variantMatchStatus === "UNSELECTED")).toBe(true);
  });

  it("10 distances equal an independent formula (law of cosines) within 1 m for every returned seller", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 10000, at: AT, pageSize: 50 })!;
    expect(r.sellers.length).toBeGreaterThanOrEqual(20);
    for (const s of r.sellers) expect(Math.abs(s.distanceMeters! - lawOfCosines(O.lat, O.lon, s.lat, s.lon))).toBeLessThan(1);
  });

  it("11 situation A: nothing in radius → real nearest matches OUTSIDE the radius with distances, plus radius hints", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 100, at: AT })!;
    expect(r.situation).toBe("NO_SHOP_IN_RADIUS");
    expect(r.sellers).toEqual([]);
    expect(r.outsideRadius.length).toBeGreaterThan(0);
    const d = r.outsideRadius.map((s) => s.distanceMeters!);
    expect(d.every((x) => x > 100)).toBe(true);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(r.radiusHints.length).toBeGreaterThan(0);
    expect(r.radiusHints[0]!.shops).toBeGreaterThan(0);
  });

  it("12 an origin far outside the data's coverage gets an honest coverage warning, not 'no shops in Tehran'", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: { lat: 35.8, lon: 51.7, source: "manual" }, radiusMeters: 500, at: AT })!;
    expect(r.outsideDatasetCoverage).toBe(true);
    const text = r.notices.join(" ");
    expect(text).toMatch(/پوشش نمی‌دهد/);
    expect(text).toMatch(/نبود فروشگاه در آن منطقه‌ی تهران نیست/);
  });

  it("13 shops without a declared schedule are 'unknown', never 'closed'", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 10000, at: AT, pageSize: 50 })!;
    const noSched = r.sellers.filter((s) => s.declaredSchedule.status.reasonCode === "NO_SCHEDULE");
    expect(noSched.length).toBeGreaterThan(0);
    for (const s of noSched) expect(s.declaredSchedule.status.state).toBe("unknown");
    const open = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 10000, at: AT, pageSize: 50, openNow: true })!;
    for (const s of open.sellers) expect(s.declaredSchedule.status.state).toBe("open");
  });

  it("14 recorded price + last_price_changed_at come from the offers; bad/missing prices are labelled, never invented", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 10000, at: AT, pageSize: 50 })!;
    for (const s of r.sellers) {
      const e = s.priceEvidence;
      if (e.status === "recorded") {
        expect(e.min!).toBeLessThanOrEqual(e.max!);
        const prices = s.offers.map((o) => o.priceToman).filter((x): x is number => x !== null);
        expect(prices).toContain(e.min);
        expect(e.newestAgeDays === null || e.newestAgeDays >= 0).toBe(true);
      } else {
        expect(e.min).toBeNull();
        expect(e.noteFa).toBeTruthy();
      }
    }
    const sortedByPrice = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 10000, at: AT, pageSize: 50, sort: "price" })!.sellers.map((s) => s.priceEvidence.min ?? Infinity);
    expect([...sortedByPrice].sort((a, b) => a - b)).toEqual(sortedByPrice);
  });

  it("15 stock is never claimed: every seller's stock is 'unconfirmed'", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 5000, at: AT, pageSize: 50 })!;
    expect(r.sellers.every((s) => s.stock === "unconfirmed")).toBe(true);
  });

  it("16 shops sharing real coordinates are flagged as mall-level and merge into one map group pin", () => {
    const dup = one<{ p: string; lat: number; lon: number; n: number }>(
      `SELECT o.product_id p, s.lat lat, s.lon lon, count(DISTINCT o.shop_id) n FROM offers o JOIN shops s ON s.shop_id = o.shop_id
       GROUP BY o.product_id, round(s.lat,5), round(s.lon,5) HAVING n >= 2 ORDER BY n DESC LIMIT 1`,
    );
    const r = findSellersForProduct(db!, { productId: dup.p, origin: { lat: dup.lat, lon: dup.lon, source: "manual" }, radiusMeters: 500, showUncertain: true, at: AT, pageSize: 50 })!;
    const sameSpot = r.sellers.filter((s) => Math.abs(s.lat - dup.lat) < 1e-5 && Math.abs(s.lon - dup.lon) < 1e-5);
    expect(sameSpot.length).toBeGreaterThanOrEqual(2);
    for (const s of sameSpot) { expect(s.locationEvidence.sharedWithShops).toBeGreaterThanOrEqual(1); expect(s.distanceMeters).toBeLessThan(1); }
    const pins = buildShopPins(r.sellers.map((s) => ({ id: s.shopId, name: s.name, lat: s.lat, lon: s.lon, distanceMeters: s.distanceMeters })));
    const group = pins.find((p) => p.kind === "shop-group" && sameSpot.every((s) => p.ids.includes(s.shopId)));
    expect(group).toBeTruthy();
    expect(JSON.stringify(r)).not.toMatch(/[۰-۹0-9]+\s*(دقیقه|ساعت)|زمان (پیاده|رانندگی)/); // no invented travel time
  });

  it("17 the three geographic states stay separate: activity ≠ matched sellers, area leads are not shops", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 10000, showUncertain: true, at: AT, pageSize: 50 })!;
    const act = findCategoryActivityShops(db!, { category: r.product!.categoryName, productId: big!.p, origin: O, radiusMeters: 10000, limit: 50 });
    expect(act.state).toBe("CATEGORY_ACTIVITY_ONLY");
    const matched = new Set(q<{ s: string }>("SELECT DISTINCT shop_id s FROM offers WHERE product_id = ?", big!.p).map((x) => x.s));
    expect(act.shops.length).toBeGreaterThan(0);
    for (const s of act.shops) { expect(matched.has(s.shopId)).toBe(false); expect(s.hasMatchingOffer).toBe(false); }
    expect(act.disclaimerFa).toMatch(/تأیید نشده/);
    const sellerIds = new Set(r.sellers.map((s) => s.shopId));
    for (const s of act.shops) expect(sellerIds.has(s.shopId)).toBe(false);
    const areas = recommendShoppingAreas(db!, { categoryHint: r.product!.categoryName, origin: O, limit: 3 });
    for (const a of areas.areas) { expect(a.area.id).not.toMatch(/^shop_/); expect(a.area.sourceType).toMatch(/curated_external|dataset_category_density/); }
  });

  it("18 category-activity shops really list the category (evidence is the category list, not an offer)", () => {
    const cat = "پاوربانک و شارژر همراه";
    const act = findCategoryActivityShops(db!, { category: cat, productId: null, limit: 10 });
    for (const s of act.shops) {
      const row = one<{ c: string | null }>("SELECT category_names_json c FROM shops WHERE shop_id = ?", s.shopId);
      expect(JSON.parse(row.c ?? "[]")).toContain(cat);
    }
  });

  it("19 origin handling: GPS-like precise points are snapped; invalid points fall back to the default preset", () => {
    const o = resolveOrigin(db!, { point: { lat: 35.692347, lon: 51.422512 }, gps: true });
    expect(o).toMatchObject({ lat: 35.692, lon: 51.423, source: "gps", defaulted: false });
    expect(resolveOrigin(db!, { point: { lat: NaN, lon: 51 } }).defaulted).toBe(true);
    expect(resolveOrigin(db!, { preset: "baharestan" })).toMatchObject({ label: "بهارستان", defaulted: false });
    expect(resolveOrigin(db!, { preset: "nope" }).defaulted).toBe(true);
    expect(presets.map((p) => p.id)).toEqual(["ferdowsi", "sheikh-hadi", "baharestan"]);
  });

  it("20 invalid origin coordinates give a notice and no distances (never NaN)", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: { lat: NaN, lon: NaN, source: "manual" }, at: AT, pageSize: 5 })!;
    expect(r.origin).toBeNull();
    expect(r.notices.join()).toMatch(/معتبر نیست/);
    expect(r.sellers.every((s) => s.distanceMeters === null)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("NaN");
  });

  it("21 an unknown product id returns null (the page shows an honest not-found)", () => {
    expect(findSellersForProduct(db!, { productId: "product_00000000000000000000dead", origin: O })).toBeNull();
  });

  it("22 no phone number or contact string ever appears in the response", () => {
    const r = findSellersForProduct(db!, { productId: big!.p, variantGroupId: sel(big!.p), origin: O, radiusMeters: 10000, at: AT, pageSize: 50 })!;
    const s = JSON.stringify(r);
    expect(s).not.toMatch(/contacts_raw|tel:|\b09\d{9}\b|\+98\d{9,}/);
  });
});
