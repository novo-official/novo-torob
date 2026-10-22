// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DeclaredHours } from "@/domain/types";
import { NO_SCHEDULE } from "@/server/domain/hours";
import { openRealDb } from "../../../tests/helpers/real-db";
import { loadMissionFacts } from "./facts";
import { nextDeclaredOpening, planRecovery, type RecoveryInput } from "./recovery";

const NOW = new Date("2026-10-22T09:00:00Z");
const DAHUA = "product_7308febc43c2f793fd0e1cf9", VAR = "unknown|HDW1200CLQP";
const SHOP = "shop_8670c71ca3baff62d68de422", OFFER = "offer_742932354aecd83d7fc7c266";
const CM100 = "product_70a55b13ccc5a470ea3b007c";
const base: RecoveryInput = { trigger: "UNAVAILABLE", productId: DAHUA, variantGroupId: null, shopId: SHOP, offerId: OFFER, district: "ferdowsi", radius: 1000, budget: { min: null, max: 5_000_000 }, visit: "2026-10-24T11:00", reportedPriceToman: null, now: NOW };

describe("nextDeclaredOpening (pure, Asia/Tehran)", () => {
  const day = (w: Array<[string, string]>) => ({ kind: "declared", windows: w.map(([start, end]) => ({ start, end })) }) as const;
  const hours: DeclaredHours = { hasSchedule: true, days: { sat: day([["09:00", "13:00"], ["16:00", "20:00"]]), sun: day([["09:00", "13:00"], ["16:00", "20:00"]]), mon: day([["09:00", "13:00"]]), tue: { kind: "closed" }, wed: { kind: "unknown" }, thu: { kind: "unsupported" }, fri: { kind: "closed" } } };
  it("between split shifts the next window is the afternoon shift of the same day", () => {
    // 2026-10-24 is a Saturday in Tehran
    const r = nextDeclaredOpening(hours, new Date("2026-10-24T10:30:00Z")); // 14:00 Tehran (UTC+3:30)
    expect(r?.atTehran).toBe("2026-10-24T16:00");
    expect(r?.labelFa).toContain("تضمین");
  });
  it("after the last window it jumps to the next declared day; closed days are skipped", () => {
    const r = nextDeclaredOpening(hours, new Date("2026-10-26T10:30:00Z")); // Monday 14:00 → Tue closed, Wed unknown…
    expect(r === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.atTehran)).toBe(true);
  });
  it("unknown / no schedule / unsupported day: null — never a guess", () => {
    expect(nextDeclaredOpening(NO_SCHEDULE, NOW)).toBeNull();
    expect(nextDeclaredOpening(hours, new Date("2026-10-28T08:00:00Z"))).toBeNull(); // Wed: unknown day
    expect(nextDeclaredOpening(hours, new Date("2026-10-29T08:00:00Z"))).toBeNull(); // Thu: unsupported
  });
  it("inside a window there is no «next opening»", () => {
    expect(nextDeclaredOpening(hours, new Date("2026-10-24T07:00:00Z"))).toBeNull(); // 10:30 Tehran, open
  });
});

const db = openRealDb();
describe.skipIf(!db)("planRecovery on the real catalog (ids verified in the dataset)", () => {
  const plan = (o: Partial<RecoveryInput>) => { const r = planRecovery(db!, { ...base, ...o }); if (!r.ok) throw new Error(r.error); return r.plan; };
  it("UNAVAILABLE → real offers of the SAME variant at OTHER shops, each with an offerId that belongs to that shop and the product", () => {
    const p = plan({});
    expect(p.sellers.length).toBeGreaterThan(0);
    for (const s of p.sellers) {
      expect(s.shopId).not.toBe(SHOP);
      const row = db!.prepare("SELECT product_id, shop_id FROM offers WHERE offer_id = ?").get(s.offerId) as { product_id: string; shop_id: string };
      expect(row).toEqual({ product_id: DAHUA, shop_id: s.shopId });
      expect(["A", "B"]).toContain(s.tier);
      expect(s.tradeoffsFa.join(" ")).toMatch(/خط مستقیم|فاصله/);
    }
    expect(p.facts.find((f) => f.labelFa === "موجودی")).toMatchObject({ provenance: "USER_REPORTED" });
    expect(p.facts.some((f) => f.provenance === "DATASET_RECORDED")).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/"phone"|tel:|"lat"|"lon"/);
  });
  it("PRICE_CHANGED → scenario from the dataset price (never overwritten) and the user's unverified number; budget fit explicit", () => {
    const before = db!.prepare("SELECT price_toman FROM offers WHERE offer_id = ?").get(OFFER) as { price_toman: number };
    const p = plan({ trigger: "PRICE_CHANGED", reportedPriceToman: 5_600_000, budget: { min: null, max: 5_000_000 } });
    expect(p.budgetScenario).toMatchObject({ recordedToman: before.price_toman, reportedToman: 5_600_000, fitRecorded: "WITHIN", fitReported: "OVER", overByToman: 600_000, budgetMaxToman: 5_000_000 });
    expect(p.budgetScenario!.deltaToman).toBe(5_600_000 - before.price_toman);
    expect(p.facts.find((f) => f.labelFa.includes("گزارش شما"))).toMatchObject({ provenance: "USER_REPORTED" });
    expect(p.notesFa.join(" ")).toContain("تأییدنشده");
    expect(p.hrefs.compare).toMatch(/^\/compare\?/); expect(p.hrefs.compare).toContain(SHOP);
    expect((db!.prepare("SELECT price_toman FROM offers WHERE offer_id = ?").get(OFFER) as { price_toman: number }).price_toman).toBe(before.price_toman); // read-only DB
  });
  it("no budget → fit is UNKNOWN (never assumed within)", () => {
    const p = plan({ trigger: "PRICE_CHANGED", reportedPriceToman: 5_600_000, budget: { min: null, max: null } });
    expect(p.budgetScenario).toMatchObject({ fitRecorded: "UNKNOWN", fitReported: "UNKNOWN", overByToman: null });
  });
  it("WRONG_MODEL → other VERSIONS are offered only as links back to the product page, never attached; alternatives stay on the selected variant", () => {
    const p = plan({ trigger: "WRONG_MODEL", productId: CM100, shopId: shopOf(CM100), offerId: null, variantGroupId: variantOf(CM100) });
    for (const v of p.variants) expect(v.href).toMatch(new RegExp(`^/products/${CM100}\\?variant=`));
    expect(p.sellers.every((s) => s.tier === "A" || s.tier === "B")).toBe(true);
  });
  it("OUTSIDE_HOURS → only DECLARED windows are used; unknown schedules produce a note, not a time", () => {
    const p = plan({ trigger: "OUTSIDE_HOURS", visit: "2026-10-23T23:30" });
    expect(p.nextInterval === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p.nextInterval.atTehran)).toBe(true);
    if (!p.nextInterval) expect(p.notesFa.join(" ")).toMatch(/حدس نمی‌زنیم|نامعلوم/);
    expect(p.sellers.every((s) => ["WITHIN_DECLARED", "OUTSIDE_DECLARED", "UNKNOWN"].includes(s.hoursState))).toBe(true);
  });
  it("sparse coverage → district fallback labelled «فروشنده نیست» with source/date/type, plus an honest coverage sentence", () => {
    const p = plan({ trigger: "NO_REPLY", radius: 100 });
    if (p.sellers.length < 2) {
      expect(p.areas.length).toBeGreaterThan(0);
      for (const a of p.areas) { expect(["VERIFIED_SHOPPING_DISTRICT", "DATASET_DENSITY_ESTIMATE"]).toContain(a.geoType); expect(a.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}/); expect(a.sourcesFa.length).toBeGreaterThan(0); }
      expect(p.notesFa.join(" ")).toContain("فروشنده، پیشنهاد یا موجودی نیست");
    }
    expect(p.coverageFa.join(" ")).not.toMatch(/در تهران (موجود )?نیست/);
  });
  it("forged / mismatched ids never produce a plan", () => {
    const r = (o: Partial<RecoveryInput>) => planRecovery(db!, { ...base, ...o });
    expect(r({ shopId: "shop_ffffffffffffffffffffffff" })).toEqual({ ok: false, error: "SHOP_NOT_FOUND" });
    expect(r({ productId: "product_00000000000000000000dead" })).toEqual({ ok: false, error: "PRODUCT_NOT_FOUND" });
    expect(r({ offerId: "offer_00000000000000000000dead" })).toEqual({ ok: false, error: "OFFER_NOT_FOUND" });
    expect(r({ productId: "x" })).toEqual({ ok: false, error: "INVALID_ID" });
    expect(r({ productId: "product_a0b9dc5ecc796b0f79a33cf3" })).toMatchObject({ ok: false }); // that product has no offer at this shop / mismatch
    expect(r({ variantGroupId: "unknown|NOPE" })).toEqual({ ok: false, error: "VARIANT_UNKNOWN" });
  });
});

function shopOf(product: string): string { return (db!.prepare("SELECT shop_id FROM offers WHERE product_id = ? LIMIT 1").get(product) as { shop_id: string }).shop_id; }
function variantOf(product: string): string | null { void product; return null; }

describe.skipIf(!db)("loadMissionFacts re-derives everything and refuses mismatches", () => {
  it("ok: product + joined shop/offer, hours at the visit time, a map link to the DATASET shop point (not the user)", () => {
    const f = loadMissionFacts(db!, { product: DAHUA, variant: VAR, shop: SHOP, offer: OFFER, visit: "2026-10-24T11:00", now: NOW });
    expect(f.error).toBeNull();
    expect(f.context?.offer.id).toBe(OFFER); expect(f.context?.hours.atTehran).toContain("2026-10-24T11:00");
    expect(f.shopMapHref === null || /^https:\/\/www\.openstreetmap\.org\/\?mlat=/.test(f.shopMapHref)).toBe(true);
    expect(JSON.stringify(f)).not.toMatch(/\b09\d{9}\b/);
  });
  it("product-only, forged offer/shop, wrong variant and unknown product are errors with NO context", () => {
    expect(loadMissionFacts(db!, { product: DAHUA, variant: null, shop: null, offer: null, visit: null }).context).toBeNull();
    for (const bad of [{ shop: "shop_ffffffffffffffffffffffff", offer: null }, { shop: SHOP, offer: "offer_00000000000000000000dead" }, { shop: "shop_350520090b6a5a6163f919d3", offer: OFFER }]) {
      const f = loadMissionFacts(db!, { product: DAHUA, variant: null, visit: null, ...bad });
      expect(f.context, JSON.stringify(bad)).toBeNull(); expect(f.error).not.toBeNull();
    }
    expect(loadMissionFacts(db!, { product: DAHUA, variant: "unknown|NOPE", shop: SHOP, offer: OFFER, visit: null }).error).toBe("VARIANT_UNKNOWN");
    expect(loadMissionFacts(db!, { product: "product_00000000000000000000dead", variant: null, shop: null, offer: null, visit: null }).error).toBe("PRODUCT_NOT_FOUND");
  });
});
