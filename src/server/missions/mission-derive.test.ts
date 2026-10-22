// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyAll, createMission, type MissionEvent } from "@/domain/mission";
import type { ReplyEvidence } from "@/domain/inquiry";
import { openRealDb } from "../../../tests/helpers/real-db";
import { resolveInquiryContext } from "@/server/inquiry/context";
import { deriveMissionView } from "@/lib/mission-derive";

const AT = "2026-10-22T09:00:00.000Z";
const P = "product_7308febc43c2f793fd0e1cf9", S = "shop_8670c71ca3baff62d68de422", O = "offer_742932354aecd83d7fc7c266";
const reply = (o: Partial<ReplyEvidence>): ReplyEvidence => ({ id: "r" + Math.random().toString(36).slice(2, 6), provenance: "USER_REPORTED", rawText: "", stock: "unknown", reportedPriceToman: null, reportedUnit: "same", model: "not_asked", warranty: { report: "not_asked", months: null }, payment: "not_asked", visitNote: "", receivedLabel: null, scenarioId: null, ...o });
const build = (extra: MissionEvent[] = []) => { const r = applyAll(createMission("msn_" + "3".repeat(32), AT), [{ type: "SELECT_PRODUCT", productId: P, variantGroupId: null }, { type: "SELECT_SHOP", shopId: S, offerId: O, via: "USER" }, { type: "SET_VISIT", visit: "2026-10-24T11:00" }, ...extra], AT); if (!r.ok) throw new Error(r.messageFa); return r.mission; };

const db = openRealDb();
describe.skipIf(!db)("deriveMissionView over a REAL, freshly re-derived context", () => {
  const ctx = () => { const r = resolveInquiryContext(db!, { product: P, variant: null, shop: S, offer: O, visit: "2026-10-24T11:00", now: new Date("2026-10-22T09:00:00Z") }); if (!r.ok) throw new Error(r.error); return r.context; };
  it("a user-reported out-of-stock opens UNAVAILABLE and blocks readiness; the dataset price is untouched", () => {
    const c = ctx(); const price = c.offer.priceToman;
    const m = build([{ type: "INQUIRY", event: { type: "ENTER_REPLY", reply: reply({ stock: "no" }), at: AT }, defaults: [] }]);
    const v = deriveMissionView(m, c);
    expect(v.triggers).toContain("UNAVAILABLE"); expect(v.readiness.ready).toBe(false); expect(v.outcome?.provenance).toBe("USER_REPORTED");
    expect(c.offer.priceToman).toBe(price);
  });
  it("a reported higher price is a PRICE_CHANGED trigger + caveat (not a blocker); the outcome says it never affects ranking", () => {
    const c = ctx();
    const m = build([{ type: "INQUIRY", event: { type: "ENTER_REPLY", reply: reply({ stock: "yes", reportedPriceToman: (c.offer.priceToman ?? 4_000_000) + 900_000 }), at: AT }, defaults: [] }]);
    const v = deriveMissionView(m, c);
    expect(v.allTriggers).toContain("PRICE_CHANGED"); expect(v.outcome?.affectsCanonicalRanking).toBe(false); expect(v.outcome?.priceDelta?.direction).toBe("higher");
    expect(v.readiness.caveats.join(" ")).toContain("تأییدنشده");
  });
  it("a different model blocks «همین کالا» (readiness false) until dismissed with awareness", () => {
    const c = ctx();
    const m = build([{ type: "INQUIRY", event: { type: "ENTER_REPLY", reply: reply({ model: "different" }), at: AT }, defaults: [] }]);
    const v = deriveMissionView(m, c);
    expect(v.outcome?.blocksExactConfirmation).toBe(true); expect(v.triggers).toContain("WRONG_MODEL");
    expect(v.readiness.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["VARIANT_BLOCKED", "TRIGGER_WRONG_MODEL"]));
  });
  it("a context for ANOTHER offer never yields an outcome for this mission (stale facts are not mixed in)", () => {
    const c = { ...ctx(), offer: { ...ctx().offer, id: "offer_00000000000000000000dead" } };
    expect(deriveMissionView(build(), c).outcome).toBeNull();
  });
  it("without context there are no triggers and no readiness claim beyond the checklist", () => {
    const v = deriveMissionView(build(), null);
    expect(v.triggers).toEqual([]); expect(v.outcome).toBeNull(); expect(v.readiness.ready).toBe(false);
  });
});
