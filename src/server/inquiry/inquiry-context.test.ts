// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { openRealDb } from "../../../tests/helpers/real-db";
import { GET } from "@/app/api/inquiry/context/route";
import { buildQuestions, composeInquiry, defaultQuestionIds } from "@/domain/inquiry-questions";
import { runDemoScenario } from "@/domain/inquiry-demo";
import { resolveInquiryContext } from "./context";

const db = openRealDb();
afterAll(() => db?.close());
const q = <T,>(sql: string, ...p: Array<string | number>) => db!.prepare(sql).all(...p) as T[];
const one = <T,>(sql: string, ...p: Array<string | number>) => db!.prepare(sql).get(...p) as T;
const NOW = new Date("2026-10-22T09:00:00Z");

const DAHUA = "product_7308febc43c2f793fd0e1cf9";
const DV = "unknown|HDW1200CLQP";
const MID_A = "shop_8670c71ca3baff62d68de422";
const MID_A_OFFER = "offer_742932354aecd83d7fc7c266";
const MID_B = "shop_350520090b6a5a6163f919d3";
const CABLE = "product_960832f67570cb3958ce6b1d";
const R = (over: Partial<Parameters<typeof resolveInquiryContext>[1]> = {}) => resolveInquiryContext(db!, { product: DAHUA, variant: DV, shop: MID_A, offer: MID_A_OFFER, now: NOW, ...over });
const okCtx = (over = {}) => { const r = R(over); if (!r.ok) throw new Error(`unexpected ${r.error}`); return r.context; };

describe.skipIf(!db)("inquiry context is derived on the server from the real DB (URL ids are untrusted)", () => {
  it("01 a real product–variant–shop–offer resolves to the recorded facts (price, time, warranty, tier)", () => {
    const c = okCtx();
    const row = one<{ price_toman: number | null; price_toman_raw: string; price_changed_at: string; seller_title: string }>("SELECT price_toman, price_toman_raw, price_changed_at, seller_title FROM offers WHERE offer_id = ?", MID_A_OFFER);
    expect(c.offer.priceToman).toBe(row.price_toman);
    expect(c.offer.priceRaw).toBe(row.price_toman_raw);
    expect(c.offer.recordedAt).toBe(row.price_changed_at);
    expect(c.offer.sellerTitle).toBe(row.seller_title);
    expect(c.offer.tier).toBe("A");
    expect(c.offer.ageDaysToday).toBe(11);
    expect(c.shop.id).toBe(MID_A);
    expect(c.variant.selectedGroupId).toBe(DV);
    expect(c.facts.find((f) => f.key === "price")!.provenance).toBe("DATASET_RECORDED");
    expect(c.facts.find((f) => f.key === "stock")!.provenance).toBe("UNKNOWN");
    expect(c.contactChannel).toBe("NONE_VERIFIED");
  });

  it("02 URL tampering: an offer of ANOTHER shop or ANOTHER product never produces a context", () => {
    const otherShopOffer = one<{ offer_id: string }>("SELECT offer_id FROM offers WHERE product_id = ? AND shop_id = ? LIMIT 1", DAHUA, MID_B).offer_id;
    const r = R({ offer: otherShopOffer });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("OFFER_MISMATCH");
    const otherProductOffer = one<{ offer_id: string }>("SELECT offer_id FROM offers WHERE product_id != ? LIMIT 1", DAHUA).offer_id;
    expect(R({ offer: otherProductOffer })).toMatchObject({ ok: false, error: "OFFER_MISMATCH" });
    // the shop's real offer on a different product
    const crossProduct = one<{ offer_id: string; product_id: string; shop_id: string }>("SELECT offer_id, product_id, shop_id FROM offers WHERE product_id != ? LIMIT 1", DAHUA);
    expect(R({ shop: crossProduct.shop_id, offer: crossProduct.offer_id })).toMatchObject({ ok: false, error: "OFFER_MISMATCH" });
  });

  it("03 unknown / malformed ids and unknown variant are rejected with distinct, safe errors", () => {
    expect(R({ product: "nope" })).toMatchObject({ ok: false, error: "INVALID_ID" });
    expect(R({ shop: "shop_zz" })).toMatchObject({ ok: false, error: "INVALID_ID" });
    expect(R({ offer: "offer_not-hex" })).toMatchObject({ ok: false, error: "INVALID_ID" });
    expect(R({ product: null })).toMatchObject({ ok: false, error: "INVALID_ID" });
    expect(R({ shop: "shop_00000000000000000000dead" })).toMatchObject({ ok: false, error: "SHOP_NOT_FOUND" });
    expect(R({ product: "product_00000000000000000000dead" })).toMatchObject({ ok: false, error: "PRODUCT_NOT_FOUND" });
    expect(R({ offer: "offer_00000000000000000000dead" })).toMatchObject({ ok: false, error: "OFFER_NOT_FOUND" });
    expect(R({ variant: "unknown|NOPE" })).toMatchObject({ ok: false, error: "VARIANT_UNKNOWN" });
    for (const e of [R({ shop: "shop_00000000000000000000dead" }), R({ offer: "offer_x" })]) expect(!e.ok && e.recovery.sellersHref).toMatch(/^\/sellers/);
  });

  it("04 a shop with several offers needs the user to pick one (never auto-picks silently)", () => {
    const multi = one<{ p: string; s: string; n: number }>("SELECT product_id p, shop_id s, count(*) n FROM offers GROUP BY product_id, shop_id HAVING n >= 3 ORDER BY n DESC LIMIT 1");
    const r = resolveInquiryContext(db!, { product: multi.p, variant: null, shop: multi.s, offer: null, now: NOW });
    expect(r).toMatchObject({ ok: false, error: "OFFER_REQUIRED" });
    expect(!r.ok && r.candidates!.length).toBe(multi.n);
    const single = resolveInquiryContext(db!, { product: DAHUA, variant: DV, shop: MID_A, offer: null, now: NOW });
    expect(single.ok).toBe(true);
    expect(single.ok && single.context.offer.id).toBe(MID_A_OFFER);
  });

  it("05 an offer outside the selected variant is kept as such (flagged, never swapped for another)", () => {
    const roll = one<{ shop_id: string; offer_id: string }>("SELECT shop_id, offer_id FROM offers WHERE product_id = ? AND unit_hint = 'roll_or_pack' AND price_toman IS NOT NULL LIMIT 1", CABLE);
    const metreGroup = "per_metre|any";
    const c = resolveInquiryContext(db!, { product: CABLE, variant: metreGroup, shop: roll.shop_id, offer: roll.offer_id, now: NOW });
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.context.offer.id).toBe(roll.offer_id);
      expect(c.context.offer.outsideSelectedVariant).toBe(true);
      expect(["C", "D"]).toContain(c.context.offer.tier);
      expect(buildQuestions(c.context).find((x) => x.id === "q_variant")!.defaultOn).toBe(true);
      expect(c.context.category).toBe("cable");
    }
  });

  it("06 a client cannot inject a price: unknown query parameters are ignored and the recorded price wins", () => {
    const res = GET(new Request(`http://x/api/inquiry/context?product=${DAHUA}&variant=${encodeURIComponent(DV)}&shop=${MID_A}&offer=${MID_A_OFFER}&price=1&priceToman=1&price_toman=1`));
    return Promise.resolve(res).then(async (r) => {
      const b = await r.json();
      expect(r.status).toBe(200);
      expect(b.offer.priceToman).toBe(4_100_000);
      expect(r.headers.get("cache-control")).toBe("no-store");
    });
  });

  it("07 no phone number or contact URL scheme exists anywhere in any context (200 real shops)", () => {
    const shops = q<{ shop_id: string; product_id: string; offer_id: string }>("SELECT shop_id, product_id, offer_id FROM offers GROUP BY shop_id ORDER BY shop_id LIMIT 200");
    for (const o of shops) {
      const r = resolveInquiryContext(db!, { product: o.product_id, variant: null, shop: o.shop_id, offer: o.offer_id, now: NOW });
      if (!r.ok) continue;
      const s = JSON.stringify(r.context);
      expect(s).not.toMatch(/contacts_raw|tel:|sms:|wa\.me|whatsapp|\b09\d{9}\b|\+98\d{9,}|\b0\d{10}\b/i);
      const text = composeInquiry(r.context, buildQuestions(r.context).filter((x) => x.defaultOn));
      expect(text).not.toMatch(/\b09\d{9}\b|\+98\d{9,}|tel:|wa\.me/i);
    }
  });

  it("08 public links: only validated https website/instagram, as plain data (never contact channels)", () => {
    const withWeb = q<{ shop_id: string; website_url: string; instagram_url: string | null }>("SELECT shop_id, website_url, instagram_url FROM shops WHERE offer_count > 0 AND (website_url IS NOT NULL OR instagram_url IS NOT NULL)");
    let https = 0;
    for (const s of withWeb) {
      const o = one<{ offer_id: string; product_id: string }>("SELECT offer_id, product_id FROM offers WHERE shop_id = ? LIMIT 1", s.shop_id);
      const r = resolveInquiryContext(db!, { product: o.product_id, variant: null, shop: s.shop_id, offer: o.offer_id, now: NOW });
      if (!r.ok) continue;
      for (const l of [r.context.shop.website, r.context.shop.instagram]) if (l) { expect(l.href.startsWith("https://")).toBe(true); https++; }
      if (s.website_url?.startsWith("http://")) expect(r.context.shop.website).toBeNull();
    }
    expect(https).toBeGreaterThan(10);
  });

  it("09 the visit time changes the declared-hours answer; an invalid visit falls back to now", () => {
    const sat3 = okCtx({ visit: "2026-10-24T03:00" });
    expect(sat3.visit.input).toBe("2026-10-24T03:00");
    expect(sat3.hours.state).not.toBe("WITHIN_DECLARED");
    expect(okCtx({ visit: "2026-02-31T10:00" }).visit.isNow).toBe(true);
  });

  it("10 questions come from the real facts; the composed text quotes the recorded price+date and says nothing was sent", () => {
    const c = okCtx();
    const qs = buildQuestions(c);
    expect(c.category).toBe("cctv");
    expect(qs.some((x) => x.id === "cat_night" && x.defaultOn)).toBe(true);
    expect(qs.find((x) => x.id === "q_variant")!.defaultOn).toBe(false); // exact key in the title
    const t = composeInquiry(c, qs.filter((x) => defaultQuestionIds(qs).includes(x.id)));
    expect(t).toContain("۴٬۱۰۰٬۰۰۰ تومان");
    expect(t).toContain("HDW1200CLQP");
    expect(t).not.toMatch(/ارسال شد/);
  });

  it("11 demo scenarios built on real offers never mutate the context or the DB row", () => {
    const c = okCtx();
    const before = JSON.stringify(c);
    const rowBefore = JSON.stringify(one("SELECT price_toman, price_changed_at, warranty_raw FROM offers WHERE offer_id = ?", MID_A_OFFER));
    for (const id of ["AVAILABLE", "NOT_AVAILABLE", "PRICE_CHANGED", "VARIANT_DIFFERENT", "WARRANTY_OR_PAYMENT_CHANGED", "NO_RESPONSE"] as const) runDemoScenario(c, id, "x");
    expect(JSON.stringify(c)).toBe(before);
    expect(JSON.stringify(one("SELECT price_toman, price_changed_at, warranty_raw FROM offers WHERE offer_id = ?", MID_A_OFFER))).toBe(rowBefore);
    expect(JSON.stringify(okCtx())).toBe(before); // re-resolving still gives the recorded facts
  });

  it("12 the API maps errors to safe statuses with recovery links (no stack, no internals)", async () => {
    const call = async (qs: string) => { const r = await GET(new Request(`http://x/api/inquiry/context?${qs}`)); return { s: r.status, b: await r.json() }; };
    expect((await call(`product=${DAHUA}&shop=${MID_B}&offer=${MID_A_OFFER}`))).toMatchObject({ s: 409, b: { error: "OFFER_MISMATCH" } });
    expect((await call("product=nope&shop=shop_x"))).toMatchObject({ s: 400, b: { error: "INVALID_ID" } });
    expect((await call(`product=${DAHUA}&shop=shop_00000000000000000000dead`))).toMatchObject({ s: 404, b: { error: "SHOP_NOT_FOUND" } });
    expect((await call(`product=${DAHUA}&variant=zzz&shop=${MID_A}`))).toMatchObject({ s: 400, b: { error: "VARIANT_UNKNOWN" } });
    expect((await call("visit=bad")).s).toBe(400);
    const e = await call(`product=${DAHUA}&shop=${MID_B}&offer=${MID_A_OFFER}`);
    expect(JSON.stringify(e.b)).not.toMatch(/at |\.ts:|node_modules/);
    expect(e.b.recovery.sellersHref).toContain("/sellers");
  });
});
