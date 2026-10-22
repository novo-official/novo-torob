// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildCompareHref, parseCompareParams } from "./compare-url";
import { buildMissionHref, parseMissionContext } from "./mission-url";

const P = "product_df1dfb162403cf73df70fdf3";
const S = (n: number) => `shop_${String(n).padStart(8, "0")}`;
const parse = (qs: string) => parseCompareParams(new URLSearchParams(qs));

describe("compare URL contract", () => {
  it("round-trips every criterion", () => {
    const href = buildCompareHref({ product: P, variant: "unknown|any", shops: [S(1), S(2)], origin: "ferdowsi", radius: 3000, visit: "2026-10-24T17:30", bmin: 1_000_000, bmax: 5_000_000, strict: true, prio: "hours" });
    expect(parse(href.split("?")[1]!)).toMatchObject({ product: P, variant: "unknown|any", shops: [S(1), S(2)], origin: "ferdowsi", radius: 3000, visit: "2026-10-24T17:30", bmin: 1_000_000, bmax: 5_000_000, strict: true, prio: "hours" });
  });
  it("stays compatible with the Phase 4 single-shop hand-off (?shop=) and merges it with ?shops=", () => {
    expect(parse(`product=${P}&shop=${S(1)}`).shops).toEqual([S(1)]);
    expect(parse(`product=${P}&shop=${S(1)}&shops=${S(2)},${S(1)}`).shops).toEqual([S(1), S(2)]);
  });
  it("caps at 4 sellers and drops malformed ids", () => {
    expect(parse(`shops=${[1, 2, 3, 4, 5, 6].map(S).join(",")}`).shops).toHaveLength(4);
    expect(parse("shops=shop_x,evil,../../etc").shops).toEqual([]);
    expect(buildCompareHref({ product: P, shops: [1, 2, 3, 4, 5].map(S) }).match(/shop_/g)).toHaveLength(4);
  });
  it("defaults and whitelists: priority, visit, radius, origin", () => {
    expect(parse("prio=evil").prio).toBe("price");
    expect(parse("visit=tomorrow").visit).toBeNull();
    expect(parse("r=-1").radius).toBe(1000);
    expect(parse("o=evil").origin).toBeNull();
    expect(parse("bmax=-5").bmax).toBeNull();
  });
  it("GPS never reaches the URL; map points are snapped", () => {
    const href = buildCompareHref({ product: P, origin: "gps", ll: { lat: 35.69234, lon: 51.42251 } });
    expect(href).toContain("o=gps");
    expect(href).not.toMatch(/ll=|35\.69|51\.42/);
    expect(parse(`product=${P}&o=gps&ll=35.69234,51.42251`).ll).toBeNull();
    expect(buildCompareHref({ product: P, origin: "map", ll: { lat: 35.692347, lon: 51.422512 } })).toContain("ll=35.692%2C51.423");
    expect(parse("ll=35.692347,51.422512").ll).toEqual({ lat: 35.692, lon: 51.423 });
  });
  it("back is a /sellers path only", () => {
    expect(parse(`back=${encodeURIComponent(`/sellers?product=${P}`)}`).back).toBe(`/sellers?product=${P}`);
    expect(parse("back=https://evil.com").back).toBeNull();
  });
});

describe("inquiry (mission) hand-off URL", () => {
  it("carries only validated dataset ids and a same-origin back path", () => {
    const href = buildMissionHref({ product: P, variant: "unknown|any", shop: S(1), offer: "offer_abcdef1234567890", back: `/compare?product=${P}` });
    const c = parseMissionContext((k) => new URL(`http://x${href}`).searchParams.get(k));
    expect(c).toMatchObject({ product: P, shop: S(1), offer: "offer_abcdef1234567890", back: `/compare?product=${P}` });
  });
  it("rejects bad ids and open redirects", () => {
    const href = buildMissionHref({ product: "evil", shop: "x", offer: "y", back: "https://evil.com" });
    expect(href).toBe("/missions/new");
    expect(parseMissionContext((k) => ({ back: "//evil.com", product: "product_zz" })[k as "back"] ?? null)).toMatchObject({ back: null, product: null });
  });
});
