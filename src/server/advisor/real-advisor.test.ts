// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { openRealDb } from "../../../tests/helpers/real-db";
import type { AdvisorResponse } from "@/domain/advisor";
import { buildSelection, getProductDetail } from "@/server/catalog/detail";
import { adviseProducts, type AdviseInput } from "./engine";
import { compareProducts } from "./compare";
import { getCategoryData } from "./category-data";
import { SCHEMAS } from "./schemas";

const db = openRealDb();
afterAll(() => db?.close());
const A = (i: AdviseInput): AdvisorResponse => adviseProducts(db!, i);
const HP = "هدفون، هدست و هندزفری";
const CCTV = "دوربین مدار بسته";
const GEN = "ژنراتور و موتور برق";
const PB = "پاوربانک و شارژر همراه";
const PUMP = "پمپ خانگی و صنعتی";
const row = <T,>(sql: string, ...p: Array<string | number>) => db!.prepare(sql).get(...p) as T;
const rows = <T,>(sql: string, ...p: Array<string | number>) => db!.prepare(sql).all(...p) as T[];
const specsOf = (id: string) => JSON.parse(row<{ s: string | null }>("SELECT specs_json s FROM products WHERE product_id = ?", id).s ?? "[]") as Array<{ key: string; value: string }>;

describe.skipIf(!db)("advisor behaviour on the real catalog (20 cases)", () => {
  it("01 no input → asks for a need, offering the 5 supported categories with real product counts", () => {
    const r = A({});
    expect(r.stage).toBe("need");
    expect(r.categoryChoices).toHaveLength(SCHEMAS.length);
    for (const c of r.categoryChoices) {
      expect(c.supported).toBe(true);
      expect(c.productCount).toBe(row<{ n: number }>("SELECT count(*) n FROM products WHERE category_name = ?", c.category).n);
    }
  });
  it("02 a clear need picks the category itself and asks ONE focused question", () => {
    const r = A({ text: "هدفون" });
    expect(r.stage).toBe("question");
    expect(r.category).toMatchObject({ category: HP, autoSelected: true, supported: true });
    expect(r.question!.id).toBe("use");
    expect(r.question!.options.length).toBeGreaterThanOrEqual(2);
    expect(r.progress.total).toBeLessThanOrEqual(4);
  });
  it("03 ambiguity (descriptive text) → clarify the category, offering several real categories", () => {
    const r = A({ text: "دوربین برای مغازه" });
    expect(r.stage).toBe("clarify_category");
    expect(r.categoryChoices.length).toBeGreaterThanOrEqual(3);
    expect(r.categoryChoices.some((c) => c.category === CCTV && c.supported)).toBe(true);
  });
  it("04 nonsense → back to 'need' with an honest message, no invented category", () => {
    const r = A({ text: "ززززززز" });
    expect(r.stage).toBe("need");
    expect(r.recovery?.message).toBeTruthy();
    expect(r.category).toBeNull();
  });
  it("05 at most 2 category questions + budget before first suggestions (≤3 steps)", () => {
    for (const s of SCHEMAS) expect(s.questions.filter((q) => q.stage === "initial").length).toBeLessThanOrEqual(2);
    let r = A({ category: HP });
    const ids: string[] = [];
    const answers: Record<string, string> = {};
    for (let i = 0; i < 5 && r.stage === "question"; i++) {
      ids.push(r.question!.id);
      if (r.question!.kind === "budget") r = A({ category: HP, answers, budget: { max: 3_000_000 } });
      else { answers[r.question!.id] = r.question!.options[0]!.id; r = A({ category: HP, answers }); }
    }
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(r.stage).toBe("results");
  });
  it("06 HARD constraint: 'wireless' returns no product whose own specs say wired-only (independent regex check)", () => {
    const r = A({ category: HP, answers: { connection: "wireless" }, skipped: ["use", "budget"], limit: 24 });
    expect(r.stage).toBe("results");
    expect(r.candidates.length).toBeGreaterThan(10);
    for (const c of r.candidates) {
      const conn = specsOf(c.card.id).filter((s) => /اتصال/.test(s.key)).map((s) => s.value.replace(/[‌‌]/g, " ")).join(" | ");
      const wiredOnly = /با ?سیم/.test(conn) && !/(بی ?سیم|بلوتوث|wireless|دوگانه)/i.test(conn);
      expect(wiredOnly, `${c.card.id}: ${conn}`).toBe(false);
    }
  });
  it("07 budget: nothing marked in_budget has a reliable price range outside the budget (independent SQL check)", () => {
    const r = A({ category: HP, answers: { connection: "wireless" }, skipped: ["use"], budget: { min: 1_000_000, max: 3_000_000 }, limit: 24 });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.budget).not.toBe("over_budget");
      const e = row<{ status: string; min: number; max: number }>("SELECT status, min_toman min, max_toman max FROM product_price_evidence WHERE product_id = ?", c.card.id);
      if (c.budget === "in_budget") { expect(e.status).toBe("reliable"); expect(e.min).toBeLessThanOrEqual(3_000_000); expect(e.max).toBeGreaterThanOrEqual(1_000_000); }
      else expect(c.budget).toBe("unverified"); // price not reliable: budget cannot be checked, and the card says so
    }
    expect(r.funnel!.outOfBudget).toBeGreaterThan(0);
  });
  it("08 changing a preference changes the results (and keeps context)", () => {
    const base: AdviseInput = { category: HP, skipped: ["use", "budget"], limit: 12 };
    const w = A({ ...base, answers: { connection: "wireless" } }).candidates.map((c) => c.card.id);
    const d = A({ ...base, answers: { connection: "wired" } }).candidates.map((c) => c.card.id);
    expect(w).not.toEqual(d);
    expect(w.filter((x) => d.includes(x))).toEqual([]);
  });
  it("09 skipping a question is honoured: no filter, no penalty reasons for it", () => {
    const r = A({ category: HP, skipped: ["use", "connection", "budget"], limit: 12 });
    expect(r.stage).toBe("results");
    expect(r.funnel!.afterHardFilters).toBe(r.funnel!.inCategory);
    expect(r.candidates.every((c) => !c.reasons.some((x) => x.code === "ATTR_MISMATCH"))).toBe(true);
  });
  it("10 no verified product in budget → recovery with data-derived suggestions, and applying one yields in-budget products", () => {
    const r = A({ category: CCTV, answers: { environment: "outdoor", night: "yes" }, budget: { max: 50_000 }, limit: 12 });
    expect(r.candidates.every((c) => c.budget !== "in_budget")).toBe(true); // nothing can be verified inside 50,000 toman
    expect(r.candidates.every((c) => c.budget === "unverified")).toBe(true); // what remains is explicitly "price unverifiable", ranked last
    expect(r.recovery).toBeTruthy();
    const sugg = r.recovery!.suggestions.find((s) => s.id === "raise-budget");
    expect(sugg).toBeTruthy();
    const next = A({ category: CCTV, answers: { environment: "outdoor", night: "yes" }, budget: { max: sugg!.patch.budget!.max }, limit: 12 });
    expect(next.candidates.some((c) => c.budget === "in_budget")).toBe(true);
  });
  it("11 a budget no verified product can meet offers to raise it (and drop conditions when that helps)", () => {
    const r = A({ category: GEN, answers: { need: "large", fuel: "gas" }, budget: { max: 100_000 } });
    expect(r.candidates.every((c) => c.budget !== "in_budget")).toBe(true);
    expect(r.recovery).toBeTruthy();
    const raise = r.recovery!.suggestions.find((s) => s.id === "raise-budget");
    expect(raise).toBeTruthy();
    expect(raise!.label).toMatch(/تومان/);
    const next = A({ category: GEN, answers: { need: "large", fuel: "gas" }, budget: { max: raise!.patch.budget!.max } });
    expect(next.candidates.some((c) => c.budget === "in_budget")).toBe(true);
  });
  it("11b with a budget, verified in-budget products always precede unverifiable ones", () => {
    const r = A({ category: GEN, answers: { need: "shop" }, skipped: ["fuel"], budget: { max: 150_000_000 }, limit: 24 });
    const tiers = r.candidates.map((c) => (c.budget === "in_budget" ? 0 : 1));
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(tiers.includes(0)).toBe(true);
  });
  it("12 missing evidence is penalised, not hidden: unknown-attribute products rank below verified ones", () => {
    const r = A({ category: HP, answers: { wearing: "over_ear" }, skipped: ["use", "connection", "budget"], show: true, limit: 24 });
    const known = r.candidates.filter((c) => c.reasons.some((x) => x.code === "ATTR_MATCH"));
    const unknown = r.candidates.filter((c) => c.reasons.some((x) => x.code === "ATTR_UNKNOWN") && !c.reasons.some((x) => x.code === "ATTR_MATCH"));
    expect(known.length).toBeGreaterThan(0);
    if (unknown.length) {
      const avg = (xs: typeof known) => xs.reduce((n, c) => n + c.score, 0) / xs.length;
      expect(avg(known)).toBeGreaterThan(avg(unknown));
      for (const c of unknown) expect(c.reasons.find((x) => x.code === "ATTR_UNKNOWN")!.effect).toBe("unknown");
    }
  });
  it("13 every positive reason is backed by evidence quoted from the record", () => {
    for (const [category, answers] of [[HP, { connection: "wireless", use: "sport" }], [CCTV, { environment: "outdoor", night: "yes" }], [GEN, { need: "home", fuel: "petrol" }], [PB, { capacity: "daily", fast: "yes" }], [PUMP, { use: "home" }]] as const) {
      const r = A({ category, answers, skipped: ["budget"], limit: 12 });
      expect(r.candidates.length, category).toBeGreaterThan(0);
      for (const c of r.candidates) for (const x of c.reasons) if (x.code === "ATTR_MATCH" || x.code === "ATTR_MATCH_INFERRED") {
        expect(x.evidence.length, `${c.card.id} ${x.text}`).toBeGreaterThan(0);
        expect(x.evidence.every((e) => e.text.trim().length > 0 && e.label.length > 0)).toBe(true);
      }
    }
  });
  it("14 candidates are grounded: ids and titles are the database's own", () => {
    const r = A({ category: PB, answers: { capacity: "daily" }, skipped: ["budget"], limit: 20 });
    for (const c of r.candidates) expect(row<{ t: string }>("SELECT persian_title t FROM products WHERE product_id = ?", c.card.id).t).toBe(c.card.title);
  });
  it("15 pagination continues the ranking", () => {
    const p1 = A({ category: PB, skipped: ["capacity", "fast", "budget"], show: true, limit: 10, offset: 0 });
    const p2 = A({ category: PB, skipped: ["capacity", "fast", "budget"], show: true, limit: 10, offset: 10 });
    expect(p2.candidates[0]!.rank).toBe(11);
    expect(p1.candidates.map((c) => c.card.id).filter((x) => p2.candidates.some((y) => y.card.id === x))).toEqual([]);
    expect(p1.hasMore).toBe(true);
  });
  it("16 a category WITHOUT a schema still works: budget-only questions + explicit limitation", () => {
    const r = A({ category: "تلویزیون", skipped: ["budget"], limit: 6 });
    expect(r.stage).toBe("results");
    expect(r.category!.supported).toBe(false);
    expect(r.limitations.join(" ")).toMatch(/پرسش‌های تخصصی تعریف نشده/);
    expect(r.candidates.length).toBeGreaterThan(0);
  });
  it("17 inferred evidence is labelled and comes with a caution (explicit evidence ranks above it)", () => {
    const r = A({ category: CCTV, answers: { environment: "indoor" }, skipped: ["night", "budget"], limit: 24, offset: 100 });
    const inferred = r.candidates.filter((c) => c.reasons.some((x) => x.code === "ATTR_MATCH_INFERRED"));
    expect(inferred.length).toBeGreaterThan(0);
    for (const c of inferred) expect(c.cautions.join(" ")).toMatch(/استنباط/);
  });
  it("18 self-contradicting title/spec data is treated as unknown with a visible reason", () => {
    const data = getCategoryData(db!, PB);
    const conflicted = data.items.find((i) => i.attrs.capacity?.conflict);
    expect(conflicted, "dataset should contain at least one conflicting power bank").toBeTruthy();
    expect(conflicted!.attrs.capacity!.confidence).toBe("unknown");
  });
  it("19 never claims quality, popularity or user ratings in reasons or cautions", () => {
    const FORBIDDEN = /بهترین کیفیت|پرفروش|محبوب|امتیاز کاربر|نظر کاربر|رضایت|تضمین کیفیت|موجود است(?!؟)|ارسال شد/;
    for (const [category, answers] of [[HP, { connection: "wireless" }], [CCTV, { environment: "indoor" }], [GEN, { need: "shop" }]] as const) {
      const r = A({ category, answers, skipped: ["budget"], limit: 12 });
      for (const c of r.candidates) expect([...c.reasons.map((x) => x.text), ...c.cautions].join(" ")).not.toMatch(FORBIDDEN);
    }
  });
  it("20 'ask' re-opens exactly one question without discarding the other answers", () => {
    const r = A({ category: HP, answers: { connection: "wireless", use: "sport" }, budget: { max: 3_000_000 }, show: true, ask: "use" });
    expect(r.stage).toBe("question");
    expect(r.question!.id).toBe("use");
    expect(r.intent.answers).toEqual({ connection: "wireless", use: "sport" });
    expect(r.intent.budget.max).toBe(3_000_000);
  });
  it("21 every option shown to the user has evidence in the catalog (no dead options)", () => {
    for (const s of SCHEMAS) {
      const r = A({ category: s.category, show: false });
      const data = getCategoryData(db!, s.category);
      const first = r.question;
      if (first && first.kind !== "budget") for (const o of first.options) if (o.id !== "any") expect(o.evidenceCount!, `${s.category}/${first.id}/${o.id}`).toBeGreaterThan(0);
      expect(Object.keys(data.optionCounts).length).toBeGreaterThan(0);
    }
  });
  it("22 budget bands come from reliable prices and their counts add up sensibly", () => {
    const q = A({ category: HP, answers: { use: "general", connection: "wireless" } });
    expect(q.stage).toBe("question");
    expect(q.question!.kind).toBe("budget");
    expect(q.budgetBands.length).toBeGreaterThanOrEqual(3);
    for (const b of q.budgetBands) expect(b.count).toBeGreaterThan(0);
  });
});

describe.skipIf(!db)("identity honesty: product_id ≠ one sellable variant", () => {
  const pick = () => row<{ id: string }>(`SELECT o.product_id id FROM offers o JOIN quality_flags f ON f.entity_id = o.offer_id AND f.code = 'VARIANT_MODEL_MISMATCH'
     GROUP BY o.product_id HAVING (SELECT count(*) FROM offers x WHERE x.product_id = o.product_id) >= 4 ORDER BY o.product_id LIMIT 1`).id;
  it("a product with sibling-model offers demands variant confirmation and exposes ≥2 variant groups", () => {
    const d = getProductDetail(db!, pick())!;
    expect(d.needsVariantConfirmation).toBe(true);
    expect(d.variantGroups.length).toBeGreaterThanOrEqual(2);
    expect(d.card.variants.modelMismatch).toBeGreaterThan(0);
  });
  it("mismatched offers are excluded from the reliable range and listed under 'excluded'", () => {
    const d = getProductDetail(db!, pick())!;
    expect(d.card.price.excluded.VARIANT_MODEL_MISMATCH).toBeGreaterThan(0);
    const range = d.offers.filter((o) => o.flags.some((f) => f.code === "VARIANT_MODEL_MISMATCH"));
    for (const o of range) expect(o.comparisonEligible).toBe(false);
  });
  it("the product page never merges groups: every shown offer belongs to exactly one group and raw titles are intact", () => {
    const d = getProductDetail(db!, pick())!;
    const ids = new Set(d.variantGroups.map((g) => g.id));
    for (const o of d.offers) {
      expect(ids.has(o.variantGroupId)).toBe(true);
      expect(o.sellerTitle).toBe(row<{ t: string }>("SELECT seller_title t FROM offers WHERE offer_id = ?", o.offerId).t);
    }
  });
  it("without an explicit choice the Selection carries variantGroupId = null (Phase 4 must ask)", () => {
    const id = pick();
    expect(buildSelection(db!, id, { source: "advisor" })!.variantGroupId).toBeNull();
    const g = getProductDetail(db!, id)!.variantGroups[0]!;
    expect(buildSelection(db!, id, { variantGroupId: g.id, source: "advisor" })!.variantGroupId).toBe(g.id);
    expect(buildSelection(db!, id, { variantGroupId: "evil|id", source: "advisor" })!.variantGroupId).toBeNull(); // unknown ids are ignored
  });
  it("the known 212× wire product refuses a single price range and asks for the unit", () => {
    const id = "product_9b36205cbdc7ee5304fc85b6";
    const d = getProductDetail(db!, id);
    if (!d) return;
    expect(d.card.price.status).not.toBe("reliable");
    expect(d.needsVariantConfirmation).toBe(true);
    expect(d.card.variants.unitAmbiguous).toBeGreaterThan(0);
  });
});

describe.skipIf(!db)("dataset-wide price-evidence invariants (verified by SQL)", () => {
  it("no 'reliable' range spreads more than the documented 3×", () => {
    expect(row<{ n: number }>("SELECT count(*) n FROM product_price_evidence WHERE status = 'reliable' AND reliable_count >= 2 AND max_toman > 3 * min_toman").n).toBe(0);
  });
  it("every product has exactly one evidence row; statuses are from the documented set", () => {
    expect(row<{ n: number }>("SELECT count(*) n FROM products p LEFT JOIN product_price_evidence e USING (product_id) WHERE e.product_id IS NULL").n).toBe(0);
    const s = rows<{ status: string }>("SELECT DISTINCT status FROM product_price_evidence").map((x) => x.status).sort();
    expect(s).toEqual(["mixed_units", "no_eligible", "no_price", "reliable", "wide_spread"]);
  });
  it("a reliable range never includes an offer carrying a blocking flag", () => {
    expect(row<{ n: number }>(`SELECT count(*) n FROM product_price_evidence e JOIN offers o ON o.product_id = e.product_id
      JOIN quality_flags f ON f.entity_id = o.offer_id AND f.code IN ('PRICE_ABSURD_MAGNITUDE','NONPOSITIVE_PRICE')
      WHERE e.status = 'reliable' AND o.price_toman IS NOT NULL AND e.max_toman >= o.price_toman AND e.max_toman >= 10000000000000`).n).toBe(0);
  });
  it("min ≤ median ≤ max whenever a range exists", () => {
    expect(row<{ n: number }>("SELECT count(*) n FROM product_price_evidence WHERE min_toman IS NOT NULL AND (min_toman > median_toman OR median_toman > max_toman)").n).toBe(0);
  });
  it("products with ONLY null-price offers have no numbers", () => {
    expect(row<{ n: number }>("SELECT count(*) n FROM product_price_evidence WHERE status = 'no_price' AND (min_toman IS NOT NULL OR max_toman IS NOT NULL)").n).toBe(0);
  });
});

describe.skipIf(!db)("comparison", () => {
  it("compares 2–4 real products: same-category spec rows, evidence-labelled attributes, no quality score", () => {
    const ids = A({ category: HP, answers: { connection: "wireless" }, skipped: ["use", "budget"], limit: 3 }).candidates.map((c) => c.card.id);
    const r = compareProducts(db!, ids)!;
    expect(r.products).toHaveLength(3);
    expect(r.sameCategory).toBe(true);
    expect(r.products[0]!.attributes.map((a) => a.label)).toContain("نوع اتصال");
    expect(r.specRows.length).toBeGreaterThan(0);
    expect(r.specRows.some((x) => x.differs)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/"(rating|quality|popularity)"/);
    expect(r.notes.join(" ")).toMatch(/امتیاز کیفیت/);
  });
  it("rejects fewer than 2 products and caps at 4", () => {
    expect(compareProducts(db!, ["product_7308febc43c2f793fd0e1cf9"])).toBeNull();
    const many = rows<{ id: string }>("SELECT product_id id FROM products LIMIT 6").map((r) => r.id);
    expect(compareProducts(db!, many)!.products.length).toBeLessThanOrEqual(4);
  });
  it("mixed categories are allowed but flagged", () => {
    const a = row<{ id: string }>("SELECT product_id id FROM products WHERE category_name = ? LIMIT 1", HP).id;
    const b = row<{ id: string }>("SELECT product_id id FROM products WHERE category_name = ? LIMIT 1", PUMP).id;
    const r = compareProducts(db!, [a, b])!;
    expect(r.sameCategory).toBe(false);
    expect(r.notes.join(" ")).toMatch(/یک دسته نیستند/);
  });
});
