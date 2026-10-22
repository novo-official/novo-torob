// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyAll, createMission } from "@/domain/mission";
import { seedEvents } from "./mission-seed";
import { buildMissionPageHref, buildMissionStartHref, parseMissionSeed } from "./mission-url";

const P = "product_7308febc43c2f793fd0e1cf9", S = "shop_8670c71ca3baff62d68de422", O = "offer_742932354aecd83d7fc7c266";
const parse = (href: string) => { const u = new URL(href, "http://x"); return parseMissionSeed((k) => u.searchParams.get(k)); };

describe("mission seed URLs carry only non-sensitive context", () => {
  it("round-trips ids, budget, named district, radius, priority and visit; drops anything else", () => {
    const href = buildMissionStartHref({ product: P, variant: "unknown|X", shop: S, offer: O, visit: "2026-10-24T11:00", need: "هدفون", category: "هدفون", bmin: 1_000_000, bmax: 3_000_000, district: "baharestan", radius: 2000, priority: "distance" });
    expect(href.startsWith("/missions/start?")).toBe(true);
    expect(parse(href)).toMatchObject({ product: P, variant: "unknown|X", shop: S, offer: O, visit: "2026-10-24T11:00", bmin: 1_000_000, bmax: 3_000_000, district: "baharestan", radius: 2000, priority: "distance" });
  });
  it("invalid / hostile values are dropped, and no coordinate or phone parameter can exist", () => {
    const s = parse("/missions/start?product=product_x&shop=../../etc&offer=1&visit=tomorrow&district=home&radius=5&bmax=-4&priority=cheap&lat=35.7&lon=51.4&phone=09120000000&ll=35.7,51.4");
    expect(s).toEqual({ product: null, variant: null, shop: null, offer: null, visit: null, need: null, category: null, bmin: null, bmax: null, district: null, radius: null, priority: null });
    expect(buildMissionStartHref({ product: P, ...( { lat: 35.7, lon: 51.4, phone: "0912" } as object) })).not.toMatch(/lat|lon|phone|0912/);
  });
  it("seed → events → a valid mission; a shop without an offer only shortlists (no silent offer pick)", () => {
    const at = "2026-10-22T09:00:00.000Z";
    const full = applyAll(createMission("msn_" + "1".repeat(32), at), seedEvents(parse(buildMissionStartHref({ product: P, shop: S, offer: O, bmax: 4_000_000, district: "ferdowsi", radius: 1500 }))), at);
    expect(full.ok && full.mission).toMatchObject({ product: { productId: P }, shop: { shopId: S, offerId: O }, budget: { max: 4_000_000 }, area: { district: "ferdowsi", radius: 1500 } });
    const half = applyAll(createMission("msn_" + "2".repeat(32), at), seedEvents(parse(buildMissionStartHref({ product: P, shop: S }))), at);
    expect(half.ok && half.mission.shop).toBeNull(); expect(half.ok && half.mission.shortlist).toEqual([S]);
    expect(seedEvents(parse("/missions/start"))).toEqual([]);
  });
  it("page hrefs accept only well-formed mission ids", () => {
    const id = "msn_" + "a".repeat(32);
    expect(buildMissionPageHref(id)).toBe(`/missions/${id}`); expect(buildMissionPageHref(id, "visit")).toBe(`/missions/${id}?tab=visit`);
    expect(buildMissionPageHref("msn_short")).toBe("/missions"); expect(buildMissionPageHref("../x")).toBe("/missions");
  });
});
