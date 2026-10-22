// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMission, transition } from "./mission-state";
import type { InquiryContext, InquiryEvent, InquiryState, ReplyEvidence } from "./inquiry";
import { deriveOutcome, initialInquiryState, inquiryReducer, missionStateFor } from "./inquiry";
import { DEMO_SCENARIOS, runDemoScenario, seedOf, altModelKey } from "./inquiry-demo";
import { comparePrices, interpretAmount, sanitizeText, suggestFromText } from "./inquiry-parse";
import { buildQuestions, categoryProfile, composeFollowUp, composeInquiry, defaultQuestionIds } from "./inquiry-questions";

export const ctxOf = (over: Partial<InquiryContext["offer"]> = {}, more: Partial<InquiryContext> = {}): InquiryContext => ({
  product: { id: "product_aaaaaaaa", title: "دوربین مدار بسته داهوا مدل HDW1200CLQP", categoryName: "دوربین مدار بسته", productHref: "/products/product_aaaaaaaa" },
  variant: { selectedGroupId: "unknown|HDW1200CLQP", label: "کد مدل HDW1200CLQP", modelKey: "HDW1200CLQP", unitHint: "unknown", needsConfirmation: false },
  shop: { id: "shop_bbbbbbbb", name: "فروشگاه نمونه", locationLabel: "فردوسی", address: "تهران، پاساژ نمونه", pseudonymNoteFa: "مستعار", sharedCoordinates: 2, website: null, instagram: null, shopHref: "/shops/shop_bbbbbbbb" },
  offer: { id: "offer_cccccccc", sellerTitle: "دوربین داهوا HDW1200CLQP-IL-A", priceToman: 4_100_000, priceRaw: "4100000", recordedAt: "2026-10-11T07:00:00Z", recordedAtLabel: "ثبت‌شده در ۱۹ مهر ۱۴۰۵", ageDaysToday: 11, unitHint: "unknown", packQuantity: null, tier: "A", identityEvidenceFa: [], comparabilityFa: "قیمت قابل‌اتکا", warranty: { kind: "UNKNOWN", months: null, provider: null, description: null, labelFa: "گارانتی اعلام نشده" }, flags: [], outsideSelectedVariant: false, ...over },
  otherOffersOfShop: [], payment: { declared: false, providers: [], bucket: "UNDECLARED", labelFa: "پرداخت اعلام نشده" },
  hours: { state: "UNKNOWN", labelFa: "ساعت کاری اعلام نشده", atTehran: "2026-10-22T12:00:00+03:30", window: null, reasonCode: "NO_SCHEDULE" },
  visit: { atTehran: "2026-10-22T09:00:00.000Z", isNow: true, input: null }, category: "cctv", facts: [], unknownsFa: [],
  routes: { sellersHref: "/sellers?product=product_aaaaaaaa", compareHref: "/compare?product=product_aaaaaaaa&shops=shop_bbbbbbbb", discoverHref: "/discover?cat=x" }, contactChannel: "NONE_VERIFIED", ...more,
});
const AT = "2026-10-22T09:00:00Z";
const user = (id = "r1", over: Partial<ReplyEvidence> = {}): ReplyEvidence => ({ id, provenance: "USER_REPORTED", rawText: "پاسخ", stock: "unknown", reportedPriceToman: null, reportedUnit: "same", model: "not_asked", warranty: { report: "not_asked", months: null }, payment: "not_asked", visitNote: "", receivedLabel: null, scenarioId: null, ...over });
const run = (s: InquiryState, ...evs: InquiryEvent[]) => evs.reduce((a, e) => inquiryReducer(a, e), s);
const S0 = () => initialInquiryState(["q_stock", "q_price"]);

describe("inquiry status machine", () => {
  it("COPIED is not CONTACTED, and neither is a reply", () => {
    const c = run(S0(), { type: "COPY", at: AT });
    expect(c.status).toBe("COPIED");
    expect(c.contactedAt).toBeNull();
    const k = run(c, { type: "MARK_CONTACTED", at: AT });
    expect(k.status).toBe("USER_MARKED_CONTACTED");
    expect(k.replies).toHaveLength(0);
  });
  it("replies produce user-reported statuses by stock answer; the user's own contact is recorded implicitly", () => {
    expect(run(S0(), { type: "ENTER_REPLY", reply: user("a", { stock: "yes" }), at: AT })).toMatchObject({ status: "USER_REPORTED_AVAILABLE", contactedAt: AT });
    expect(run(S0(), { type: "ENTER_REPLY", reply: user("a", { stock: "no" }), at: AT }).status).toBe("USER_REPORTED_UNAVAILABLE");
    expect(run(S0(), { type: "ENTER_REPLY", reply: user("a"), at: AT }).status).toBe("USER_ENTERED_REPLY");
  });
  it("is idempotent / retry-safe: repeated copy, duplicate reply id, duplicate no-response", () => {
    const a = run(S0(), { type: "COPY", at: AT }, { type: "COPY", at: "2026-10-22T09:05:00Z" });
    expect(a.status).toBe("COPIED");
    const r = run(S0(), { type: "ENTER_REPLY", reply: user("x", { stock: "yes" }), at: AT }, { type: "ENTER_REPLY", reply: user("x", { stock: "no" }), at: AT });
    expect(r.replies).toHaveLength(1);
    expect(r.replies[0]!.stock).toBe("yes");
    const n = run(S0(), { type: "MARK_CONTACTED", at: AT }, { type: "MARK_NO_RESPONSE", at: AT }, { type: "MARK_NO_RESPONSE", at: AT });
    expect(n.status).toBe("NO_RESPONSE");
  });
  it("a late reply after NO_RESPONSE is accepted; a copy never regresses a contacted inquiry", () => {
    const n = run(S0(), { type: "MARK_CONTACTED", at: AT }, { type: "MARK_NO_RESPONSE", at: AT });
    expect(run(n, { type: "ENTER_REPLY", reply: user("late", { stock: "yes" }), at: AT }).status).toBe("USER_REPORTED_AVAILABLE");
    expect(run(S0(), { type: "MARK_CONTACTED", at: AT }, { type: "COPY", at: AT }).status).toBe("USER_MARKED_CONTACTED");
    expect(run(n, { type: "MARK_CONTACTED", at: AT }).status).toBe("USER_MARKED_CONTACTED"); // retry after no response
  });
  it("DEMO evidence can never enter a manual inquiry", () => {
    const demo = { ...user("d", { stock: "yes" }), provenance: "DEMO_SIMULATED" } as unknown as ReplyEvidence;
    const s = run(S0(), { type: "ENTER_REPLY", reply: demo, at: AT });
    expect(s.replies).toHaveLength(0);
    expect(s.status).toBe("DRAFT");
  });
  it("editing the draft after a copy returns to DRAFT (the old copy is outdated) but not after contact", () => {
    expect(run(S0(), { type: "COPY", at: AT }, { type: "EDIT_DRAFT", text: "x", at: AT }).status).toBe("DRAFT");
    expect(run(S0(), { type: "MARK_CONTACTED", at: AT }, { type: "EDIT_DRAFT", text: "x", at: AT }).status).toBe("USER_MARKED_CONTACTED");
  });
  it("cancel → only REOPEN works and restores the previous status; RESET clears everything", () => {
    const c = run(S0(), { type: "COPY", at: AT }, { type: "CANCEL", at: AT });
    expect(c.status).toBe("CANCELLED");
    expect(run(c, { type: "COPY", at: AT }).status).toBe("CANCELLED");
    expect(run(c, { type: "REOPEN", at: AT }).status).toBe("COPIED");
    expect(inquiryReducer(c, { type: "RESET", at: AT }, ["q_stock"])).toEqual(initialInquiryState(["q_stock"]));
  });
  it("next-action selection is reversible-by-new-reply and not allowed on a bare draft", () => {
    expect(run(S0(), { type: "SELECT_NEXT_ACTION", action: "FIND_OTHER_SELLER", at: AT }).status).toBe("DRAFT");
    const s = run(S0(), { type: "ENTER_REPLY", reply: user("a", { stock: "no" }), at: AT }, { type: "SELECT_NEXT_ACTION", action: "FIND_OTHER_SELLER", at: AT });
    expect(s).toMatchObject({ status: "NEXT_ACTION_SELECTED", nextAction: "FIND_OTHER_SELLER", previous: "USER_REPORTED_UNAVAILABLE" });
    expect(run(s, { type: "ENTER_REPLY", reply: user("b", { stock: "yes" }), at: AT }).status).toBe("USER_REPORTED_AVAILABLE");
  });
  it("text is sanitised and bounded; the event log is bounded", () => {
    const s = run(S0(), { type: "EDIT_DRAFT", text: `سلام‮<script>alert(1)</script>${"x".repeat(5000)}`, at: AT });
    expect(s.draftOverride).not.toContain("‮");
    expect(s.draftOverride!.length).toBeLessThanOrEqual(2500);
    let l = S0();
    for (let i = 0; i < 200; i++) l = inquiryReducer(l, { type: "EDIT_DRAFT", text: String(i), at: AT });
    expect(l.events.length).toBeLessThanOrEqual(60);
  });
  it("maps onto the Phase 1 mission machine without a parallel machine", () => {
    const m = { ...createMission("m"), intent: "x", candidates: ["p"], chosenVariant: {} as never, selectedSellers: ["shop_b"] };
    for (const [st, na, want] of [["DRAFT", null, "CONTACT_PREPARATION"], ["COPIED", null, "CONTACT_PREPARATION"], ["USER_REPORTED_AVAILABLE", null, "CONTACT_RESULT"], ["NO_RESPONSE", null, "CONTACT_RESULT"], ["NEXT_ACTION_SELECTED", "FIND_OTHER_SELLER", "DISCOVER_SELLERS"], ["NEXT_ACTION_SELECTED", "RECONFIRM_BEFORE_VISIT", "VISIT_PLAN"], ["NEXT_ACTION_SELECTED", "COMPARE_AGAIN", "COMPARE_SELLERS"]] as const) {
      const to = missionStateFor(st, na);
      expect(to).toBe(want);
      expect(transition(m, to).ok).toBe(true); // every mapped state is reachable with a seller selected
    }
  });
});

describe("amount interpretation (toman vs rial is never guessed)", () => {
  const rec = 4_100_000;
  it("explicit units", () => {
    expect(interpretAmount("۴٬۲۰۰٬۰۰۰ تومان", rec)).toMatchObject({ kind: "ok", toman: 4_200_000, basis: "explicit_toman" });
    expect(interpretAmount("42,000,000 ریال", rec)).toMatchObject({ kind: "ok", toman: 4_200_000, basis: "explicit_rial" });
    expect(interpretAmount("۴ میلیون و ...", rec).kind).toBe("invalid");
    expect(interpretAmount("4.2 میلیون تومان", rec)).toMatchObject({ kind: "ok", toman: 4_200_000 });
    expect(interpretAmount("۴۲۰ هزار تومان", null)).toMatchObject({ kind: "ok", toman: 420_000 });
  });
  it("bare numbers are AMBIGUOUS (with a hint), and the user's explicit choice resolves them", () => {
    const a = interpretAmount("4200000", rec);
    expect(a.kind).toBe("ambiguous");
    expect((a as { hintFa: string }).hintFa).toContain("تومان");
    expect((interpretAmount("42000000", rec) as { hintFa: string }).hintFa).toContain("ریال");
    expect(interpretAmount("4200000", rec, "toman")).toMatchObject({ kind: "ok", toman: 4_200_000, basis: "user_chose_toman" });
    expect(interpretAmount("42000000", rec, "rial")).toMatchObject({ kind: "ok", toman: 4_200_000, basis: "user_chose_rial" });
  });
  it("«۴ میلیون» without a unit is accepted as toman only when plausible vs the recorded price, and flagged as assumed", () => {
    expect(interpretAmount("۴ میلیون", rec)).toMatchObject({ kind: "ok", toman: 4_000_000, basis: "multiplier_assumed_toman", assumed: true });
    expect(interpretAmount("۴ میلیون", null).kind).toBe("ambiguous");
    expect(interpretAmount("۴۰۰ میلیون", rec).kind).toBe("ambiguous"); // 100× the recorded price: ask
  });
  it("invalid / unsafe / absurd inputs", () => {
    for (const bad of ["", "abc", "-5 تومان", "0 تومان", "۱۲۳ تومان تومان"]) expect(interpretAmount(bad, rec).kind, bad).toBe("invalid");
    expect(interpretAmount("99999999999999999999 تومان", rec)).toMatchObject({ kind: "invalid" });
    expect(interpretAmount("۱۰۰۰۰۰۰۰۰۰۰۰۰۰۰ تومان", rec)).toMatchObject({ kind: "invalid", reason: "too_large" });
  });
  it("price comparison: only with a recorded price; never overwrites; percentage rounded to 0.1", () => {
    expect(comparePrices(4_100_000, 4_592_000)).toMatchObject({ direction: "higher", deltaToman: 492_000, pct: 12 });
    expect(comparePrices(4_100_000, 3_813_000)).toMatchObject({ direction: "lower", pct: -7 });
    expect(comparePrices(4_100_000, 4_100_000)?.direction).toBe("same");
    expect(comparePrices(null, 5)).toBeNull();
    expect(comparePrices(0, 5)).toBeNull();
    expect(comparePrices(5, null)).toBeNull();
  });
});

describe("pasted text → suggestions only", () => {
  it("suggests (never applies) stock, model difference and an amount", () => {
    expect(suggestFromText("متأسفانه موجود نیست")).toMatchObject({ stock: "no" });
    expect(suggestFromText("بله موجود است، ۴٬۵۹۲٬۰۰۰ تومان")).toMatchObject({ stock: "yes", amountText: "۴٬۵۹۲٬۰۰۰ تومان" });
    expect(suggestFromText("مدل دیگری داریم").modelDifferent).toBe(true);
    expect(suggestFromText("موجود هست ولی موجود نیست؟").stock).toBeNull(); // conflicting cues → no suggestion
    expect(suggestFromText("سلام").stock).toBeNull();
  });
  it("sanitiser strips control/bidi/zero-width characters and bounds length; injection-shaped text stays plain data", () => {
    expect(sanitizeText("a\u0000b‮c​d", 50)).toBe("abcd");
    expect(sanitizeText("x".repeat(10_000), 100)).toHaveLength(100);
    expect(sanitizeText("<img src=x onerror=alert(1)>", 100)).toBe("<img src=x onerror=alert(1)>"); // kept as TEXT; React escapes it
    expect(sanitizeText(42, 10)).toBe("");
    expect(sanitizeText("می‌خواهم", 20)).toContain("‌"); // ZWNJ is Persian, kept
  });
});

describe("category-aware questions and message composition", () => {
  it("category profiles only for known categories", () => {
    expect(categoryProfile("دوربین مدار بسته")).toBe("cctv");
    expect(categoryProfile("هدفون، هدست و هندزفری")).toBe("headphones");
    expect(categoryProfile("ژنراتور و موتور برق")).toBe("generator");
    expect(categoryProfile("کابل و سیم برق")).toBe("cable");
    expect(categoryProfile("کفش مردانه")).toBe("footwear");
    expect(categoryProfile("لوستر")).toBe("generic");
    expect(categoryProfile("سیم کارت")).toBe("generic");
  });
  it("generic categories get NO invented product-specific questions", () => {
    const q = buildQuestions(ctxOf({}, { category: "generic" }));
    expect(q.some((x) => x.intent === "category")).toBe(false);
  });
  it("smart defaults follow the real facts: exact variant OFF for an exact-key offer, ON otherwise", () => {
    const get = (c: InquiryContext, id: string) => buildQuestions(c).find((q) => q.id === id)!;
    expect(get(ctxOf({ tier: "A" }), "q_variant").defaultOn).toBe(false);
    expect(get(ctxOf({ tier: "B" }), "q_variant").defaultOn).toBe(true);
    expect(get(ctxOf({ tier: "A", outsideSelectedVariant: true }), "q_variant").defaultOn).toBe(true);
    expect(get(ctxOf(), "q_stock").defaultOn).toBe(true);
    expect(get(ctxOf(), "q_price").defaultOn).toBe(true);
    expect(get(ctxOf({ warranty: { kind: "MONTHS", months: 12, provider: "شرکتی", description: null, labelFa: "گارانتی ۱۲ ماهه" } }), "q_warranty").defaultOn).toBe(false);
    expect(get(ctxOf(), "q_warranty").defaultOn).toBe(true);
    expect(get(ctxOf({}, { payment: { declared: true, providers: [{ name: "ترب‌پی", channel: "in_person" }], bucket: "IN_PERSON_DECLARED", labelFa: "حضوری" } }), "q_install").defaultOn).toBe(false);
    expect(get(ctxOf({}, { shop: { ...ctxOf().shop, sharedCoordinates: 0, address: "خیابان آزادی" } }), "q_locate").defaultOn).toBe(false);
    expect(get(ctxOf(), "q_locate").defaultOn).toBe(true);
  });
  it("category question is ON only for the first pertinent item; cable asks the price UNIT", () => {
    const cable = buildQuestions(ctxOf({}, { category: "cable" })).filter((q) => q.intent === "category");
    expect(cable.map((q) => q.defaultOn)).toEqual([true, false]);
    expect(cable[0]!.textFa).toContain("هر متر");
    expect(buildQuestions(ctxOf()).filter((q) => q.intent === "category")[0]!.textFa).toContain("دید در شب");
  });
  it("the composed message is deterministic, contains recorded facts, NO phone/URL and never claims it was sent", () => {
    const c = ctxOf();
    const qs = buildQuestions(c).filter((q) => q.defaultOn);
    const t = composeInquiry(c, qs);
    expect(composeInquiry(c, qs)).toBe(t);
    expect(t).toContain("«دوربین داهوا HDW1200CLQP-IL-A»");
    expect(t).toContain("۴٬۱۰۰٬۰۰۰ تومان");
    expect(t).toContain("ثبت‌شده در ۱۹ مهر ۱۴۰۵");
    expect(t).not.toMatch(/\b09\d{9}\b|https?:|tel:|ارسال شد|ارسال شده/);
    expect(composeFollowUp(c)).toContain("دوباره مزاحم");
    expect(defaultQuestionIds(buildQuestions(c))).toContain("q_stock");
  });
  it("a price-less offer asks for the price instead of quoting one", () => {
    const t = composeInquiry(ctxOf({ priceToman: null, recordedAtLabel: null }), buildQuestions(ctxOf({ priceToman: null, recordedAtLabel: null })).filter((q) => q.id === "q_price"));
    expect(t).toContain("قیمتی برای این کالا ثبت نشده");
    expect(t).not.toContain("تومان بوده");
  });
});

describe("demo scenarios (fiction, deterministic, isolated)", () => {
  const c = ctxOf();
  it("six scenarios; every message and reply is tagged DEMO_SIMULATED; no wall-clock", () => {
    expect(DEMO_SCENARIOS.map((s) => s.id)).toEqual(["AVAILABLE", "NOT_AVAILABLE", "PRICE_CHANGED", "VARIANT_DIFFERENT", "WARRANTY_OR_PAYMENT_CHANGED", "NO_RESPONSE"]);
    for (const s of DEMO_SCENARIOS) {
      const r = runDemoScenario(c, s.id, "سلام");
      expect(r.messages.every((m) => m.provenance === "DEMO_SIMULATED" && m.tagFa.includes("واقعی نیست"))).toBe(true);
      if (r.reply) { expect(r.reply.provenance).toBe("DEMO_SIMULATED"); expect(r.reply.receivedLabel).toBe("پاسخ نمونه‌ی شبیه‌سازی‌شده"); expect(r.reply.scenarioId).toBe(s.id); }
      expect(JSON.stringify(r)).not.toMatch(/\d{4}-\d{2}-\d{2}T|دریافت شد|تحویل داده شد|delivered|✓✓/);
    }
    expect(runDemoScenario(c, "NO_RESPONSE", "x").reply).toBeNull();
  });
  it("deterministic per offer, different across offers; same input twice → identical", () => {
    expect(JSON.stringify(runDemoScenario(c, "PRICE_CHANGED", "x"))).toBe(JSON.stringify(runDemoScenario(c, "PRICE_CHANGED", "x")));
    expect(seedOf("a")).not.toBe(seedOf("b"));
    const other = runDemoScenario(ctxOf({ id: "offer_dddddddd" }), "PRICE_CHANGED", "x").reply!.reportedPriceToman;
    expect(typeof other).toBe("number");
  });
  it("price-changed differs from the recorded price; variant-different names a different model; available keeps the recorded price", () => {
    const pc = runDemoScenario(c, "PRICE_CHANGED", "x").reply!;
    expect(pc.reportedPriceToman).not.toBe(c.offer.priceToman);
    expect(runDemoScenario(c, "VARIANT_DIFFERENT", "x").reply).toMatchObject({ model: "different" });
    expect(runDemoScenario(c, "VARIANT_DIFFERENT", "x").messages[1]!.textFa).toContain(altModelKey("HDW1200CLQP")!);
    expect(altModelKey(null)).toBeNull();
    expect(runDemoScenario(c, "AVAILABLE", "x").reply).toMatchObject({ stock: "yes", reportedPriceToman: 4_100_000 });
  });
  it("never mutates the context (the real offer price/time stay as recorded)", () => {
    const snap = JSON.stringify(c);
    for (const s of DEMO_SCENARIOS) runDemoScenario(c, s.id, "x");
    expect(JSON.stringify(c)).toBe(snap);
  });
});

describe("outcome and next actions", () => {
  const st = (replies: ReplyEvidence[], status: InquiryState["status"]) => ({ status, replies, nextAction: null });
  it("no reply → await; nothing is claimed about stock or today's price", () => {
    const o = deriveOutcome(ctxOf(), st([], "COPIED"), "MANUAL");
    expect(o.nextActions[0]!.id).toBe("AWAIT_REPLY");
    expect(o.claimFa).toContain("نامعلوم");
    expect(o.missionEvidence).toBeNull();
  });
  it("reported unavailable → find another seller (keeps the product/variant route) + alternative product; no invented stock", () => {
    const o = deriveOutcome(ctxOf(), st([user("a", { stock: "no" })], "USER_REPORTED_UNAVAILABLE"), "MANUAL");
    expect(o.nextActions.map((a) => a.id)).toEqual(expect.arrayContaining(["FIND_OTHER_SELLER", "ALTERNATIVE_PRODUCT"]));
    expect(o.nextActions.find((a) => a.id === "FIND_OTHER_SELLER")!.href).toBe("/sellers?product=product_aaaaaaaa");
    expect(o.headlineFa).toContain("طبق گزارش شما");
  });
  it("reported available → «reported», re-confirm before visiting; never «تأیید شد»", () => {
    const o = deriveOutcome(ctxOf(), st([user("a", { stock: "yes", model: "same" })], "USER_REPORTED_AVAILABLE"), "MANUAL");
    expect(o.nextActions.some((a) => a.id === "RECONFIRM_BEFORE_VISIT")).toBe(true);
    expect(o.claimFa).toContain("ادعای فروشنده");
    expect(o.headlineFa + o.claimFa).not.toMatch(/(?<!«)موجودی تأیید شد(?!»)/); // only ever quoted as what it is NOT
  });
  it("a reply with unknown stock, no price and a same model still yields a defined, primary next action (no undefined entries)", () => {
    const o = deriveOutcome(ctxOf(), st([user("a", { stock: "unknown", model: "not_asked" })], "USER_ENTERED_REPLY"), "MANUAL");
    expect(o.nextActions.length).toBeGreaterThan(0);
    expect(o.nextActions.every((a) => a && a.labelFa && a.id)).toBe(true);
    expect(o.nextActions.filter((a) => a.primary)).toHaveLength(1);
  });
  it("reported price: compare against the recorded one, offer re-compare, never feed ranking", () => {
    const o = deriveOutcome(ctxOf(), st([user("a", { stock: "yes", reportedPriceToman: 4_592_000, model: "same" })], "USER_REPORTED_AVAILABLE"), "MANUAL");
    expect(o.priceDelta).toMatchObject({ direction: "higher", pct: 12, deltaToman: 492_000 });
    expect(o.flags).toContain("PRICE_HIGHER");
    expect(o.nextActions.some((a) => a.id === "COMPARE_AGAIN")).toBe(true);
    expect(o.affectsCanonicalRanking).toBe(false);
    expect(o.claimFa).toContain("بالاتر");
  });
  it("different model or unit blocks exact confirmation and asks for clarification", () => {
    const o = deriveOutcome(ctxOf(), st([user("a", { stock: "yes", model: "different" })], "USER_REPORTED_AVAILABLE"), "MANUAL");
    expect(o.blocksExactConfirmation).toBe(true);
    expect(o.nextActions[0]!.id).toBe("CLARIFY_VARIANT");
    expect(o.nextActions.some((a) => a.id === "RECONFIRM_BEFORE_VISIT")).toBe(false);
    const u = deriveOutcome(ctxOf({ unitHint: "per_metre" }), st([user("a", { stock: "yes", model: "same", reportedUnit: "roll_or_pack" })], "USER_REPORTED_AVAILABLE"), "MANUAL");
    expect(u.flags).toContain("UNIT_DIFFERENT");
    expect(u.blocksExactConfirmation).toBe(true);
  });
  it("warranty / payment mismatch vs the recorded data", () => {
    const withW = ctxOf({ warranty: { kind: "MONTHS", months: 12, provider: "شرکتی", description: null, labelFa: "۱۲ ماه" } }, { payment: { declared: true, providers: [{ name: "ترب‌پی", channel: "in_person" }], bucket: "IN_PERSON_DECLARED", labelFa: "حضوری" } });
    const o = deriveOutcome(withW, st([user("a", { stock: "yes", model: "same", warranty: { report: "none", months: null }, payment: "not_available" })], "USER_REPORTED_AVAILABLE"), "MANUAL");
    expect(o.flags).toEqual(expect.arrayContaining(["WARRANTY_MISMATCH", "PAYMENT_NOT_AVAILABLE"]));
    const mm = deriveOutcome(withW, st([user("a", { stock: "yes", model: "same", warranty: { report: "declared", months: 6 } })], "USER_REPORTED_AVAILABLE"), "MANUAL");
    expect(mm.flags).toContain("WARRANTY_MISMATCH");
  });
  it("no response → follow-up and other sellers; hours outside the declared window adds a visit-time action", () => {
    const o = deriveOutcome(ctxOf({}, { hours: { ...ctxOf().hours, state: "OUTSIDE_DECLARED" } }), st([], "NO_RESPONSE"), "MANUAL");
    expect(o.nextActions.map((a) => a.id)).toEqual(expect.arrayContaining(["FOLLOW_UP", "FIND_OTHER_SELLER", "CHECK_VISIT_HOURS"]));
    expect(o.headlineFa).toBe("پاسخی نیامده");
  });
  it("choosing «follow-up» after NO_RESPONSE keeps the no-response recovery options (status NEXT_ACTION_SELECTED)", () => {
    const o = deriveOutcome(ctxOf(), { status: "NEXT_ACTION_SELECTED", replies: [], nextAction: "FOLLOW_UP", previous: "NO_RESPONSE" }, "MANUAL");
    expect(o.headlineFa).toBe("پاسخی نیامده");
    expect(o.nextActions.map((a) => a.id)).toEqual(expect.arrayContaining(["FOLLOW_UP", "FIND_OTHER_SELLER"]));
  });
  it("DEMO outcomes are labelled and NEVER exportable as mission evidence; MANUAL ones are exportable and unverified", () => {
    const d = deriveOutcome(ctxOf(), st([{ ...user("d", { stock: "yes" }), provenance: "DEMO_SIMULATED" }], "USER_REPORTED_AVAILABLE"), "DEMO");
    expect(d.provenance).toBe("DEMO_SIMULATED");
    expect(d.missionEvidence).toBeNull();
    expect(d.headlineFa).toContain("فقط دمو");
    const m = deriveOutcome(ctxOf(), st([user("a", { stock: "yes", reportedPriceToman: 4_200_000 })], "USER_REPORTED_AVAILABLE"), "MANUAL");
    expect(m.missionEvidence).toMatchObject({ kind: "USER_REPORTED_SELLER_REPLY", verified: false, recordedPriceToman: 4_100_000, reportedPriceToman: 4_200_000, shopId: "shop_bbbbbbbb", offerId: "offer_cccccccc" });
    expect(m.provenance).toBe("USER_REPORTED");
  });
});
