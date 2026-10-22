// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fingerprintDb } from "./fingerprint";
import { cleanStaleStaging, runImport } from "./run";
import { openSource } from "./sources";
import { evaluateDeclaredHours, getShop, shopsNear } from "@/server/repositories/shops";
import { getProduct, searchProducts } from "@/server/repositories/products";
import { listOffersForProduct } from "@/server/repositories/offers";
import { getFlags } from "@/server/repositories/shared";

const FIXTURE = path.resolve("tests/fixtures/csv");
const ZIPS = path.resolve("tests/fixtures/zips");
let tmp: string;
let dbPath: string;
let db: DatabaseSync;
let first: Awaited<ReturnType<typeof runImport>>;

const importFixture = (out: string, inject?: Parameters<typeof runImport>[0]["inject"]) =>
  runImport({ source: { kind: "fixture", path: FIXTURE }, outPath: out, inject });

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "torob-import-"));
  dbPath = path.join(tmp, "app.sqlite");
  first = await importFixture(dbPath);
  db = new DatabaseSync(dbPath, { readOnly: true });
});
afterAll(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const flagsOf = (entity: "offer" | "shop" | "product", id: string) => getFlags(db, entity, id).map((f) => f.code);
const one = <T>(sql: string, ...p: Array<string | number>) => db.prepare(sql).get(...p) as T;

describe("import: counts, integrity, provenance", () => {
  it("stores every source row and creates no orphans", () => {
    expect(first.rowsRead).toEqual({ products: 6, shops: 6, offers: 21 });
    expect(first.rowsStored).toEqual(first.rowsRead);
    expect(first.orphans).toEqual({ offersWithoutProduct: 0, offersWithoutShop: 0 });
  });
  it("keeps the exact source text of nulls, prices and timestamps in *_raw columns", () => {
    const o6 = one<{ price_toman_raw: string; price_toman: number | null }>("SELECT price_toman_raw, price_toman FROM offers WHERE offer_id='offer_fx_06'");
    expect(o6).toMatchObject({ price_toman_raw: "null", price_toman: null });
    const o8 = one<{ last_price_changed_at_raw: string; price_changed_at: string | null }>("SELECT last_price_changed_at_raw, price_changed_at FROM offers WHERE offer_id='offer_fx_08'");
    expect(o8).toMatchObject({ last_price_changed_at_raw: "null", price_changed_at: null });
  });
  it("keeps prices beyond 2^53 as exact raw text and flags them instead of corrupting them", () => {
    const o = one<{ price_toman_raw: string; price_toman: number | null; price_out_of_range: number }>("SELECT price_toman_raw, price_toman, price_out_of_range FROM offers WHERE offer_id='offer_fx_19'");
    expect(o).toMatchObject({ price_toman_raw: "733518940747298944", price_toman: null, price_out_of_range: 1 });
    expect(flagsOf("offer", "offer_fx_19")).toContain("PRICE_ABSURD_MAGNITUDE");
    expect(flagsOf("offer", "offer_fx_19")).not.toContain("NULL_PRICE");
  });
  it("round-trips multi-line quoted fields and Persian text", () => {
    const p = one<{ persian_title: string; title_norm: string }>("SELECT persian_title, title_norm FROM products WHERE product_id='product_fx_multiline'");
    expect(p.persian_title).toContain("\n");
    expect(p.title_norm).toContain("کیبورد"); // Arabic ي/ك normalised to ی/ک
    expect(one<{ address: string }>("SELECT address FROM shops WHERE shop_id='shop_fx_06'").address).toContain("\n");
    expect(one<{ description: string }>("SELECT description FROM offers WHERE offer_id='offer_fx_21'").description).toBe("توضیح\nچندخطی");
  });
});

describe("import: variants and duplicates are NOT collapsed", () => {
  it("keeps two different contactor variants from the same shop as distinct offers", () => {
    const rows = db.prepare("SELECT offer_id, seller_title FROM offers WHERE product_id='product_fx_contactor' AND shop_id='shop_fx_01' ORDER BY source_row").all() as Array<{ offer_id: string; seller_title: string }>;
    expect(rows.map((r) => r.seller_title)).toEqual(["کنتاکتور 220 ولت LC1D95AM7 اشنایدر", "کنتاکتور 220 ولت LC1D50AM7 اشنایدر"]);
    expect(flagsOf("offer", "offer_fx_01")).toContain("MULTI_OFFER_SAME_SHOP_PRODUCT");
    expect(flagsOf("offer", "offer_fx_01")).not.toContain("EXACT_DUPLICATE_OFFER");
  });
  it("flags the second variant (LC1D50 vs LC1D95) as a sibling-model mismatch but never deletes it", () => {
    expect(flagsOf("offer", "offer_fx_02")).toContain("VARIANT_MODEL_MISMATCH");
    expect(flagsOf("offer", "offer_fx_01")).not.toContain("VARIANT_MODEL_MISMATCH");
  });
  it("reports exact duplicates separately and keeps both rows", () => {
    expect(flagsOf("offer", "offer_fx_05")).toContain("EXACT_DUPLICATE_OFFER");
    expect(flagsOf("offer", "offer_fx_04")).not.toContain("EXACT_DUPLICATE_OFFER");
    expect(one<{ n: number }>("SELECT count(*) n FROM offers WHERE offer_id IN ('offer_fx_04','offer_fx_05')").n).toBe(2);
  });
});

describe("quality flags", () => {
  it("null price / missing, stale and absent timestamps", () => {
    expect(flagsOf("offer", "offer_fx_06")).toContain("NULL_PRICE");
    expect(flagsOf("offer", "offer_fx_07")).toContain("TIMESTAMP_STALE");
    expect(flagsOf("offer", "offer_fx_08")).toContain("TIMESTAMP_MISSING");
    expect(flagsOf("offer", "offer_fx_03")).not.toContain("TIMESTAMP_STALE");
  });
  it("peer outliers only inside a comparable cohort; raw price retained", () => {
    expect(flagsOf("offer", "offer_fx_17")).toContain("PRICE_PEER_OUTLIER_HIGH");
    expect(flagsOf("offer", "offer_fx_18")).toContain("PRICE_PEER_OUTLIER_LOW");
    expect(flagsOf("offer", "offer_fx_12")).not.toContain("PRICE_PEER_OUTLIER_HIGH");
    expect(one<{ price_toman: number }>("SELECT price_toman FROM offers WHERE offer_id='offer_fx_17'").price_toman).toBe(900000000);
  });
  it("does NOT compare per-metre against per-roll prices; flags the unit ambiguity instead", () => {
    expect(flagsOf("offer", "offer_fx_09")).toContain("UNIT_AMBIGUOUS");
    expect(flagsOf("offer", "offer_fx_10")).toContain("UNIT_AMBIGUOUS");
    expect(flagsOf("offer", "offer_fx_09")).not.toContain("PRICE_PEER_OUTLIER_LOW");
    expect(flagsOf("offer", "offer_fx_10")).not.toContain("PRICE_PEER_OUTLIER_HIGH");
  });
  it("flags carry rules_version, a Persian reason and machine-readable details", () => {
    const f = getFlags(db, "offer", "offer_fx_17").find((x) => x.code === "PRICE_PEER_OUTLIER_HIGH")!;
    expect(f.reason).toMatch(/[؀-ۿ]/);
    expect(f.details).toMatchObject({ cohortSize: expect.any(Number), median: expect.any(Number), ratio: expect.any(Number) });
    expect(one<{ v: string }>("SELECT DISTINCT rules_version v FROM quality_flags").v).toBe("qf-2026.1");
  });
  it("a shop with no offers is flagged but not hidden", () => {
    expect(flagsOf("shop", "shop_fx_05")).toContain("SHOP_NO_OFFERS");
    expect(flagsOf("shop", "shop_fx_01")).toContain("SHOP_SHARED_COORDINATES");
  });
});

describe("defensive parsers", () => {
  it("invalid JSON in specs/images/payment/hours never aborts the import and is recorded", () => {
    expect(flagsOf("product", "product_fx_badjson")).toEqual(expect.arrayContaining(["PARSE_SPECS_INVALID", "PARSE_IMAGES_INVALID"]));
    expect(flagsOf("shop", "shop_fx_05")).toEqual(expect.arrayContaining(["PARSE_SHOP_JSON_INVALID", "HOURS_INVALID"]));
    expect(flagsOf("offer", "offer_fx_20")).toContain("PARSE_WARRANTY_INVALID");
  });
  it("drops unsafe image URLs (javascript:) and keeps valid ones", () => {
    const p = getProduct(db, "product_fx_camera")!;
    expect(p.product.imageUrls).toEqual(["https://images.example/a.jpg"]);
    expect(p.product.specs).toHaveLength(2);
    expect(p.product.specs[0]).toMatchObject({ key: "رزولوشن", value: "۲ مگاپیکسل" });
  });
  it("payment: channel 'unknown' is preserved as unknown; empty list means nothing declared", () => {
    expect(getShop(db, "shop_fx_03")!.shop.payment).toEqual({ declared: true, providers: [{ providerName: "اسنپ‌پی", channel: "unknown" }] });
    expect(getShop(db, "shop_fx_02")!.shop.payment).toEqual({ declared: false });
  });
  it("never exposes phone numbers; only validated public links, marked unverified", () => {
    const s = getShop(db, "shop_fx_01")!.shop;
    expect(JSON.stringify(s)).not.toContain("۰۰۰۰۰۰۰۰۰۰۰");
    expect(s.contactChannels).toEqual([
      { kind: "website", value: "https://fixture-shop.example/", trust: "unverified_public" },
      { kind: "instagram", value: "https://www.instagram.com/fixture_shop/", trust: "unverified_public" },
    ]);
  });
});

describe("declared hours (Asia/Tehran)", () => {
  const at = (local: string) => new Date(`${local}+03:30`);
  it("placeholder shifts are stripped, not turned into 24/7", () => {
    const h = getShop(db, "shop_fx_01")!.shop.hours;
    expect(h.days.sat).toEqual({ kind: "declared", windows: [{ start: "09:30", end: "19:30" }] });
    expect(h.days.sun).toEqual({ kind: "declared", windows: [{ start: "09:30", end: "13:00" }, { start: "16:00", end: "20:00" }] });
    expect(h.days.fri).toEqual({ kind: "closed" });
    expect(flagsOf("shop", "shop_fx_01")).toContain("HOURS_PLACEHOLDER_IGNORED");
  });
  it("no schedule → unknown at every hour (never closed)", () => {
    for (const t of ["2026-10-21T03:00:00", "2026-10-21T12:00:00", "2026-10-23T12:00:00"]) {
      expect(evaluateDeclaredHours(db, "shop_fx_02", at(t))!.status).toMatchObject({ state: "unknown", reasonCode: "NO_SCHEDULE" });
    }
    expect(flagsOf("shop", "shop_fx_02")).toContain("HOURS_UNKNOWN");
  });
  it("Friday declared closed, Wednesday daytime open, outside window closed", () => {
    expect(evaluateDeclaredHours(db, "shop_fx_01", at("2026-10-23T12:00:00"))!.status.state).toBe("closed");
    expect(evaluateDeclaredHours(db, "shop_fx_01", at("2026-10-21T11:00:00"))!.status.state).toBe("open");
    expect(evaluateDeclaredHours(db, "shop_fx_01", at("2026-10-21T21:00:00"))!.status.state).toBe("closed");
  });
  it("genuine second shift and the gap between shifts", () => {
    expect(evaluateDeclaredHours(db, "shop_fx_01", at("2026-10-25T10:00:00"))!.status.state).toBe("open");
    expect(evaluateDeclaredHours(db, "shop_fx_01", at("2026-10-25T14:30:00"))!.status.state).toBe("closed");
    expect(evaluateDeclaredHours(db, "shop_fx_01", at("2026-10-25T17:00:00"))!.status.state).toBe("open");
  });
  it("legit 00:00–23:45 stays; midnight-crossing window covers Thursday 01:00", () => {
    expect(evaluateDeclaredHours(db, "shop_fx_03", at("2026-10-26T00:10:00"))!.status.state).toBe("open"); // Monday 00:10
    expect(evaluateDeclaredHours(db, "shop_fx_03", at("2026-10-21T23:00:00"))!.status.state).toBe("open");
    expect(evaluateDeclaredHours(db, "shop_fx_03", at("2026-10-22T01:00:00"))!.status.state).toBe("open");
    expect(evaluateDeclaredHours(db, "shop_fx_03", at("2026-10-22T02:30:00"))!.status.state).toBe("closed");
  });
  it("unsupported day and placeholder-only day are unknown, with their own reason codes", () => {
    expect(evaluateDeclaredHours(db, "shop_fx_04", at("2026-10-20T12:00:00"))!.status).toMatchObject({ state: "unknown", reasonCode: "UNSUPPORTED_DAY" }); // Tuesday
    expect(evaluateDeclaredHours(db, "shop_fx_04", at("2026-10-21T12:00:00"))!.status).toMatchObject({ state: "unknown", reasonCode: "NO_REAL_WINDOWS" }); // Wednesday
  });
  it("invalid schedule JSON → unknown, never closed", () => {
    expect(evaluateDeclaredHours(db, "shop_fx_05", at("2026-10-21T12:00:00"))!.status.state).toBe("unknown");
  });
  it("rejects an invalid target time and returns null for an unknown shop", () => {
    expect(() => evaluateDeclaredHours(db, "shop_fx_01", "not a date")).toThrow(RangeError);
    expect(evaluateDeclaredHours(db, "shop_nope", new Date())).toBeNull();
  });
});

describe("read APIs: search / offers / geo are bounded and honest", () => {
  it("finds products by Persian words, Arabic-letter variants, and Latin model keys", () => {
    expect(searchProducts(db, "دوربین داهوا").items.map((i) => i.id)).toContain("product_fx_camera");
    expect(searchProducts(db, "كنتاكتور").items.map((i) => i.id)).toContain("product_fx_contactor"); // Arabic ك / ي
    expect(searchProducts(db, "HDW1200CLQP").items.map((i) => i.id)).toContain("product_fx_camera");
    expect(searchProducts(db, "hdw12").items.map((i) => i.id)).toContain("product_fx_camera"); // prefix
  });
  it("finds a product through a model that only appears in an OFFER title (variant sold)", () => {
    expect(searchProducts(db, "LC1D50AM7").items.map((i) => i.id)).toContain("product_fx_contactor");
  });
  it("is injection-safe, clamps limits, and labels the loose fallback", () => {
    expect(() => searchProducts(db, 'foo" OR NEAR(x) -bar*')).not.toThrow();
    expect(searchProducts(db, "   ").strategy).toBe("empty_query");
    expect(searchProducts(db, "پمپ", { limit: 10_000, offset: 10_000_000 })).toMatchObject({ limit: 50, offset: 1000 });
    const loose = searchProducts(db, "پمپ یاقوت");
    expect(loose.strategy).toBe("or_fallback");
    expect(loose.items.length).toBeGreaterThan(0);
  });
  it("lists offers with raw price text, unconfirmed stock and comparison eligibility", () => {
    const offers = listOffersForProduct(db, "product_fx_pump");
    expect(offers).toHaveLength(8);
    expect(offers.every((o) => o.stock === "unconfirmed")).toBe(true);
    const byId = Object.fromEntries(offers.map((o) => [o.offer.id, o]));
    expect(byId.offer_fx_12!.comparisonEligible).toBe(true);
    expect(byId.offer_fx_17!.comparisonEligible).toBe(false);
    expect(byId.offer_fx_19!.comparisonEligible).toBe(false);
    expect(byId.offer_fx_19!.priceRaw).toBe("733518940747298944");
    expect(listOffersForProduct(db, "product_fx_camera").find((o) => o.offer.id === "offer_fx_06")!.comparisonEligible).toBe(false);
  });
  it("sorts by distance and by price; duplicate/variant rows stay visible", () => {
    const d = listOffersForProduct(db, "product_fx_contactor", { near: { lat: 35.693, lon: 51.42 }, sort: "distance" });
    expect(d).toHaveLength(2);
    expect(d[0]!.distanceMeters).not.toBeNull();
    const p = listOffersForProduct(db, "product_fx_pump", { sort: "price" });
    expect(p[0]!.offer.priceToman).toBe(200000);
  });
  it("shopsNear: nearest first, bounded radius, optional offers-only", () => {
    const near = shopsNear(db, 35.693, 51.42, { radiusMeters: 600 });
    expect(near[0]!.shop.id).toMatch(/shop_fx_0[14]/);
    expect(near.every((n) => n.distanceMeters <= 600)).toBe(true);
    expect(shopsNear(db, 35.693, 51.42, { radiusMeters: 99_999_999 }).length).toBeLessThanOrEqual(100);
    expect(shopsNear(db, 35.695, 51.415, { radiusMeters: 500 }).map((n) => n.shop.id)).toContain("shop_fx_05");
    expect(shopsNear(db, 35.695, 51.415, { radiusMeters: 500, withOffersOnly: true }).map((n) => n.shop.id)).not.toContain("shop_fx_05");
    expect(shopsNear(db, Number.NaN, 51)).toEqual([]);
  });
  it("the read-only connection cannot write", () => {
    expect(() => db.exec("DELETE FROM offers")).toThrow();
  });
});

describe("atomic, idempotent, crash-safe import", () => {
  it("re-import yields a byte-for-byte equivalent logical database (same fingerprints)", async () => {
    const again = path.join(tmp, "again.sqlite");
    await importFixture(again);
    const a = new DatabaseSync(again, { readOnly: true });
    const fa = fingerprintDb(a);
    a.close();
    expect(fa).toEqual(fingerprintDb(db));
  });
  it("re-importing over the live path keeps the same content", async () => {
    const live = path.join(tmp, "live.sqlite");
    await importFixture(live);
    const fp1 = (() => { const d = new DatabaseSync(live, { readOnly: true }); const f = fingerprintDb(d); d.close(); return f; })();
    await importFixture(live);
    const d2 = new DatabaseSync(live, { readOnly: true });
    expect(fingerprintDb(d2)).toEqual(fp1);
    d2.close();
  });
  it("a crash mid-load leaves the previous database untouched and no staging file", async () => {
    const live = path.join(tmp, "crash.sqlite");
    await importFixture(live);
    const before = fs.readFileSync(live);
    await expect(importFixture(live, { failAfter: { table: "offers", rows: 5 } })).rejects.toThrow(/Injected failure/);
    expect(fs.readFileSync(live).equals(before)).toBe(true);
    expect(fs.readdirSync(tmp).filter((f) => f.startsWith("crash.sqlite.importing-"))).toEqual([]);
  });
  it("a failure after verification but before the swap also leaves the live database untouched", async () => {
    const live = path.join(tmp, "late.sqlite");
    await importFixture(live);
    const before = fs.readFileSync(live);
    await expect(importFixture(live, { failBeforeSwap: true })).rejects.toThrow(/Injected failure/);
    expect(fs.readFileSync(live).equals(before)).toBe(true);
  });
  it("a first-ever import that fails produces NO database file", async () => {
    const never = path.join(tmp, "never.sqlite");
    await expect(importFixture(never, { failAfter: { table: "products", rows: 2 } })).rejects.toThrow();
    expect(fs.existsSync(never)).toBe(false);
  });
  it("the verification gate rejects orphan references and keeps the live DB", async () => {
    const dir = path.join(tmp, "orphan-src");
    fs.cpSync(FIXTURE, dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "offers.csv"), ",2026-10-01T08:00:00+00:00,offer_fx_99,1000,product_missing,x,shop_fx_01,null\n");
    const live = path.join(tmp, "gate.sqlite");
    await importFixture(live);
    const before = fs.readFileSync(live);
    await expect(runImport({ source: { kind: "dir", path: dir }, outPath: live })).rejects.toThrow(/orphan/);
    expect(fs.readFileSync(live).equals(before)).toBe(true);
  });
  it("removes staging leftovers of dead processes (kill -9) but not those of live ones", () => {
    const live = path.join(tmp, "stale.sqlite");
    const dead = `${live}.importing-2147483646`; // pid that cannot exist
    const alive = `${live}.importing-${process.ppid}`; // a live process (our parent)
    fs.writeFileSync(dead, "x");
    fs.writeFileSync(alive, "x");
    expect(cleanStaleStaging(live)).toEqual([path.basename(dead)]);
    expect(fs.existsSync(dead)).toBe(false);
    expect(fs.existsSync(alive)).toBe(true);
    fs.rmSync(alive);
  });
  it("rejects a CSV whose header does not match the expected schema", async () => {
    const dir = path.join(tmp, "badheader");
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const f = path.join(dir, "shops.csv");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("weekly_hours", "weekly_hoursX"));
    await expect(runImport({ source: { kind: "dir", path: dir }, outPath: path.join(tmp, "bh.sqlite") })).rejects.toThrow(/header mismatch/);
  });
});

describe("ZIP source safety", () => {
  it("reads the CSVs straight from a ZIP and ignores __MACOSX junk", async () => {
    const out = path.join(tmp, "zip.sqlite");
    const r = await runImport({ source: { kind: "zip", path: path.join(ZIPS, "ok.zip") }, outPath: out });
    expect(r.rowsStored).toEqual({ products: 6, shops: 6, offers: 21 });
    expect(r.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    const d = new DatabaseSync(out, { readOnly: true });
    expect(fingerprintDb(d)).toEqual(fingerprintDb(db));
    d.close();
  });
  it.each([
    ["traversal.zip", /invalid relative path|Unsafe ZIP entry/],
    ["absolute.zip", /absolute path|Unsafe ZIP entry/],
    ["missing.zip", /missing/],
    ["ambiguous.zip", /Ambiguous/],
  ])("rejects %s", async (name, re) => {
    await expect(openSource({ kind: "zip", path: path.join(ZIPS, name) })).rejects.toThrow(re);
    expect(fs.existsSync(path.join(tmp, "..", "evil.csv"))).toBe(false);
  });
  it("never modifies the source files", async () => {
    const before = fs.readFileSync(path.join(FIXTURE, "offers.csv"));
    await importFixture(path.join(tmp, "ro.sqlite"));
    expect(fs.readFileSync(path.join(FIXTURE, "offers.csv")).equals(before)).toBe(true);
  });
});
