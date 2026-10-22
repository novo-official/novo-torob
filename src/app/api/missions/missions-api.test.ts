// @vitest-environment node
import { describe, expect, it } from "vitest";
import { openRealDb } from "../../../../tests/helpers/real-db";
import { GET as facts } from "./facts/route";
import { GET as recovery } from "./recovery/route";

const hasDb = !!openRealDb();
const P = "product_7308febc43c2f793fd0e1cf9", S = "shop_8670c71ca3baff62d68de422", O = "offer_742932354aecd83d7fc7c266";
const get = (h: (r: Request) => Response | Promise<Response>, qs: string) => Promise.resolve(h(new Request(`http://localhost/api/x?${qs}`)));

describe.skipIf(!hasDb)("mission read-only APIs", () => {
  it("facts: ok / forged / malformed", async () => {
    const ok = await get(facts, `product=${P}&shop=${S}&offer=${O}&visit=2026-10-24T11:00`);
    expect(ok.status).toBe(200); expect(ok.headers.get("cache-control")).toContain("no-store");
    const j = await ok.json(); expect(j.error).toBeNull(); expect(j.context.offer.id).toBe(O);
    expect(JSON.stringify(j)).not.toMatch(/\b09\d{9}\b|"phone"/);
    expect((await (await get(facts, `product=${P}&shop=${S}&offer=offer_00000000000000000000dead`)).json()).context).toBeNull();
    expect((await get(facts, "product=nope")).status).toBe(400);
    expect((await get(facts, `product=${P}&visit=soon`)).status).toBe(400);
  });
  it("recovery: ok / invalid trigger / mismatched ids / out-of-range numbers", async () => {
    const q = `trigger=UNAVAILABLE&product=${P}&shop=${S}&offer=${O}&district=ferdowsi&radius=1000&bmax=5000000&visit=2026-10-24T11:00`;
    const ok = await get(recovery, q);
    expect(ok.status).toBe(200);
    const p = await ok.json(); expect(p.trigger).toBe("UNAVAILABLE"); expect(Array.isArray(p.sellers)).toBe(true);
    expect((await get(recovery, q.replace("UNAVAILABLE", "DELETE_EVERYTHING"))).status).toBe(400);
    expect((await get(recovery, q.replace("ferdowsi", "home"))).status).toBe(400);
    expect((await get(recovery, q.replace("radius=1000", "radius=9999999"))).status).toBe(400);
    expect((await get(recovery, q.replace(O, "offer_00000000000000000000dead"))).status).toBe(404);
    expect((await get(recovery, q.replace(S, "shop_350520090b6a5a6163f919d3"))).status).toBe(409);
    expect((await get(recovery, `trigger=UNAVAILABLE&product=${P}`)).status).toBe(400);
  });
});
