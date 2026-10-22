// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildSellersHref, buildShopHref, parseSellersParams, safeSellersBack } from "./sellers-url";

const P = "product_df1dfb162403cf73df70fdf3";
const parse = (qs: string) => parseSellersParams(new URLSearchParams(qs));

describe("sellers URL state", () => {
  it("round-trips the shareable state", () => {
    const href = buildSellersHref({ product: P, variant: "unknown|any", origin: "sheikh-hadi", radius: 3000, sort: "price", open: true, reliable: true, pay: "ترب‌پی", uncertain: true, view: "map" });
    const p = parse(href.split("?")[1]!);
    expect(p).toMatchObject({ product: P, variant: "unknown|any", origin: "sheikh-hadi", radius: 3000, sort: "price", open: true, reliable: true, pay: "ترب‌پی", uncertain: true, view: "map" });
  });
  it("a map-picked point is snapped before it can enter the URL", () => {
    const href = buildSellersHref({ product: P, origin: "map", ll: { lat: 35.692347, lon: 51.422512 } });
    expect(href).toContain("ll=35.692%2C51.423");
    expect(href).not.toContain("35.6923");
  });
  it("GPS coordinates NEVER reach the URL: only the o=gps flag", () => {
    const href = buildSellersHref({ product: P, origin: "gps", ll: { lat: 35.692, lon: 51.423 } });
    expect(href).toContain("o=gps");
    expect(href).not.toMatch(/ll=|35\.69|51\.42/);
    const p = parse("product=" + P + "&o=gps&ll=35.69234,51.42251");
    expect(p.ll).toBeNull();
  });
  it("incoming ll is snapped even if a hand-edited URL carries precise numbers", () => {
    expect(parse("ll=35.692347,51.422512").ll).toEqual({ lat: 35.692, lon: 51.423 });
  });
  it("drops malformed values", () => {
    const p = parse("product=nope&r=-5&sort=evil&ll=abc,def&shop=x&page=999");
    expect(p).toMatchObject({ product: null, radius: 1000, sort: "distance", ll: null, shop: null, page: 50 });
  });
  it("origin keys are whitelisted", () => expect(parse("o=evil").origin).toBeNull());
  it("back links are same-origin /sellers or /compare only", () => {
    expect(safeSellersBack("/compare?product=" + P)).toBe("/compare?product=" + P);
    expect(safeSellersBack("/compare/products?ids=x")).toBeNull();
    expect(safeSellersBack("/sellers?product=" + P)).toBe("/sellers?product=" + P);
    for (const bad of ["https://evil.com", "//evil.com", "/discover?x=1", "javascript:alert(1)", "/sellers\nx"]) expect(safeSellersBack(bad)).toBeNull();
    expect(parse("back=https://evil.com").back).toBeNull();
  });
  it("shop links carry only product context", () => {
    const h = buildShopHref("shop_abcdef12", { product: P, variant: "unknown|any", back: "/sellers?product=" + P });
    expect(h.startsWith("/shops/shop_abcdef12?")).toBe(true);
    expect(h).not.toMatch(/ll=|lat|lon/);
  });
  it("comparison selection (cmp) is capped at 4 valid shop ids and round-trips", () => {
    const ids = [1, 2, 3, 4, 5].map((n) => `shop_${String(n).padStart(8, "0")}`);
    const href = buildSellersHref({ product: P, cmp: ids });
    expect(parse(href.split("?")[1]!).cmp).toHaveLength(4);
    expect(parse("cmp=evil,shop_00000001").cmp).toEqual(["shop_00000001"]);
  });
});
