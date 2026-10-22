// @vitest-environment node
import { describe, expect, it } from "vitest";
import { openRealDb } from "../../../tests/helpers/real-db";
import { GET as activity } from "./activity/route";
import { GET as areas } from "./areas/route";
import { GET as sellers, POST as sellersPost } from "./sellers/route";

const db = openRealDb();
const get = (path: string) => new Request(`http://localhost${path}`);
const post = (body: unknown) => new Request("http://localhost/api/sellers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const j = async (r: Response | Promise<Response>) => { const x = await r; return { status: x.status, body: await x.json(), cache: x.headers.get("cache-control") }; };
const PRODUCT = db ? (db.prepare("SELECT product_id p FROM offers GROUP BY product_id HAVING count(DISTINCT shop_id) >= 10 ORDER BY count(DISTINCT shop_id) DESC LIMIT 1").get() as { p: string }).p : "";

describe.skipIf(!db)("Phase 4 route handlers", () => {
  it("GET /api/sellers returns the shared service response, uncached, with a manual preset origin", async () => {
    const r = await j(sellers(get(`/api/sellers?product=${PRODUCT}&o=ferdowsi&r=3000&uncertain=1`)));
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    expect(r.body.state).toBe("MATCHED_OFFER_SELLERS");
    expect(r.body.origin).toMatchObject({ source: "manual", label: "فردوسی", defaulted: false });
    expect(r.body.sellers.length).toBeGreaterThan(0);
  });
  it("a precise ll= is snapped to ~100 m server-side and never echoed at full precision", async () => {
    const r = await j(sellers(get(`/api/sellers?product=${PRODUCT}&ll=35.692347,51.422512&r=1000&uncertain=1`)));
    expect(r.body.origin).toMatchObject({ lat: 35.692, lon: 51.423, source: "manual" });
    expect(JSON.stringify(r.body)).not.toMatch(/35\.692347|51\.422512/);
  });
  it("POST with GPS coordinates: snapped, source=gps, nothing precise in the response", async () => {
    const r = await j(sellersPost(post({ gps: { lat: 35.692347, lon: 51.422512 }, product: PRODUCT, r: 1000, uncertain: true })));
    expect(r.status).toBe(200);
    expect(r.body.origin).toMatchObject({ source: "gps", lat: 35.692, lon: 51.423 });
    expect(JSON.stringify(r.body)).not.toMatch(/35\.692347|51\.422512/);
    expect(r.cache).toBe("no-store");
  });
  it("POST tolerates null optional fields (variant/pay) the way a browser client may send them", async () => {
    const r = await j(sellersPost(post({ gps: { lat: 35.692, lon: 51.423 }, product: PRODUCT, variant: null, pay: null, r: 1000 })));
    expect(r.status).toBe(200);
  });
  it("POST rejects malformed JSON and out-of-range coordinates with 400, not a crash", async () => {
    const bad = await sellersPost(new Request("http://localhost/api/sellers", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" }));
    expect(bad.status).toBe(400);
    expect((await j(sellersPost(post({ gps: { lat: 999, lon: 51 }, product: PRODUCT })))).status).toBe(400);
    expect((await j(sellersPost(post({ product: PRODUCT })))).status).toBe(400);
  });
  it("invalid product id / out-of-range radius → 400; unknown product → 404", async () => {
    expect((await j(sellers(get("/api/sellers?product=nope")))).status).toBe(400);
    expect((await j(sellers(get(`/api/sellers?product=${PRODUCT}&r=999999`)))).status).toBe(400);
    expect((await j(sellers(get("/api/sellers?product=product_00000000000000000000dead")))).status).toBe(404);
  });
  it("garbage ll falls back to the default preset instead of failing", async () => {
    const r = await j(sellers(get(`/api/sellers?product=${PRODUCT}&ll=abc,def`)));
    expect(r.status).toBe(200);
    expect(r.body.origin.defaulted).toBe(true);
  });
  it("GET /api/areas returns source-backed leads (no offers, no shops) and rejects an empty category", async () => {
    const r = await j(areas(get("/api/areas?category=%D9%BE%D8%A7%D9%88%D8%B1%D8%A8%D8%A7%D9%86%DA%A9&o=ferdowsi")));
    expect(r.status).toBe(200);
    expect(r.body.areas.length).toBeGreaterThan(0);
    for (const a of r.body.areas) { expect(a.area.sources.length).toBeGreaterThan(0); expect(a.area.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(a).not.toHaveProperty("offers"); }
    expect((await j(areas(get("/api/areas?category=")))).status).toBe(400);
  });
  it("GET /api/areas for nonsense says NO_CATEGORY instead of inventing a market", async () => {
    const r = await j(areas(get("/api/areas?category=qqqzzzxxx")));
    expect(r.body.reason).toBe("NO_CATEGORY");
    expect(r.body.areas).toEqual([]);
  });
  it("GET /api/activity returns CATEGORY_ACTIVITY_ONLY and never marks anything as a matching offer", async () => {
    const r = await j(activity(get(`/api/activity?category=${encodeURIComponent("پاوربانک و شارژر همراه")}&o=ferdowsi&limit=5`)));
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("CATEGORY_ACTIVITY_ONLY");
    expect(r.body.shops.every((s: { hasMatchingOffer: boolean }) => s.hasMatchingOffer === false)).toBe(true);
  });
});

describe("POST guard (shared by /api/sellers and /api/compare/sellers) — no database needed", () => {
  const mk = (headers: Record<string, string>, body = "{}") => new Request("http://localhost/api/sellers", { method: "POST", headers, body });
  it("refuses cross-site, non-JSON and oversize requests with no-store JSON errors; same-origin JSON reaches validation", async () => {
    const cases: Array<[Request, number]> = [
      [mk({ "content-type": "application/json", "sec-fetch-site": "cross-site" }), 403],
      [mk({ "content-type": "application/json", origin: "https://evil.example" }), 403],
      [mk({ "content-type": "text/plain" }), 415],
      [mk({ "content-type": "application/json" }, JSON.stringify({ pad: "x".repeat(9000) })), 413],
      [mk({ "content-type": "application/json" }, "not json"), 400],
      [mk({ "content-type": "application/json", origin: "http://localhost" }), 400], // reaches schema validation (gps missing)
    ];
    for (const [rq, st] of cases) { const r = await sellersPost(rq); expect(r.status).toBe(st); expect(r.headers.get("cache-control")).toBe("no-store"); }
  });
});
