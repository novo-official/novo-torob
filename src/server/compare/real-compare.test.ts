// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { openRealDb } from "../../../tests/helpers/real-db";
import type { ComparisonTier } from "@/domain/comparison";
import { haversineMeters } from "@/lib/geo";
import { findSellersForProduct } from "@/server/sellers/find";
import { getOriginPresets } from "@/server/sellers/origins";
import { compareSellersForProduct } from "./service";

const db = openRealDb();
afterAll(() => db?.close());
const q = <T,>(sql: string, ...p: Array<string | number>) => db!.prepare(sql).all(...p) as T[];
const one = <T,>(sql: string, ...p: Array<string | number>) => db!.prepare(sql).get(...p) as T;
const NOW = new Date("2026-10-22T09:00:00Z");

const DAHUA = "product_7308febc43c2f793fd0e1cf9";
const CM100 = "product_70a55b13ccc5a470ea3b007c";
const CABLE = "product_960832f67570cb3958ce6b1d";
const JD8500 = "product_190b8d5095203873323d045d";

const dominant = (productId: string) => {
  const r = findSellersForProduct(db!, { productId, origin: null, showUncertain: true, pageSize: 50, at: NOW })!;
  return { r, group: [...r.variant.groups].sort((a, b) => b.offerCount - a.offerCount)[0]!.id };
};
const cmp = (productId: string, variant: string | null, shopIds: string[], extra: Partial<Parameters<typeof compareSellersForProduct>[1]> = {}) =>
  compareSellersForProduct(db!, { productId, variantGroupId: variant, shopIds, now: NOW, ...extra })!;

describe.skipIf(!db)("seller comparison on the real dataset", () => {
  it("01 the shipped scenario products exist with the exact ids (verified before use)", () => {
    for (const id of [DAHUA, CM100, CABLE, JD8500]) expect(one<{ n: number }>("SELECT count(*) n FROM products WHERE product_id = ?", id).n).toBe(1);
    for (const id of ["offer_c5e7b056b065d44e66fe1351", "offer_6b489415b3ce4b49eaab320c", "offer_c5db86d093c6e2f0ddd32a2b"]) expect(one<{ n: number }>("SELECT count(*) n FROM offers WHERE offer_id = ?", id).n).toBe(1);
  });

  it("02 ≥ 20 data-backed ambiguous products: tiers are assigned, C/D are never ranked, original offer ids are preserved", () => {
    const candidates = q<{ p: string }>("SELECT product_id p FROM offers GROUP BY product_id HAVING count(DISTINCT shop_id) >= 5 AND count(DISTINCT unit_hint) >= 1 ORDER BY count(*) DESC LIMIT 400").map((r) => r.p);
    const tally: Record<ComparisonTier, number> = { A: 0, B: 0, C: 0, D: 0 };
    let ambiguous = 0;
    const verdicts = new Set<string>();
    for (const productId of candidates) {
      if (ambiguous >= 24) break;
      const { r, group } = dominant(productId);
      if (r.variant.groups.length < 2) continue; // ambiguous = more than one variant group
      ambiguous++;
      const sel = findSellersForProduct(db!, { productId, variantGroupId: group, origin: null, showUncertain: true, pageSize: 50, at: NOW })!;
      const inGroup = sel.sellers.filter((s) => s.offers.some((o) => o.variantMatch === "PLAUSIBLE")).map((s) => s.shopId);
      const outGroup = sel.sellers.filter((s) => !inGroup.includes(s.shopId)).map((s) => s.shopId);
      const pick = [...inGroup.slice(0, 3), ...outGroup.slice(0, 1)].slice(0, 4);
      if (pick.length < 2) { ambiguous--; continue; }
      const res = cmp(productId, group, pick);
      verdicts.add(res.verdict.kind);
      for (const s of res.sellers) {
        tally[s.tier]++;
        if (s.rank !== null) expect(["A", "B"]).toContain(s.tier);
        else expect(["C", "D"]).toContain(s.tier);
        const dbIds = q<{ offer_id: string }>("SELECT offer_id FROM offers WHERE product_id = ? AND shop_id = ?", productId, s.shopId).map((x) => x.offer_id).sort();
        expect(s.offers.map((o) => o.identity.offerId).sort(), `${productId}/${s.shopId}`).toEqual(dbIds);
        for (const o of s.offers) {
          const row = one<{ price_toman_raw: string | null; price_changed_at: string | null }>("SELECT price_toman_raw, price_changed_at FROM offers WHERE offer_id = ?", o.identity.offerId);
          expect(o.price.priceRaw).toBe(row.price_toman_raw);
          expect(o.price.recordedAt).toBe(row.price_changed_at);
        }
      }
      if (res.verdict.kind === "CHEAPEST_CONFIRMED") expect(res.sellers.filter((s) => s.price.comparability === "TRUSTED").every((s) => s.tier === "A")).toBe(true);
      if (res.verdict.winnerShopId) expect(res.sellers.find((s) => s.shopId === res.verdict.winnerShopId)!.price.comparability).toBe("TRUSTED");
    }
    expect(ambiguous).toBeGreaterThanOrEqual(20);
    expect(tally.A + tally.B + tally.C + tally.D).toBeGreaterThan(60);
    expect(tally.B + tally.C + tally.D).toBeGreaterThan(0);
    expect(verdicts.size).toBeGreaterThanOrEqual(2);
  });

  it("03 Dahua: the two suspiciously low records stay visible but are never declared cheapest", () => {
    const { group } = dominant(DAHUA);
    const lowShops = ["shop_0ca1ab09d6a27d703e3ea4a0", "shop_af02adae0bdd7e072ca665d6"];
    const others = ["shop_8670c71ca3baff62d68de422", "shop_350520090b6a5a6163f919d3"];
    const r = cmp(DAHUA, group, [...lowShops, ...others]);
    for (const id of lowShops) {
      const s = r.sellers.find((x) => x.shopId === id)!;
      expect(s.price.comparability).toBe("CAUTION");
      expect(s.price.cautions).toContain("FAR_BELOW_PEERS");
      expect(s.price.priceToman).toBeLessThan(3_000_000);
      expect(r.verdict.winnerShopId).not.toBe(id);
    }
    expect(r.verdict.setAsideShopIds.sort()).toEqual([...lowShops].sort());
    expect(r.verdict.kind).not.toBe("CHEAPEST_CONFIRMED");
    expect(r.verdict.detailFa).toContain("غیرعادی");
    expect(r.sellers.find((s) => s.shopId === lowShops[0])!.price.priceRaw).toBe("2480000");
    expect(r.sellers.find((s) => s.shopId === lowShops[0])!.offers[0]!.identity.offerId).toBe("offer_c5e7b056b065d44e66fe1351");
  });

  it("04 CM100 family: «CM100» vs «CM100/00» (keys CM10000 + CM100) is ambiguous — only a qualified claim, exact tier never granted to the sibling-looking family", () => {
    const { r } = dominant(CM100);
    const main = r.variant.groups.find((g) => g.modelKey === "CM100")!;
    // shop_c3f4… has plain «CM100» titles (no price); the others price «CM100/00» titles (keys CM10000 + CM100)
    const res = cmp(CM100, main.id, ["shop_c3f4f27075721da0a9fdadc3", "shop_62a70e0a67e2c5a6a7dc8012", "shop_248daa4a2b929af11a8c9195", "shop_397ae6408509bd6dd95ecfb7"]);
    const bySid = (id: string) => res.sellers.find((s) => s.shopId === id)!;
    expect(bySid("shop_c3f4f27075721da0a9fdadc3").tier).toBe("A");
    expect(bySid("shop_c3f4f27075721da0a9fdadc3").price.comparability).toBe("NO_PRICE");
    for (const id of ["shop_62a70e0a67e2c5a6a7dc8012", "shop_248daa4a2b929af11a8c9195", "shop_397ae6408509bd6dd95ecfb7"]) {
      expect(bySid(id).tier, id).toBe("B");
      expect(bySid(id).representative!.evidence).toContain("FAMILY_KEY_ONLY");
    }
    expect(res.verdict.kind).toBe("CHEAPEST_QUALIFIED");
    expect(res.verdict.winnerShopId).toBe("shop_62a70e0a67e2c5a6a7dc8012");
    expect(res.verdict.detailFa).toContain("تأیید بگیرید");
    expect(bySid("shop_c3f4f27075721da0a9fdadc3").offers.length).toBeGreaterThanOrEqual(6); // every duplicate/variant offer of the shop stays visible
  });

  it("05 cable: per-metre, roll and unstated offers are different units — never one cheapest", () => {
    const { r } = dominant(CABLE);
    const g = (u: string) => r.variant.groups.find((x) => x.unitHint === u)!;
    const rollShop = one<{ shop_id: string }>("SELECT shop_id FROM offers WHERE product_id = ? AND unit_hint = 'roll_or_pack' AND price_toman IS NOT NULL LIMIT 1", CABLE).shop_id;
    const metreShop = one<{ shop_id: string }>("SELECT shop_id FROM offers WHERE product_id = ? AND unit_hint = 'per_metre' AND price_toman IS NOT NULL LIMIT 1", CABLE).shop_id;
    const res = cmp(CABLE, g("roll_or_pack").id, [rollShop, metreShop]);
    const metre = res.sellers.find((s) => s.shopId === metreShop)!;
    expect(metre.tier).toBe("C");
    expect(metre.rank).toBeNull();
    expect(metre.representative!.evidence).toContain("UNIT_MISMATCH");
    expect(metre.price.comparability).toBe("IDENTITY_BLOCKED");
    expect(metre.price.priceToman).not.toBeNull(); // shown, but not comparable
    expect(["NO_WINNER_INSUFFICIENT", "NO_WINNER_MISMATCH"]).toContain(res.verdict.kind);
    expect(res.verdict.winnerShopId).toBeNull();
  });

  it("06 JD8500: a missing-price seller keeps its recorded payment channel and is never a winner or zero", () => {
    const { group } = dominant(JD8500);
    const noPriceShop = "shop_5a1036fcd76aa785a3cae975";
    const priced = q<{ shop_id: string }>("SELECT DISTINCT shop_id FROM offers WHERE product_id = ? AND price_toman IS NOT NULL AND shop_id != ? LIMIT 3", JD8500, noPriceShop).map((x) => x.shop_id);
    const res = cmp(JD8500, group, [noPriceShop, ...priced]);
    const s = res.sellers.find((x) => x.shopId === noPriceShop)!;
    expect(s.price.priceToman).toBeNull();
    expect(s.price.comparability).toBe("NO_PRICE");
    expect(s.payment.bucket).toBe("IN_PERSON_DECLARED");
    expect(s.payment.providers.map((p) => p.name).sort()).toEqual(["اسنپ‌پی", "ترب‌پی", "دیجی پی"].sort());
    expect(res.verdict.winnerShopId).not.toBe(noPriceShop);
    expect(s.reasons.map((x) => x.code)).toContain("PRICE_MISSING");
    expect(s.representative!.offerId).toBe("offer_c5db86d093c6e2f0ddd32a2b");
  });

  it("07 duplicate shop/product pairs: one card per shop, all offers kept separate", () => {
    const rep = one<{ p: string; s: string; n: number }>("SELECT product_id p, shop_id s, count(*) n FROM offers GROUP BY product_id, shop_id HAVING n >= 3 ORDER BY n DESC LIMIT 1");
    const { r, group } = dominant(rep.p);
    const others = r.sellers.map((s) => s.shopId).filter((s) => s !== rep.s).slice(0, 2);
    const res = cmp(rep.p, group, [rep.s, ...others]);
    expect(res.sellers.filter((s) => s.shopId === rep.s)).toHaveLength(1);
    expect(res.sellers.find((s) => s.shopId === rep.s)!.offers).toHaveLength(rep.n);
  });

  it("08 distances in the comparison equal an independent haversine and sort correctly under the distance priority", () => {
    const o = getOriginPresets(db!).find((p) => p.id === "ferdowsi")!;
    const { group } = dominant(DAHUA);
    const shops = ["shop_0ca1ab09d6a27d703e3ea4a0", "shop_af02adae0bdd7e072ca665d6", "shop_8670c71ca3baff62d68de422", "shop_350520090b6a5a6163f919d3"];
    const res = cmp(DAHUA, group, shops, { origin: { lat: o.lat, lon: o.lon, source: "manual", label: o.label }, priority: "distance" });
    const rankable = res.sellers.filter((s) => s.rank !== null);
    const d = rankable.map((s) => s.distanceMeters!);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    for (const s of res.sellers) {
      const row = one<{ lat: number; lon: number }>("SELECT lat, lon FROM shops WHERE shop_id = ?", s.shopId);
      expect(Math.abs(s.distanceMeters! - haversineMeters(o.lat, o.lon, row.lat, row.lon))).toBeLessThan(0.001);
    }
  });

  it("09 changing priority / visit time / origin re-ranks deterministically; same inputs → identical output", () => {
    const { group } = dominant(DAHUA);
    const shops = ["shop_8670c71ca3baff62d68de422", "shop_350520090b6a5a6163f919d3", "shop_b9fb908b2026d1e5130b9326".replace("b9fb908b2026d1e5130b9326", "1a8cd0e9656f78ec6a7fad33")];
    const a = cmp(DAHUA, group, shops, { priority: "price", visit: "2026-10-24T11:00" });
    const b = cmp(DAHUA, group, shops, { priority: "price", visit: "2026-10-24T11:00" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = cmp(DAHUA, group, shops, { priority: "hours", visit: "2026-10-24T03:00" }); // 03:00 on a Saturday: nobody declares it
    expect(c.sellers.every((s) => s.hours.state !== "WITHIN_DECLARED")).toBe(true);
    expect(c.criteria.visitIsNow).toBe(false);
    expect(c.criteria.visitAtTehran).toBe("2026-10-24T03:00:00.000Z".replace("03:00:00.000Z", "23:30:00.000Z").replace("2026-10-24", "2026-10-23"));
  });

  it("10 no variant chosen on an ambiguous product → nothing is ranked and the verdict declines", () => {
    const { r } = dominant(CABLE);
    const shops = r.sellers.slice(0, 3).map((s) => s.shopId);
    const res = cmp(CABLE, null, shops);
    expect(res.situation).toBe("VARIANT_UNCONFIRMED");
    expect(res.sellers.every((s) => s.rank === null)).toBe(true);
    expect(res.verdict.winnerShopId).toBeNull();
  });

  it("11 invalid inputs degrade safely: unknown product → null, bad shop ids dropped with a notice, >4 shops capped", () => {
    expect(compareSellersForProduct(db!, { productId: "product_00000000000000000000dead", shopIds: [] })).toBeNull();
    const { r, group } = dominant(DAHUA);
    const ids = r.sellers.map((s) => s.shopId);
    const res = cmp(DAHUA, group, ["shop_00000000000000000000dead", "not-a-shop", ...ids.slice(0, 6)]);
    expect(res.sellers.length).toBeLessThanOrEqual(4);
    expect(res.notices.join(" ")).toMatch(/پیدا نشد|معتبر نیست|حداکثر/);
    const bad = cmp(DAHUA, group, ids.slice(0, 2), { visit: "2026-02-31T10:00" });
    expect(bad.criteria.visitIsNow).toBe(true);
    expect(bad.notices.join(" ")).toContain("زمان بازدید معتبر نیست");
  });

  it("12 candidates to add come from the same Selection, exclude chosen shops, and no phone/contact appears anywhere", () => {
    const { r, group } = dominant(DAHUA);
    const res = cmp(DAHUA, group, r.sellers.slice(0, 2).map((s) => s.shopId), { radiusMeters: 5000 });
    expect(res.candidates.length).toBeGreaterThan(0);
    for (const c of res.candidates) expect(res.requestedShopIds).not.toContain(c.shopId);
    expect(JSON.stringify(res)).not.toMatch(/contacts_raw|tel:|\b09\d{9}\b|\+98\d{9,}/);
    expect(res.time.snapshotRef).toBe("2026-10-13T00:02:35.297Z");
    expect(res.time.todayTehran).toBe("2026-10-22");
  });
});
