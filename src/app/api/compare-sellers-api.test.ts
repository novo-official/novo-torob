// @vitest-environment node
import { describe, expect, it } from "vitest";
import { openRealDb } from "../../../tests/helpers/real-db";
import { GET, POST } from "./compare/sellers/route";

const db = openRealDb();
const get = (p: string) => new Request(`http://localhost${p}`);
const post = (b: unknown) => new Request("http://localhost/api/compare/sellers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const j = async (r: Response | Promise<Response>) => { const x = await r; return { status: x.status, body: await x.json(), cache: x.headers.get("cache-control") }; };
const DAHUA = "product_7308febc43c2f793fd0e1cf9";
const SHOPS = ["shop_8670c71ca3baff62d68de422", "shop_350520090b6a5a6163f919d3"];
const VARIANT = encodeURIComponent("unknown|HDW1200CLQP");

describe.skipIf(!db)("GET/POST /api/compare/sellers", () => {
  it("returns the shared comparison service output, uncached", async () => {
    const r = await j(GET(get(`/api/compare/sellers?product=${DAHUA}&variant=${VARIANT}&shops=${SHOPS.join(",")}&o=ferdowsi&prio=distance&visit=2026-10-24T11:00&bmax=5000000`)));
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    expect(r.body.state).toBe("SELLER_COMPARISON");
    expect(r.body.sellers).toHaveLength(2);
    expect(r.body.criteria).toMatchObject({ priority: "distance", visitIsNow: false });
    expect(r.body.sellers.every((s: { stock: string }) => s.stock === "unconfirmed")).toBe(true);
  });
  it("validates input: bad product, bad shops, bad priority, bad visit → 400; unknown product → 404", async () => {
    for (const q of ["product=nope", `product=${DAHUA}&shops=evil`, `product=${DAHUA}&prio=cheapest`, `product=${DAHUA}&visit=tomorrow`, `product=${DAHUA}&r=999999`]) expect((await j(GET(get(`/api/compare/sellers?${q}`)))).status, q).toBe(400);
    expect((await j(GET(get("/api/compare/sellers?product=product_00000000000000000000dead")))).status).toBe(404);
  });
  it("zero or one shop is a normal answer (empty states), not an error", async () => {
    expect((await j(GET(get(`/api/compare/sellers?product=${DAHUA}`)))).body.situation).toBe("NO_SELLERS_SELECTED");
    expect((await j(GET(get(`/api/compare/sellers?product=${DAHUA}&variant=${VARIANT}&shops=${SHOPS[0]}`)))).body.situation).toBe("SINGLE_SELLER");
  });
  it("POST with GPS snaps the point; precise coordinates never come back", async () => {
    const r = await j(POST(post({ gps: { lat: 35.692347, lon: 51.422512 }, product: DAHUA, variant: "unknown|HDW1200CLQP", shops: SHOPS.join(",") })));
    expect(r.status).toBe(200);
    expect(r.body.criteria.origin).toMatchObject({ source: "gps", lat: 35.692, lon: 51.423 });
    expect(JSON.stringify(r.body)).not.toMatch(/35\.692347|51\.422512/);
    expect((await j(POST(post({ gps: { lat: 999, lon: 1 }, product: DAHUA })))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/compare/sellers", { method: "POST", headers: { "content-type": "application/json" }, body: "{x" }))).status).toBe(400);
  });
  it("accepts shops as an array in POST (client convenience) and nulls for optional fields", async () => {
    const r = await j(POST(post({ gps: { lat: 35.692, lon: 51.423 }, product: DAHUA, variant: null, shops: SHOPS, visit: null })));
    expect(r.status).toBe(200);
  });
});
