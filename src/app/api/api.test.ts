// @vitest-environment node
import { describe, expect, it } from "vitest";
import { openRealDb } from "../../../tests/helpers/real-db";
import { GET as search } from "./search/route";
import { GET as suggest } from "./suggest/route";
import { GET as advisor } from "./advisor/route";
import { GET as compare } from "./compare/route";
import { GET as product } from "./products/[id]/route";

const db = openRealDb();
const req = (path: string) => new Request(`http://localhost${path}`);
const j = async (r: Response | Promise<Response>) => { const x = await r; return { status: x.status, body: await x.json(), cache: x.headers.get("cache-control") }; };
const DAHUA = "product_7308febc43c2f793fd0e1cf9";

describe.skipIf(!db)("route handlers (validated, bounded, uncached)", () => {
  it("search: valid query returns the shared service's response", async () => {
    const r = await j(search(req("/api/search?q=hdw1200clqp&limit=3")));
    expect(r.status).toBe(200);
    expect(r.body.items[0].card.id).toBe(DAHUA);
    expect(r.cache).toBe("no-store");
  });
  it("search: out-of-range limit is a 400 with machine-readable issues, never a crash", async () => {
    const r = await j(search(req("/api/search?q=x&limit=9999")));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_INPUT");
    expect(r.body.issues[0].path).toBe("limit");
  });
  it("search: oversized q is rejected", async () => expect((await j(search(req(`/api/search?q=${"a".repeat(500)}`)))).status).toBe(400));
  it("search: invalid input is a 200 with valid=false and a Persian message (not an error)", async () => {
    const r = await j(search(req("/api/search?q=%D9%88")));
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(false);
    expect(r.body.recovery.message).toMatch(/[؀-ۿ]/);
  });
  it("suggest: ≤5 products + ≤3 categories; tooShort for stop words", async () => {
    const r = await j(suggest(req("/api/suggest?q=%D9%87%D8%AF%D9%81%D9%88%D9%86")));
    expect(r.body.products.length).toBeLessThanOrEqual(5);
    expect(r.body.categories.length).toBeLessThanOrEqual(3);
    expect((await j(suggest(req("/api/suggest?q=%D9%88%20%D8%A8%D8%A7")))).body.tooShort).toBe(true);
  });
  it("advisor: answers arrive as a.<question>=<option>; response is the typed AdvisorResponse", async () => {
    const r = await j(advisor(req(`/api/advisor?cat=x&category=${encodeURIComponent("هدفون، هدست و هندزفری")}&a.connection=wireless&skip=use,budget&show=1&limit=3`)));
    expect(r.status).toBe(200);
    expect(r.body.stage).toBe("results");
    expect(r.body.candidates).toHaveLength(3);
    expect(r.body.intent.answers).toEqual({ connection: "wireless" });
  });
  it("advisor: garbage numbers are rejected, unknown answer ids are harmless", async () => {
    expect((await j(advisor(req("/api/advisor?bmax=abc")))).status).toBe(400);
    const r = await j(advisor(req("/api/advisor?category=" + encodeURIComponent("هدفون، هدست و هندزفری") + "&a.nonsense=zzz&show=1")));
    expect(r.status).toBe(200);
  });
  it("advisor: limit is capped at 24", async () => expect((await j(advisor(req("/api/advisor?limit=25")))).status).toBe(400));
  it("compare: needs 2–4 well-formed product ids", async () => {
    expect((await j(compare(req("/api/compare?ids=bad")))).status).toBe(400);
    expect((await j(compare(req(`/api/compare?ids=${DAHUA}`)))).status).toBe(400);
    expect((await j(compare(req(`/api/compare?ids=${DAHUA},product_00000000000000000000dead`)))).status).toBe(404);
  });
  it("product: id format enforced; unknown id is 404; variant selection yields a Selection", async () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await j(product(req("/api/products/x"), ctx("x")))).status).toBe(400);
    expect((await j(product(req("/api/products/p"), ctx("product_00000000000000000000dead")))).status).toBe(404);
    const ok = await j(product(req(`/api/products/${DAHUA}`), ctx(DAHUA)));
    expect(ok.status).toBe(200);
    const gid = ok.body.detail.variantGroups[0].id as string;
    const sel = await j(product(req(`/api/products/${DAHUA}?variant=${encodeURIComponent(gid)}`), ctx(DAHUA)));
    expect(sel.body.selection).toMatchObject({ productId: DAHUA, variantGroupId: gid, source: "search" });
  });
  it("no response ever contains a phone number field or raw contacts", async () => {
    const all = JSON.stringify([(await j(search(req("/api/search?q=%D9%87%D8%AF%D9%81%D9%88%D9%86")))).body, (await j(product(req(`/api/products/${DAHUA}`), { params: Promise.resolve({ id: DAHUA }) }))).body]);
    expect(all).not.toMatch(/contacts|display_number|"phone"|\bphone\b/i);
  });
});
