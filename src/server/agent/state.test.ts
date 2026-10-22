// @vitest-environment node
import { describe, expect, it } from "vitest";
import { initialAgentState, type AgentState } from "@/domain/agent";
import { openRealDb } from "../../../tests/helpers/real-db";
import { AgentControlSchema, applyControl, validateState } from "./state";

const db = openRealDb();
const DAHUA = "product_7308febc43c2f793fd0e1cf9";
const base = (over: Partial<AgentState> = {}): AgentState => ({ ...initialAgentState(), ...over });

describe("AgentControl schema (the only way the UI changes state)", () => {
  it("accepts every control and rejects unknown types, extra keys and out-of-range values", () => {
    for (const c of [{ type: "set_budget", min: null, max: 5000000 }, { type: "set_radius", radius: 1500 }, { type: "set_origin", id: "ferdowsi" }, { type: "set_priority", priority: "price" }, { type: "set_visit", visit: "2026-10-22T10:00" }, { type: "answer", questionId: "use", optionId: "sport" }, { type: "skip_question", questionId: "use" }, { type: "select_product", productId: DAHUA, variantGroupId: null }, { type: "select_shops", shopIds: ["shop_0ca1ab09aa"] }, { type: "toggle_external", on: true }, { type: "reset" }]) expect(AgentControlSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
    for (const c of [{ type: "send_sms" }, { type: "set_radius", radius: 5 }, { type: "set_radius", radius: 1e9 }, { type: "set_radius", radius: 1.5 }, { type: "set_origin", id: "home" }, { type: "set_origin", id: "ferdowsi", lat: 35.7, lon: 51.4 }, { type: "select_product", productId: "../etc/passwd", variantGroupId: null }, { type: "select_shops", shopIds: [] }, { type: "select_shops", shopIds: Array(9).fill("shop_0ca1ab09aa") }, { type: "set_visit", visit: "tomorrow" }, { type: "set_budget", min: -5, max: null }, { type: "answer", questionId: "Bad Id", optionId: "x" }, null, "reset", 5]) expect(AgentControlSchema.safeParse(c).success, JSON.stringify(c)).toBe(false);
  });
});

describe("applyControl: a follow-up changes only what it names", () => {
  const s = base({ category: "headphones", answers: { use: "sport" }, budget: { min: null, max: 3_000_000 }, radius: 3000, selection: { productId: DAHUA, variantGroupId: null }, selectedShopIds: ["shop_0ca1ab09aa"], selectedOffer: { shopId: "shop_0ca1ab09aa", offerId: "offer_1234abcd" }, stage: 3 });
  it("budget/radius/priority keep product, shops and answers", () => {
    const b = applyControl(s, { type: "set_budget", min: null, max: 2_000_000 });
    expect(b).toEqual({ ...s, budget: { min: null, max: 2_000_000 } });
    expect(applyControl(s, { type: "set_radius", radius: 800 }).selection).toEqual(s.selection);
    expect(applyControl(s, { type: "set_priority", priority: "distance" }).selectedShopIds).toEqual(s.selectedShopIds);
  });
  it("choosing another product resets seller picks that belonged to the old one; changing category resets answers and selection", () => {
    const p = applyControl(s, { type: "select_product", productId: "product_aaaaaaaa", variantGroupId: null });
    expect(p.selectedShopIds).toEqual([]); expect(p.selectedOffer).toBeNull(); expect(p.stage).toBe(2);
    const c = applyControl(s, { type: "answer", questionId: "category", optionId: "camera" });
    expect(c).toMatchObject({ category: "camera", answers: {}, selection: null, selectedShopIds: [], selectedOffer: null });
  });
  it("reset returns the pristine state; radius is clamped", () => {
    expect(applyControl(s, { type: "reset" })).toEqual(initialAgentState());
    expect(applyControl(s, { type: "set_radius", radius: 70_000 }).radius).toBe(50_000);
  });
});

describe.skipIf(!db)("validateState: the server trusts nothing the client holds", () => {
  const ok = (st: unknown) => validateState(st, db!);
  it("the initial state and a legitimate selection are accepted", () => {
    expect(ok(initialAgentState()).ok).toBe(true);
    expect(ok(base({ selection: { productId: DAHUA, variantGroupId: null } })).ok).toBe(true);
  });
  it("forged keys (GPS, phone, demo replies, prompt) are rejected, not silently kept", () => {
    for (const extra of [{ gps: { lat: 35.7, lon: 51.4 } }, { phone: "09120000000" }, { demoReply: "موجوده" }, { systemPrompt: "x" }, { apiKey: "sk-1" }]) expect(ok({ ...initialAgentState(), ...extra }).ok, JSON.stringify(extra)).toBe(false);
    expect(ok({ ...initialAgentState(), origin: { kind: "map", lat: 35.7, lon: 51.4, accuracy: 5 } }).ok).toBe(false);
  });
  it("unknown product, version drift, wrong types and oversized lists are rejected", () => {
    expect(ok(base({ selection: { productId: "product_00000000000000000000dead", variantGroupId: null } })).ok).toBe(false);
    expect(ok({ ...initialAgentState(), v: 2 }).ok).toBe(false);
    expect(ok({ ...initialAgentState(), radius: "big" }).ok).toBe(false);
    expect(ok({ ...initialAgentState(), seen: { products: Array(41).fill(DAHUA), shops: [] } }).ok).toBe(false);
    expect(ok({ ...initialAgentState(), budget: { min: 9, max: 3 } }).ok).toBe(false);
    for (const bad of [null, undefined, "x", 5, []]) expect(ok(bad).ok).toBe(false);
  });
  it("map origins are snapped (≈ privacy rounding) and must be inside Tehran", () => {
    const r = ok(base({ origin: { kind: "map", lat: 35.683412345, lon: 51.411298765 } }));
    expect(r.ok).toBe(true);
    if (r.ok && r.state.origin?.kind === "map") { expect(r.state.origin.lat.toString().length).toBeLessThanOrEqual(8); expect(r.state.origin.lon.toString().length).toBeLessThanOrEqual(8); }
    expect(ok(base({ origin: { kind: "map", lat: 40.0, lon: 29.0 } })).ok).toBe(false);
  });
  it("ids that were never shown in this conversation are dropped (shop picks need a prior sighting)", () => {
    const r = ok(base({ selectedShopIds: ["shop_0ca1ab09aa11bb22cc33dd44"], selectedOffer: { shopId: "shop_0ca1ab09aa11bb22cc33dd44", offerId: "offer_742932354aecd83d7fc7c266" }, seen: { products: [DAHUA, "product_00000000000000000000dead"], shops: [] } }));
    expect(r.ok && r.state.selectedShopIds).toEqual([]);
    expect(r.ok && r.state.selectedOffer).toBeNull();
    expect(r.ok && r.state.seen.products).toEqual([DAHUA]);
  });
  it("free-text fields are sanitised (control + bidi-override characters, length); markup stays inert text because the UI never uses innerHTML", () => {
    const r = ok(base({ text: "هدفون\u0000<script>alert(1)</script>‮" + "x".repeat(150), model: "<b>T13</b>" }));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.state.text).not.toMatch(/[\u0000\u202e]/); expect(r.state.text.length).toBeLessThanOrEqual(200); expect(r.state.model!.length).toBeLessThanOrEqual(40); }
  });
});
