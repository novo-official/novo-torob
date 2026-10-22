// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { openRealDb } from "../../../tests/helpers/real-db";
import { searchCatalog } from "./search";
import type { SearchResponse } from "@/domain/advisor";

const db = openRealDb();
afterAll(() => db?.close());
const S = (q: string, o: { limit?: number; category?: string; offset?: number } = {}): SearchResponse => searchCatalog(db!, { q, limit: o.limit ?? 10, category: o.category ?? null, offset: o.offset });
const titles = (r: SearchResponse) => r.items.map((i) => i.card.title);
const cats = (r: SearchResponse) => r.items.map((i) => i.card.categoryName);
const CCTV = "دوربین مدار بسته";
const HP = "هدفون، هدست و هندزفری";
const PB = "پاوربانک و شارژر همراه";
const DAHUA = "product_7308febc43c2f793fd0e1cf9";

describe.skipIf(!db)("real catalog search (30 cases)", () => {
  // ---- exact model matching
  it("01 compact model key finds its product at rank 1", () => expect(S("hdw1200clqp").items[0]!.card.id).toBe(DAHUA));
  it("02 full hyphenated model finds it", () => expect(S("DH-HAC-HDW1200CLQP-IL-A").items.map((i) => i.card.id)).toContain(DAHUA));
  it("03 Persian words + Latin model: product first, labelled exact_model", () => {
    const r = S("دوربین داهوا HDW1200CLQP-IL-A");
    expect(r.items[0]!.card.id).toBe(DAHUA);
    expect(r.items[0]!.match).toBe("exact_model");
  });
  it("04 an exact model with ONE seller outranks products with far more sellers", () => {
    const r = S("JD8500");
    expect(r.items.slice(0, 5).every((i) => /jd ?8500/i.test(i.card.title))).toBe(true);
    expect(r.items.every((i) => i.match === "exact_model" || i.match === "full")).toBe(true);
  });
  it("05 Persian digits inside a model are normalised", () => expect(S("موتور برق JD۸۵۰۰").items[0]!.card.title).toMatch(/JD ?8500/i));
  it("06 prefix of a model works (typing in progress)", () => expect(S("hdw1200cl").items.map((i) => i.card.id)).toContain(DAHUA));
  // ---- Persian normalization & spacing
  it("07 Arabic yeh/kaf spelling finds the same category as the Persian spelling", () => {
    expect(cats(S("كنتاكتور اشنايدر")).every((c) => c === "کنتاکتور")).toBe(true);
  });
  it("08 «دوربین مدار بسته» and «دوربین مداربسته» both return CCTV products", () => {
    for (const q of ["دوربین مدار بسته", "دوربین مداربسته"]) expect(cats(S(q)).filter((c) => c === CCTV).length).toBeGreaterThanOrEqual(8);
  });
  it("09 half-space spelling (بی‌سیم) behaves like the spaced one", () => {
    const a = new Set(S("هدفون بی‌سیم", { limit: 20 }).items.map((i) => i.card.id));
    const b = new Set(S("هدفون بی سیم", { limit: 20 }).items.map((i) => i.card.id));
    const common = [...a].filter((x) => b.has(x)).length;
    expect(common / Math.max(a.size, 1)).toBeGreaterThan(0.8);
  });
  it("10 Persian digits in a quantity (۲۰۰۰۰) match Latin digits in titles", () => {
    const r = S("پاور بانک ۲۰۰۰۰");
    expect(cats(r).every((c) => c === PB)).toBe(true);
    expect(titles(r).every((t) => /(20000|۲۰۰۰۰|20 ?هزار|۲۰ ?هزار)/.test(t))).toBe(true);
  });
  it("11 spacing variant پاور بانک ⇄ پاوربانک returns the same category", () => {
    for (const q of ["پاور بانک", "پاوربانک"]) expect(cats(S(q)).every((c) => c === PB)).toBe(true);
  });
  // ---- synonyms & mixed script
  it("12 synonym: هندزفری → headphone category", () => expect(cats(S("هندزفری")).every((c) => c === HP)).toBe(true));
  it("13 synonym: ژنراتور and generator and موتور برق reach the generator category", () => {
    for (const q of ["ژنراتور", "generator", "موتور برق"]) expect(cats(S(q)).every((c) => c === "ژنراتور و موتور برق")).toBe(true);
  });
  it("14 Latin brand and Persian brand both work (dahua ⇄ داهوا)", () => {
    for (const q of ["داهوا", "dahua"]) expect(titles(S(q, { limit: 20 })).filter((t) => /داهوا|dahua/i.test(t)).length).toBeGreaterThanOrEqual(15);
  });
  it("15 English product words: airpods pro", () => expect(titles(S("airpods pro")).slice(0, 3).every((t) => /airpods/i.test(t))).toBe(true));
  it("16 Persian transliteration: ایرپاد پرو", () => expect(titles(S("ایرپاد پرو")).slice(0, 3).every((t) => /ایرپاد/.test(t))).toBe(true));
  // ---- typo tolerance
  it("17 typo هدفن بیسیم is corrected and reported", () => {
    const r = S("هدفن بیسیم");
    expect(r.corrections.some((c) => c.to === "هدفون")).toBe(true);
    expect(cats(r).filter((c) => c === HP).length).toBeGreaterThanOrEqual(8);
  });
  it("18 typo tolerance can be disabled (used by the evaluation harness)", () => {
    const off = searchCatalog(db!, { q: "هدفوون بیسیم", limit: 5, typo: false });
    const on = searchCatalog(db!, { q: "هدفوون بیسیم", limit: 5 });
    expect(off.corrections).toEqual([]);
    expect(off.strategy).toBe("partial"); // without correction only the clearly-labelled "one word dropped" fallback remains
    expect(on.corrections.some((c) => c.to === "هدفون")).toBe(true);
    expect(on.strategy).not.toBe("partial");
    expect(on.items.every((i) => i.card.categoryName === HP)).toBe(true);
  });
  // ---- category-aware ranking
  it("19 head-word lead: «گوشی» prefers phones over phone accessories", () => expect(cats(S("گوشی", { limit: 3 })).every((c) => /^گوشی /.test(c))).toBe(true));
  it("20 «گوشی سامسونگ A54» puts real phones before accessories", () => expect(cats(S("گوشی سامسونگ A54", { limit: 3 })).every((c) => c === "گوشی موبایل")).toBe(true));
  it("21 «جاروبرقی» (joined) finds «جارو برقی» categories first", () => expect(cats(S("جاروبرقی", { limit: 3 })).every((c) => c.startsWith("جارو برقی"))).toBe(true));
  it("22 category filter restricts every result", () => {
    const r = S("پمپ", { category: "پمپ خانگی و صنعتی", limit: 20 });
    expect(r.items.length).toBeGreaterThan(5);
    expect(cats(r).every((c) => c === "پمپ خانگی و صنعتی")).toBe(true);
  });
  // ---- invalid / generic input
  it("23 empty, whitespace, punctuation and stop-word-only queries are rejected with a message", () => {
    for (const q of ["", "   ", "!!!", "و", "با از به", "قیمت بهترین خرید"]) {
      const r = S(q);
      expect(r.valid).toBe(false);
      expect(r.items).toEqual([]);
      expect(r.recovery?.message).toBeTruthy();
    }
  });
  it("24 SQL/FTS injection strings are inert", () => {
    for (const q of ["'; DROP TABLE products; --", '" OR 1=1 --', "NEAR(a b)", "a* OR b*", "\\\\", "{title}: x"]) expect(() => S(q)).not.toThrow();
    expect(Number((db!.prepare("SELECT count(*) n FROM products").get() as { n: number }).n)).toBeGreaterThan(200_000);
  });
  it("25 limit and offset are clamped", () => {
    expect(S("هدفون", { limit: 10_000 }).limit).toBe(50);
    expect(S("هدفون", { limit: -5 }).limit).toBe(1);
    expect(S("هدفون", { offset: 99_999 }).offset).toBe(500);
  });
  // ---- identity honesty
  it("26 a model found only inside seller titles is labelled offer_model, not exact_model", () => {
    const r = S("کنتاکتور LC1D95AM7");
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.some((i) => i.match === "offer_model")).toBe(true);
  });
  it("27 no-result query returns a recovery message and no fabricated items", () => {
    const r = S("ززززززززز");
    expect(r.items).toEqual([]);
    expect(r.recovery?.message).toMatch(/پیدا نشد/);
  });
  it("28 partial fallback is explicit and penalised", () => {
    const r = S("هدفون کاملا ناشناخته‌ای");
    if (r.items.length) {
      expect(r.strategy).toBe("partial");
      expect(r.items.every((i) => i.match === "partial")).toBe(true);
    } else expect(r.recovery).toBeTruthy();
  });
  it("29 every returned card is a real catalog row with consistent fields", () => {
    const r = S("پمپ آب", { limit: 20 });
    for (const it of r.items) {
      const row = db!.prepare("SELECT persian_title t, category_name c FROM products WHERE product_id = ?").get(it.card.id) as { t: string; c: string };
      expect(row.t).toBe(it.card.title);
      expect(row.c).toBe(it.card.categoryName);
    }
  });
  it("30 pagination is stable and non-overlapping", () => {
    const p1 = S("هدفون", { limit: 10, offset: 0 }).items.map((i) => i.card.id);
    const p2 = S("هدفون", { limit: 10, offset: 10 }).items.map((i) => i.card.id);
    expect(p1.filter((x) => p2.includes(x))).toEqual([]);
    expect(S("هدفون", { limit: 10, offset: 0 }).items.map((i) => i.card.id)).toEqual(p1);
  });
});
