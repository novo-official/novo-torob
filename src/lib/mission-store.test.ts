// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyAll, createMission, type MissionEvent, type ShoppingMissionV1 } from "@/domain/mission";
import type { ReplyEvidence } from "@/domain/inquiry";
import { parseMission } from "./mission-schema";
import { createMemoryKV, createMissionStore, createSessionKV, StoreError, type KV } from "./mission-store";

const AT = "2026-10-22T09:00:00.000Z";
const ID = "msn_" + "b".repeat(32), ID2 = "msn_" + "c".repeat(32);
const P1 = "product_7308febc43c2f793fd0e1cf9", S1 = "shop_8670c71ca3baff62d68de422", O1 = "offer_742932354aecd83d7fc7c266";
const reply: ReplyEvidence = { id: "r1", provenance: "USER_REPORTED", rawText: "گفت فردا", stock: "unknown", reportedPriceToman: 4_200_000, reportedUnit: "same", model: "not_asked", warranty: { report: "not_asked", months: null }, payment: "not_asked", visitNote: "", receivedLabel: null, scenarioId: null };
const build = (id = ID, extra: MissionEvent[] = []): ShoppingMissionV1 => {
  const r = applyAll(createMission(id, AT), [{ type: "SELECT_PRODUCT", productId: P1, variantGroupId: "unknown|X" }, { type: "SELECT_SHOP", shopId: S1, offerId: O1, via: "USER" }, { type: "SET_VISIT", visit: "2026-10-24T11:00" }, { type: "INQUIRY", event: { type: "ENTER_REPLY", reply, at: AT }, defaults: ["q1"] }, ...extra], AT);
  if (!r.ok) throw new Error(r.messageFa);
  return r.mission;
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const throwing = (name = "SecurityError"): Storage => new Proxy({} as Storage, { get() { throw new DOMException("blocked", name); }, ownKeys() { throw new DOMException("blocked", name); } });
const fakeStorage = (): Storage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } } as Storage; };
const kvOf = (s: Storage) => { const kv = createSessionKV(() => s); return kv; };
// Object.keys(storage) must list entries for the fake
const listable = (): Storage => { const m = new Map<string, string>(); const o = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); Object.defineProperty(o, k, { value: v, enumerable: true, configurable: true }); }, removeItem: (k: string) => { m.delete(k); delete (o as Record<string, unknown>)[k]; } }; return o as unknown as Storage; };

describe("parseMission: nothing tampered, future or foreign is trusted", () => {
  it("round-trips a valid mission (JSON) unchanged in the fields that matter", () => {
    const m = build();
    const r = parseMission(clone(m));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.mission.id).toBe(ID); expect(r.mission.shop).toEqual({ shopId: S1, offerId: O1 }); expect(r.mission.inquiries[0]!.state.replies[0]).toMatchObject({ provenance: "USER_REPORTED", reportedPriceToman: 4_200_000 }); }
  });
  it("rejects extra fields (GPS, phone, token, demo transcript), wrong version, bad ids and out-of-range values", () => {
    const m = clone(build());
    const bad: Array<[string, (x: Record<string, unknown>) => void]> = [
      ["gps", (x) => { x.gps = { lat: 35.7, lon: 51.4 }; }], ["phone", (x) => { x.phone = "09120000000"; }], ["token", (x) => { x.token = "sk-1"; }], ["demo transcript", (x) => { x.demoTranscript = [{ from: "seller", text: "موجود است" }]; }],
      ["version 2", (x) => { x.v = 2; }], ["no version", (x) => { delete x.v; }], ["id not msn_", (x) => { x.id = "mission-1"; }], ["id short", (x) => { x.id = "msn_abc"; }],
      ["bad product id", (x) => { (x.product as Record<string, unknown>).productId = "product_../x"; }], ["bad offer id", (x) => { (x.shop as Record<string, unknown>).offerId = "offer_zz"; }],
      ["budget min>max", (x) => { x.budget = { min: 9, max: 3 }; }], ["radius 5", (x) => { (x.area as Record<string, unknown>).radius = 5; }], ["district home", (x) => { (x.area as Record<string, unknown>).district = "home"; }],
      ["visit text", (x) => { x.visit = "tomorrow"; }], ["status verified", (x) => { x.status = "VERIFIED"; }], ["timeline DEMO", (x) => { (x.timeline as Array<Record<string, unknown>>)[0]!.provenance = "DEMO_SIMULATED"; }],
      ["checklist unknown key", (x) => { x.checklist = { stock_verified: { kind: "done", at: AT, key: "k" } }; }], ["notes too long", (x) => { x.notes = "ا".repeat(500); }], ["checklist extra field", (x) => { x.checklist = { confirm_model: { kind: "done", at: AT, key: "k", verified: true } }; }],
    ];
    for (const [name, f] of bad) { const x = clone(m); f(x as unknown as Record<string, unknown>); expect(parseMission(x).ok, name).toBe(false); }
    for (const v of [null, undefined, "x", 5, [], true]) expect(parseMission(v).ok).toBe(false);
  });
  it("a DEMO reply smuggled into a stored inquiry is dropped, not imported", () => {
    const m = clone(build());
    m.inquiries[0]!.state.replies.push({ ...reply, id: "d1", provenance: "DEMO_SIMULATED", rawText: "ساختگی" });
    const r = parseMission(m);
    expect(r.ok && r.mission.inquiries[0]!.state.replies.map((x) => x.id)).toEqual(["r1"]);
    expect(JSON.stringify(r)).not.toContain("ساختگی");
  });
  it("text fields are re-sanitised on the way in", () => {
    const m = clone(build()); m.need.text = "هدفون\u0000‮";
    const r = parseMission(m);
    expect(r.ok && r.mission.need.text).toBe("هدفون");
  });
});

describe("store: TAB is the default; DEVICE only after an explicit save", () => {
  const make = () => { const tab = createMemoryKV(), device = createMemoryKV(); return { tab, device, store: createMissionStore({ tab, device }) }; };
  it("saving to TAB never touches the device store", async () => {
    const { device, store } = make();
    await store.save(build(), "TAB", null); await store.save({ ...build(), rev: 99 }, "TAB", build().rev);
    expect(await device.list()).toEqual([]);
    expect((await store.load(ID)).found?.where).toBe("TAB");
  });
  it("saveToDevice copies to IndexedDB, drops the temporary tab copy, and strips notes unless asked", async () => {
    const { tab, device, store } = make();
    const m = { ...build(), notes: "یادداشت خصوصی" };
    await store.save(m, "TAB", null);
    expect((await store.saveToDevice(m, false))).toEqual({ ok: true, where: "DEVICE" });
    expect(await tab.get(ID)).toBeUndefined();
    expect((await device.get(ID) as ShoppingMissionV1).notes).toBeNull();
    await store.saveToDevice(m, true);
    expect((await device.get(ID) as ShoppingMissionV1).notes).toBe("یادداشت خصوصی");
  });
  it("forgetFromDevice / remove / deleteAll leave nothing behind", async () => {
    const { tab, device, store } = make();
    await store.saveToDevice(build(ID), false); await store.saveToDevice(build(ID2), false); await store.save(build("msn_" + "d".repeat(32)), "TAB", null);
    expect(await store.forgetFromDevice(ID)).toBe(true); expect(await device.get(ID)).toBeUndefined();
    expect(await store.remove(ID2)).toBe(true); expect((await store.load(ID2)).found).toBeNull();
    expect((await store.list()).items).toHaveLength(1);
    expect((await store.deleteAll()).ok).toBe(true);
    expect(await tab.list()).toEqual([]); expect(await device.list()).toEqual([]); expect((await store.list()).items).toEqual([]);
  });
  it("compare-and-set: a stale writer gets CONFLICT and cannot overwrite a newer revision", async () => {
    const { store } = make();
    const m = build();
    expect((await store.save(m, "TAB", null)).ok).toBe(true);
    const r1 = await store.save({ ...m, rev: m.rev + 1 }, "TAB", m.rev);
    expect(r1.ok).toBe(true);
    const stale = await store.save({ ...m, rev: m.rev + 1, need: { text: "stale", category: null } }, "TAB", m.rev);
    expect(stale).toMatchObject({ ok: false, reason: "CONFLICT" });
    expect((await store.load(ID)).found?.mission.need.text).toBeNull();
    expect(await store.save(m, "TAB", null)).toMatchObject({ ok: false, reason: "CONFLICT" }); // "must be new" but exists
  });
  it("corrupt, future-version and id-mismatched records are reported unreadable and never trusted", async () => {
    const { tab, store } = make();
    await tab.put(ID, { v: 1, id: ID, junk: true });
    await tab.put(ID2, { ...clone(build(ID)), id: ID }); // stored under another key
    await tab.put("msn_" + "e".repeat(32), { v: 9 });
    const l = await store.list();
    expect(l.items).toEqual([]); expect(l.unreadable.map((u) => u.reason).sort()).toEqual(["ID_MISMATCH", "INVALID", "UNSUPPORTED_VERSION"].sort());
    expect((await store.load(ID)).found).toBeNull(); expect((await store.load(ID)).unreadable).toBe("INVALID");
    expect((await store.load("../etc/passwd")).found).toBeNull();
    expect((await store.load("msn_" + "e".repeat(32))).unreadable).toBe("UNSUPPORTED_VERSION");
  });
  it("blocked tab storage degrades to MEMORY (the flow keeps working) and is reported honestly", async () => {
    const store = createMissionStore({ tab: kvOf(throwing()), device: { ...createMemoryKV(), get: async () => { throw new StoreError("BLOCKED"); }, put: async () => { throw new StoreError("BLOCKED"); }, list: async () => { throw new StoreError("BLOCKED"); } } });
    expect(await store.probe()).toEqual({ tab: false, device: false });
    expect(await store.save(build(), "TAB", null)).toEqual({ ok: true, where: "MEMORY" });
    expect((await store.load(ID)).found?.where).toBe("MEMORY");
    expect(await store.saveToDevice(build(), false)).toMatchObject({ ok: false, reason: "BLOCKED", where: "DEVICE" });
    expect((await store.list()).items.map((i) => i.where)).toEqual(["MEMORY"]);
  });
  it("quota errors surface as QUOTA from the session backend", async () => {
    const s = fakeStorage(); s.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    await expect(kvOf(s).put(ID, build())).rejects.toMatchObject({ reason: "QUOTA" });
  });
  it("the session backend keeps only its own prefix (other keys are never listed or cleared)", async () => {
    const s = listable(); s.setItem("other.key", "keep"); const kv = kvOf(s);
    await kv.put(ID, build());
    expect((await kv.list()).map((x) => x.id)).toEqual([ID]);
    await kv.clear();
    expect(s.getItem("other.key")).toBe("keep"); expect(await kv.get(ID)).toBeUndefined();
  });
  it("a store can hold two missions without cross-talk", async () => {
    const { store } = make();
    await store.save(build(ID), "TAB", null); await store.save(build(ID2, [{ type: "SET_BUDGET", min: null, max: 7_000_000 }]), "TAB", null);
    expect((await store.load(ID)).found?.mission.budget.max).toBeNull();
    expect((await store.load(ID2)).found?.mission.budget.max).toBe(7_000_000);
  });
});
void (null as unknown as KV);
