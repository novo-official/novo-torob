// @vitest-environment node
import { describe, expect, it } from "vitest";
import { initialInquiryState, type ReplyEvidence } from "./inquiry";
import {
  activeInquiry, applyAll, legacyStateOf, nextHintFa, checklistDef, createMission, exportChecklistText, itemState, MISSION_ID_RE, missionPhase, missionReducer, newMissionId, readiness, summarizeMissionForAgent, triggersOf,
  type MissionEvent, type ShoppingMissionV1,
} from "./mission";

const AT = "2026-10-22T09:00:00.000Z";
const ID = "msn_" + "a".repeat(32);
const P1 = "product_7308febc43c2f793fd0e1cf9", P2 = "product_a0b9dc5ecc796b0f79a33cf3";
const S1 = "shop_8670c71ca3baff62d68de422", S2 = "shop_350520090b6a5a6163f919d3";
const O1 = "offer_742932354aecd83d7fc7c266", O2 = "offer_0000000000000000000000aa";
const user = (over: Partial<ReplyEvidence> = {}): ReplyEvidence => ({ id: "r1", provenance: "USER_REPORTED", rawText: "", stock: "unknown", reportedPriceToman: null, reportedUnit: "same", model: "not_asked", warranty: { report: "not_asked", months: null }, payment: "not_asked", visitNote: "", receivedLabel: null, scenarioId: null, ...over });
const ev = (m: ShoppingMissionV1, ...es: MissionEvent[]): ShoppingMissionV1 => { const r = applyAll(m, es, AT); if (!r.ok) throw new Error(r.messageFa); return r.mission; };
const base = () => createMission(ID, AT);
const withShop = () => ev(base(), { type: "SELECT_PRODUCT", productId: P1, variantGroupId: "unknown|HDW1200CLQP" }, { type: "SELECT_SHOP", shopId: S1, offerId: O1, via: "USER" }, { type: "SET_VISIT", visit: "2026-10-24T11:00" });
const facts = { hoursState: "WITHIN_DECLARED" as const, blocksExactConfirmation: false, triggers: [] };
const markAll = (m: ShoppingMissionV1) => ev(m, ...(["confirm_model", "ask_stock_price", "check_hours", "verify_location"] as const).map((item) => ({ type: "CHECK" as const, item, kind: "done" as const })), { type: "CHECK", item: "contact_result", kind: "skipped" });

describe("ids", () => {
  it("are 128-bit random, well-formed and not derived from content", () => {
    const a = newMissionId(), b = newMissionId();
    expect(a).toMatch(MISSION_ID_RE); expect(a).not.toBe(b);
    expect(newMissionId(() => new Uint8Array(16).fill(255))).toBe("msn_" + "f".repeat(32));
  });
});

describe("invariants: a mission cannot skip, mix or fake", () => {
  it("cannot select a shop/offer before a product, with malformed ids, or tick/inquire before a shop", () => {
    expect(missionReducer(base(), { type: "SELECT_SHOP", shopId: S1, offerId: O1, via: "USER" }, AT)).toMatchObject({ ok: false, error: "NO_PRODUCT" });
    const p = ev(base(), { type: "SELECT_PRODUCT", productId: P1, variantGroupId: null });
    expect(missionReducer(p, { type: "SELECT_SHOP", shopId: "shop_x", offerId: O1, via: "USER" }, AT)).toMatchObject({ ok: false, error: "BAD_ID" });
    expect(missionReducer(p, { type: "SELECT_SHOP", shopId: S1, offerId: "../offer", via: "USER" }, AT)).toMatchObject({ ok: false, error: "BAD_ID" });
    expect(missionReducer(p, { type: "CHECK", item: "confirm_model", kind: "done" }, AT)).toMatchObject({ ok: false, error: "NO_SHOP" });
    expect(missionReducer(p, { type: "INQUIRY", event: { type: "COPY", at: AT } }, AT)).toMatchObject({ ok: false, error: "NO_SHOP" });
    expect(missionReducer(base(), { type: "SELECT_PRODUCT", productId: "product_../../x", variantGroupId: null }, AT)).toMatchObject({ ok: false, error: "BAD_ID" });
  });
  it("rejects invalid budget, radius, district and visit values", () => {
    for (const e of [{ type: "SET_BUDGET", min: 5, max: 3 }, { type: "SET_BUDGET", min: -1, max: null }, { type: "SET_BUDGET", min: 1.5, max: null }, { type: "SET_AREA", district: "home" as never, radius: 1000 }, { type: "SET_AREA", district: null, radius: 5 }, { type: "SET_VISIT", visit: "tomorrow" }] as MissionEvent[]) expect(missionReducer(base(), e, AT).ok, JSON.stringify(e)).toBe(false);
  });
  it("a changed product or VARIANT drops the seller-linked parts; need / budget / area / visit / priority stay", () => {
    let m = ev(withShop(), { type: "SET_BUDGET", min: null, max: 5_000_000 }, { type: "SET_AREA", district: "baharestan", radius: 2000 }, { type: "SET_PRIORITY", priority: "distance" }, { type: "SET_NEED", text: "دوربین مغازه", category: "دوربین" });
    m = ev(m, { type: "INQUIRY", event: { type: "COPY", at: AT }, defaults: ["q1"] });
    expect(m.inquiries).toHaveLength(1);
    const v = ev(m, { type: "SELECT_VARIANT", variantGroupId: "unknown|OTHER" });
    expect(v.shop).toBeNull(); expect(v.inquiries).toEqual([]); expect(v.shortlist).toEqual([]);
    expect(v.product).toEqual({ productId: P1, variantGroupId: "unknown|OTHER" });
    const p = ev(m, { type: "SELECT_PRODUCT", productId: P2, variantGroupId: null });
    expect(p.shop).toBeNull(); expect(p.inquiries).toEqual([]);
    for (const x of [v, p]) expect([x.budget, x.area, x.priority, x.visit, x.need]).toEqual([m.budget, m.area, m.priority, m.visit, m.need]);
  });
  it("is idempotent: the same event twice changes nothing (no rev bump, no duplicate timeline)", () => {
    const m = withShop();
    for (const e of [{ type: "SELECT_PRODUCT", productId: P1, variantGroupId: "unknown|HDW1200CLQP" }, { type: "SELECT_SHOP", shopId: S1, offerId: O1, via: "USER" }, { type: "SET_VISIT", visit: "2026-10-24T11:00" }] as MissionEvent[]) {
      const r = missionReducer(m, e, AT);
      expect(r).toMatchObject({ ok: true, changed: false }); if (r.ok) expect(r.mission).toBe(m);
    }
  });
  it("rev increases by exactly one per accepted event, and timeline entries carry it", () => {
    const m = withShop();
    expect(m.rev).toBe(3);
    expect(m.timeline.map((t) => t.rev)).toEqual([1, 2, 3]);
  });
});

describe("provenance: simulated replies can never get in", () => {
  it("the only way a reply enters is the Phase 6 reducer, which accepts USER_REPORTED only", () => {
    const m = withShop();
    const demo = { ...user({ id: "d1" }), provenance: "DEMO_SIMULATED" as never };
    const r = missionReducer(m, { type: "INQUIRY", event: { type: "ENTER_REPLY", reply: demo, at: AT }, defaults: [] }, AT);
    expect(r.ok && activeInquiry(r.mission)?.replies).toEqual([]);
    expect(JSON.stringify(r.ok ? r.mission : {})).not.toMatch(/DEMO_SIMULATED/);
    const ok = ev(m, { type: "INQUIRY", event: { type: "ENTER_REPLY", reply: user({ stock: "no" }), at: AT }, defaults: [] });
    expect(activeInquiry(ok)?.status).toBe("USER_REPORTED_UNAVAILABLE");
    expect(ok.timeline.at(-1)).toMatchObject({ provenance: "USER_REPORTED" });
  });
  it("no timeline provenance exists for demo/verified; a typed export of the mission has no demo, phone or coordinate field", () => {
    const m = ev(withShop(), { type: "INQUIRY", event: { type: "ENTER_REPLY", reply: user({ stock: "yes", rawText: "گفت هست" }), at: AT }, defaults: [] });
    expect(new Set(m.timeline.map((t) => t.provenance))).toEqual(new Set(["USER_ACTION", "USER_REPORTED"]));
    expect(JSON.stringify(m)).not.toMatch(/phone|tel:|"lat"|"lon"|gps|DEMO|verified":true/i);
    expect(activeInquiry(m)?.replies[0]!.provenance).toBe("USER_REPORTED");
  });
  it("a note is kept only with explicit consent; removing consent removes it", () => {
    const m = withShop();
    expect(ev(m, { type: "SET_NOTES", text: "یادداشت", consent: false }).notes).toBeNull();
    const n = ev(m, { type: "SET_NOTES", text: "یادداشت من", consent: true });
    expect(n.notes).toBe("یادداشت من");
    expect(ev(n, { type: "SET_NOTES", text: "یادداشت من", consent: false }).notes).toBeNull();
  });
});

describe("switching seller: only stale seller-linked confirmations stop counting", () => {
  it("ticks are bound to shop|offer(|visit): another shop sees none, coming back sees them again; the contact result follows the inquiry of THAT offer", () => {
    let m = ev(withShop(), { type: "CHECK", item: "confirm_model", kind: "done" }, { type: "CHECK", item: "check_hours", kind: "done" }, { type: "INQUIRY", event: { type: "ENTER_REPLY", reply: user({ stock: "yes" }), at: AT }, defaults: [] });
    expect(itemState(m, "confirm_model").state).toBe("done"); expect(itemState(m, "contact_result")).toEqual({ state: "done", derived: true });
    m = ev(m, { type: "SELECT_SHOP", shopId: S2, offerId: O2, via: "USER" });
    expect(["confirm_model", "check_hours", "contact_result"].map((i) => itemState(m, i as never).state)).toEqual(["pending", "pending", "pending"]);
    expect(m.budget).toEqual(withShop().budget);
    m = ev(m, { type: "SELECT_SHOP", shopId: S1, offerId: O1, via: "USER" });
    expect(itemState(m, "confirm_model").state).toBe("done"); expect(itemState(m, "contact_result").derived).toBe(true);
  });
  it("changing ONLY the visit time re-opens the hours check but keeps the model/stock checks", () => {
    let m = ev(withShop(), { type: "CHECK", item: "confirm_model", kind: "done" }, { type: "CHECK", item: "check_hours", kind: "done" });
    m = ev(m, { type: "SET_VISIT", visit: "2026-10-25T16:00" });
    expect(itemState(m, "confirm_model").state).toBe("done");
    expect(itemState(m, "check_hours").state).toBe("pending");
    m = ev(m, { type: "SET_VISIT", visit: "2026-10-24T11:00" });
    expect(itemState(m, "check_hours").state).toBe("done"); // same shop+time again
  });
  it("«نتیجه‌ی پرسش» cannot be ticked as done by hand — only a user-entered reply (or an explicit skip) satisfies it", () => {
    expect(missionReducer(withShop(), { type: "CHECK", item: "contact_result", kind: "done" }, AT)).toMatchObject({ ok: false, error: "NOT_APPLICABLE" });
    expect(itemState(ev(withShop(), { type: "CHECK", item: "contact_result", kind: "skipped" }), "contact_result")).toEqual({ state: "skipped", derived: false });
  });
});

describe("readiness is «reviewed», never «verified stock»", () => {
  it("needs product, shop, an explicit visit time and every required check; optional ones don't block", () => {
    expect(readiness(base(), facts).blockers.map((b) => b.code)).toContain("NO_PRODUCT");
    expect(readiness(ev(base(), { type: "SELECT_PRODUCT", productId: P1, variantGroupId: null }), facts).blockers.map((b) => b.code)).toContain("NO_SHOP");
    const noVisit = ev(base(), { type: "SELECT_PRODUCT", productId: P1, variantGroupId: null }, { type: "SELECT_SHOP", shopId: S1, offerId: O1, via: "USER" });
    expect(readiness(noVisit, facts).blockers.map((b) => b.code)).toContain("NO_VISIT");
    const part = ev(withShop(), { type: "CHECK", item: "confirm_model", kind: "done" });
    const rp = readiness(part, facts);
    expect(rp.ready).toBe(false); expect(rp.remaining).toEqual(["ask_stock_price", "contact_result", "check_hours", "verify_location"]);
    const full = markAll(withShop());
    const r = readiness(full, facts);
    expect(r).toMatchObject({ ready: true, remaining: [] });
    expect(r.caveats.join(" ")).toContain("تأییدشده نیست");
    expect(checklistDef("ask_warranty_payment").required).toBe(false);
  });
  it("is blocked by a different model, a user-reported out-of-stock, and a visit outside declared hours (until dismissed / changed)", () => {
    const full = markAll(withShop());
    expect(readiness(full, { ...facts, blocksExactConfirmation: true }).blockers.map((b) => b.code)).toContain("VARIANT_BLOCKED");
    expect(readiness(full, { ...facts, triggers: ["UNAVAILABLE"] }).ready).toBe(false);
    expect(readiness(full, { ...facts, hoursState: "OUTSIDE_DECLARED", triggers: ["OUTSIDE_HOURS"] }).ready).toBe(false);
    const dismissed = ev(full, { type: "RECOVERY_DECISION", trigger: "OUTSIDE_HOURS", resolution: "DISMISSED" });
    expect(readiness(dismissed, { ...facts, hoursState: "OUTSIDE_DECLARED", triggers: ["OUTSIDE_HOURS"] }).ready).toBe(true);
    // a PRICE change is a caveat, not a blocker
    const rp = readiness(full, { ...facts, triggers: ["PRICE_CHANGED"] });
    expect(rp.ready).toBe(true); expect(rp.caveats.join(" ")).toContain("تأییدنشده");
  });
  it("unknown hours are a caveat, never «closed» and never «open»", () => {
    const r = readiness(markAll(withShop()), { ...facts, hoursState: "UNKNOWN" });
    expect(r.ready).toBe(true); expect(r.caveats.join(" ")).toContain("نامعلوم");
  });
  it("MARK_VISITED needs the caller's fresh ready flag; a closed mission accepts nothing but REOPEN", () => {
    const m = markAll(withShop());
    expect(missionReducer(m, { type: "MARK_VISITED" }, AT)).toMatchObject({ ok: false, error: "NOT_READY" });
    const r = missionReducer(m, { type: "MARK_VISITED" }, AT, { readyNow: true });
    expect(r.ok && r.mission.status).toBe("VISITED");
    const done = r.ok ? r.mission : m;
    expect(missionReducer(done, { type: "SET_VISIT", visit: "2026-10-26T10:00" }, AT)).toMatchObject({ ok: false, error: "NOT_ACTIVE" });
    expect(readiness(done, facts).blockers[0]!.code).toBe("NOT_ACTIVE");
    const reopened = ev(done, { type: "REOPEN" });
    expect(reopened.status).toBe("ACTIVE");
    const ab = ev(reopened, { type: "ABANDON" });
    expect(missionPhase(ab, false)).toBe("ABANDONED");
  });
});

describe("derived phase (never stored) and recovery bookkeeping", () => {
  it("walks need → product → sellers → inquiry → await → replied → ready → visited from the facts alone", () => {
    expect(missionPhase(base(), false)).toBe("NEED");
    expect(missionPhase(ev(base(), { type: "SET_NEED", text: "هدفون", category: null }), false)).toBe("PRODUCT");
    const p = ev(base(), { type: "SELECT_PRODUCT", productId: P1, variantGroupId: null });
    expect(missionPhase(p, false)).toBe("SELLERS");
    let m = ev(p, { type: "SELECT_SHOP", shopId: S1, offerId: O1, via: "USER" });
    expect(missionPhase(m, false)).toBe("INQUIRY");
    m = ev(m, { type: "INQUIRY", event: { type: "MARK_CONTACTED", at: AT }, defaults: [] });
    expect(missionPhase(m, false)).toBe("AWAIT_REPLY"); // the user says they asked: now waiting for THEIR report
    m = ev(m, { type: "INQUIRY", event: { type: "MARK_NO_RESPONSE", at: AT }, defaults: [] });
    expect(missionPhase(m, false)).toBe("AWAIT_REPLY");
    m = ev(m, { type: "INQUIRY", event: { type: "ENTER_REPLY", reply: user({ stock: "yes" }), at: AT }, defaults: [] });
    expect(missionPhase(m, false)).toBe("REPLIED");
    expect(missionPhase(m, true)).toBe("VISIT_READY");
  });
  it("triggers come from the user's own reports + declared hours only", () => {
    expect(triggersOf({ flags: ["STOCK_REPORTED_NO", "PRICE_HIGHER", "MODEL_DIFFERENT", "PAYMENT_NOT_AVAILABLE"], inquiryStatus: "USER_REPORTED_UNAVAILABLE", hoursState: "OUTSIDE_DECLARED" }).sort())
      .toEqual(["OUTSIDE_HOURS", "PAYMENT_WARRANTY", "PRICE_CHANGED", "UNAVAILABLE", "WRONG_MODEL"]);
    expect(triggersOf({ flags: [], inquiryStatus: "NO_RESPONSE", hoursState: "UNKNOWN" })).toEqual(["NO_REPLY"]);
    expect(triggersOf({ flags: ["VISIT_HOURS_UNKNOWN"], inquiryStatus: null, hoursState: "UNKNOWN" })).toEqual([]); // unknown hours are never a "closed" trigger
  });
  it("a decision is logged; DISMISSED is bound to the current shop/offer and does not carry to another offer", () => {
    let m = ev(withShop(), { type: "RECOVERY_DECISION", trigger: "UNAVAILABLE", resolution: "DISMISSED" });
    expect(m.recovery.history).toHaveLength(1); expect(m.recovery.dismissed).toHaveLength(1);
    expect(readiness(markAll(m), { ...facts, triggers: ["UNAVAILABLE"] }).ready).toBe(true);
    m = ev(m, { type: "SELECT_SHOP", shopId: S2, offerId: O2, via: "RECOVERY" });
    expect(readiness(markAll(m), { ...facts, triggers: ["UNAVAILABLE"] }).ready).toBe(false);
    expect(m.timeline.at(-1)!.textFa).toContain("بازیابی");
  });
});

describe("export + agent summary carry provenance and nothing unverified", () => {
  it("the checklist text is for the user, says nothing was sent, and never claims confirmed stock", () => {
    const m = ev(withShop(), { type: "CHECK", item: "confirm_model", kind: "done" });
    const t = exportChecklistText(m, { productTitle: "دوربین", shopName: "فروشگاه نمونه", priceText: "۴٬۱۰۰٬۰۰۰ تومان", priceNoteFa: "قیمت امروز نیست", hoursLabelFa: "داخل ساعت اعلام‌شده", visitLabelFa: "۱۴۰۵/۰۸/۰۲ ۱۱:۰۰", addressFa: null }, readiness(m, facts));
    expect(t).toContain("پیام به فروشنده نیست"); expect(t).toContain("☑"); expect(t).toContain("☐");
    expect(t).not.toMatch(/موجود است|تأیید شد|ارسال شد/); expect(t).not.toMatch(/\b09\d{9}\b|tel:|DEMO/);
  });
  it("the typed agent summary is read-only, flags user reports unverified, and has no simulated data", () => {
    const m = ev(withShop(), { type: "INQUIRY", event: { type: "ENTER_REPLY", reply: user({ stock: "yes", reportedPriceToman: 4_200_000, rawText: "x" }), at: AT }, defaults: [] });
    const s = summarizeMissionForAgent(m, false);
    expect(s).toMatchObject({ kind: "MISSION_SUMMARY", source: "USER_PLAN", writable: false, shopId: S1, offerId: O1 });
    expect(s.userReported).toEqual([{ stock: "yes", reportedPriceToman: 4_200_000, model: "not_asked", verified: false }]);
    expect(JSON.stringify(s)).not.toMatch(/rawText|DEMO|phone/);
  });
  it("createMission/initial inquiry states stay in sync with the Phase 6 contract", () => {
    expect(initialInquiryState([]).v).toBe(1);
    expect(base()).toMatchObject({ v: 1, rev: 0, status: "ACTIVE", product: null, shop: null, inquiries: [] });
  });
});

describe("bridge to the Phase 1/6 state machine and timeline hints", () => {
  it("every derived phase maps to a Phase 1 MissionState consistent with missionStateFor for the inquiry part", async () => {
    const { MISSION_STATES } = await import("./mission-state");
    const { missionStateFor } = await import("./inquiry");
    for (const p of ["NEED", "PRODUCT", "SELLERS", "INQUIRY", "AWAIT_REPLY", "REPLIED", "VISIT_READY", "VISITED", "ABANDONED"] as const) expect(MISSION_STATES).toContain(legacyStateOf(p));
    expect(legacyStateOf("INQUIRY")).toBe(missionStateFor("DRAFT", null));
    expect(legacyStateOf("REPLIED")).toBe(missionStateFor("USER_REPORTED_AVAILABLE", null));
  });
  it("each timeline event carries what to do next, derived after the event", () => {
    const m = withShop();
    expect(m.timeline.at(-1)!.nextFa).toBe(nextHintFa(m));
    expect(m.timeline[0]!.nextFa).toContain("فروشگاه");
    expect(nextHintFa(base())).toContain("محصول");
  });
});
