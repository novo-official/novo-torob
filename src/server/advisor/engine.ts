import type { DatabaseSync } from "node:sqlite";
import type {
  AdvisorQuestion, AdvisorResponse, BudgetBand, Candidate, Evidence, ProductIntent, Recovery, RecommendationReason,
} from "@/domain/advisor";
import { toCard, variantSignals } from "@/server/catalog/rows";
import { analyzeQuery } from "@/server/search/analyze";
import { getVocabulary } from "@/server/search/vocab";
import { normalizeSearchText } from "@/server/domain/text";
import { categoryProductCount, getCategoryData, type CategoryData, type Prepared } from "./category-data";
import { resolveCategory, supportedChoices } from "./resolve-category";
import type { QuestionDef, Test } from "./schemas";

export const ADVISOR_LIMITS = { pageMax: 24, defaultPage: 12, textMax: 200, answersMax: 12 } as const;

export interface AdviseInput {
  text?: string;
  category?: string | null;
  answers?: Record<string, string>;
  skipped?: string[];
  budget?: { min?: number | null; max?: number | null };
  brands?: string[];
  /** user pressed "show results now" even though initial questions remain */
  show?: boolean;
  /** re-open one specific question (to change an earlier answer) while keeping everything else */
  ask?: string;
  limit?: number;
  offset?: number;
}

/** Scoring weights (documented in docs/phase-3-advisor.md). */
export const W = {
  hardMatch: 30, softMatch: 15, inferredFactor: 0.7,
  hardUnknown: -12, softUnknown: -4, softMismatch: -10, inferredHardMismatch: -15,
  budgetFit: 20, budgetUnverified: -10,
  text: 20, brand: 10, coverage: 5, sellers: 3, reliablePrice: 1, stale: -2,
} as const;

const clipText = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

export function normalizeIntent(input: AdviseInput): ProductIntent {
  const toNum = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.answers ?? {}).slice(0, ADVISOR_LIMITS.answersMax)) answers[clipText(k, 40)] = clipText(v, 40);
  return {
    text: clipText(input.text, ADVISOR_LIMITS.textMax),
    category: input.category ? clipText(input.category, 120) : null,
    answers,
    skipped: (input.skipped ?? []).slice(0, ADVISOR_LIMITS.answersMax).map((s) => clipText(s, 40)),
    budget: { min: toNum(input.budget?.min), max: toNum(input.budget?.max) },
    brands: (input.brands ?? []).slice(0, 4).map((b) => clipText(b, 40)).filter(Boolean),
  };
}

const BUDGET_Q = (bands: BudgetBand[]): AdvisorQuestion => ({
  id: "budget", text: "بودجه‌تان چقدر است؟", help: "بازه‌ها از قیمت‌های قابل مقایسه‌ی همین دسته ساخته شده‌اند. می‌توانید عدد دلخواه بنویسید.", kind: "budget", hardness: "hard", stage: "initial",
  options: bands.map((b) => ({ id: b.id, label: b.label, evidenceCount: b.count })),
});

const toQuestion = (qd: QuestionDef, data: CategoryData): AdvisorQuestion => ({
  id: qd.id, text: qd.text, help: qd.help, kind: qd.kind, hardness: qd.hardness, stage: qd.stage,
  options: qd.options
    .map((o) => ({ id: o.id, label: o.label, hint: o.hint, evidenceCount: data.optionCounts[qd.id]?.[o.id] ?? 0 }))
    // an option that matches no product in the catalog would be a dead end: hide it ("any/skip" style options stay)
    .filter((o) => o.id === "any" || (o.evidenceCount ?? 0) > 0),
});

interface Evaluated {
  qd: QuestionDef;
  option: QuestionDef["options"][number];
  test: Test;
}

function evaluate(item: Prepared, answered: Array<{ qd: QuestionDef; option: QuestionDef["options"][number] }>): Evaluated[] {
  return answered.map(({ qd, option }) => ({ qd, option, test: option.test(item.attrs) }));
}

const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(Math.round(n));

function attrEvidence(item: Prepared, qd: QuestionDef): Evidence[] {
  return item.attrs[qd.attribute]?.evidence.slice(0, 2) ?? [];
}

type BudgetState = Candidate["budget"];
function budgetState(item: Prepared, b: ProductIntent["budget"], lowCut: number | null = null): BudgetState {
  if (b.min === null && b.max === null) return "none";
  const e = item.row.ev;
  if (e.status !== "reliable" || e.min === null || e.max === null) return "unverified";
  if (lowCut !== null && e.max < lowCut) return "unverified"; // implausibly cheap for this category: cannot be trusted against a budget
  if (b.max !== null && e.min > b.max) return "over_budget";
  if (b.min !== null && e.max < b.min) return "under_budget";
  return "in_budget";
}

interface Scored {
  item: Prepared;
  score: number;
  reasons: RecommendationReason[];
  cautions: string[];
  budget: BudgetState;
}

function textCoverage(intentText: string, db: DatabaseSync, item: Prepared, categoryTokens: Set<string>): number {
  if (!intentText) return 0;
  const q = analyzeQuery(intentText, getVocabulary(db));
  // a group that merely restates the category (in ANY spelling: «مداربسته» / «مدار بسته») carries no extra signal
  const groups = q.groups.filter((g) => !g.forms.some((f) => f.split(" ").every((w) => categoryTokens.has(w))));
  if (!groups.length) return 0;
  const hay = ` ${item.haystack} `;
  return groups.filter((g) => g.forms.some((f) => hay.includes(` ${f}`))).length / groups.length;
}

export function adviseProducts(db: DatabaseSync, raw: AdviseInput): AdvisorResponse {
  const intent = normalizeIntent(raw);
  const limit = Math.min(Math.max(Math.trunc(raw.limit ?? ADVISOR_LIMITS.defaultPage), 1), ADVISOR_LIMITS.pageMax);
  const offset = Math.min(Math.max(Math.trunc(raw.offset ?? 0), 0), 200);
  const empty = (): Omit<AdvisorResponse, "stage" | "progress"> => ({
    intent, category: null, categoryChoices: [], question: null, budgetBands: [], candidates: [], funnel: null, answered: [], refinement: [], recovery: null, limitations: [], hasMore: false,
  });

  // ---------- 1) category ----------
  let category = intent.category && categoryProductCount(db, intent.category) > 0 ? intent.category : null;
  let autoSelected = false;
  let categoryChoices = [] as AdvisorResponse["categoryChoices"];
  let recovery: Recovery | null = null;
  if (!category && intent.text) {
    const r = resolveCategory(db, intent.text);
    if (r.auto) { category = r.auto; autoSelected = true; }
    else {
      categoryChoices = r.choices;
      const msg = r.reason === "invalid" ? "عبارت خیلی کلی است. بنویسید چه کالایی می‌خواهید (مثلاً «هدفون بی‌سیم») یا یکی از دسته‌های زیر را بزنید."
        : r.reason === "none" ? "در کاتالوگ چیزی نزدیک به این عبارت پیدا نشد؛ ممکن است این گروه کالا در داده‌ی انتخابی نباشد. یکی از دسته‌های زیر را امتحان کنید."
        : "این عبارت به چند دسته می‌خورد؛ کدام را می‌خواهید؟";
      return { ...empty(), stage: r.reason === "ambiguous" ? "clarify_category" : "need", progress: { current: 1, total: 4 }, categoryChoices, recovery: { message: msg, suggestions: [] } };
    }
  }
  if (!category) {
    return { ...empty(), stage: "need", progress: { current: 1, total: 4 }, categoryChoices: supportedChoices(db) };
  }

  // ---------- 2) category data ----------
  const data = getCategoryData(db, category);
  const schema = data.schema;
  const initial = (schema?.questions ?? []).filter((x) => x.stage === "initial");
  const isAnswered = (id: string) => id in intent.answers || intent.skipped.includes(id);
  const budgetAnswered = intent.budget.min !== null || intent.budget.max !== null || intent.skipped.includes("budget");
  const steps = 1 + initial.length + 1;
  const categoryInfo = { category, label: schema?.label ?? category, supported: !!schema, productCount: data.items.length, autoSelected };

  const askDef = raw.ask ? (schema?.questions ?? []).find((x) => x.id === raw.ask) : undefined;
  if (raw.ask && (askDef || raw.ask === "budget")) {
    const q = askDef ? toQuestion(askDef, data) : BUDGET_Q(data.bands);
    return { ...empty(), stage: "question", progress: { current: steps, total: steps }, category: categoryInfo, question: q, budgetBands: data.bands, limitations: schema?.limitations ?? [] };
  }

  const nextInitial = initial.find((x) => !isAnswered(x.id));
  if (!raw.show && (nextInitial || !budgetAnswered)) {
    const done = initial.filter((x) => isAnswered(x.id)).length;
    const q = nextInitial ? toQuestion(nextInitial, data) : BUDGET_Q(data.bands);
    return { ...empty(), stage: "question", progress: { current: Math.min(steps, 2 + done), total: steps }, category: categoryInfo, question: q, budgetBands: data.bands, limitations: schema?.limitations ?? [] };
  }

  // ---------- 3) results ----------
  const answered = (schema?.questions ?? [])
    .filter((qd) => qd.id in intent.answers && intent.answers[qd.id] !== "any")
    .map((qd) => ({ qd, option: qd.options.find((o) => o.id === intent.answers[qd.id]) }))
    .filter((x): x is { qd: QuestionDef; option: QuestionDef["options"][number] } => !!x.option);

  const categoryTokens = new Set(normalizeSearchText(category).split(" "));
  const funnel = { inCategory: data.items.length, afterHardFilters: 0, outOfBudget: 0, budgetUnverified: 0 };
  const scored: Scored[] = [];
  const wantsBrand = intent.brands.map(normalizeSearchText).filter(Boolean);

  for (const item of data.items) {
    let score = 0;
    const reasons: RecommendationReason[] = [];
    const cautions: string[] = [];
    let excluded = false;

    for (const ev of evaluate(item, answered)) {
      const hard = ev.qd.hardness === "hard";
      const label = ev.option.label;
      const evidence = attrEvidence(item, ev.qd);
      if (ev.test.effect === "match") {
        const base = hard ? W.hardMatch : W.softMatch;
        const inferred = ev.test.confidence === "inferred";
        score += inferred ? base * W.inferredFactor : base;
        reasons.push({ code: inferred ? "ATTR_MATCH_INFERRED" : "ATTR_MATCH", effect: "match", text: `${inferred ? "با برداشت از مشخصات، " : ""}هم‌خوان با انتخاب شما: «${label}»`, evidence });
        if (inferred) cautions.push(`«${schema!.attributeLabels[ev.qd.attribute] ?? ev.qd.attribute}» از نوع محصول استنباط شده و در مشخصات صریح نیست.`);
      } else if (ev.test.effect === "mismatch") {
        if (hard && ev.test.confidence === "explicit") { excluded = true; break; }
        score += hard ? W.inferredHardMismatch : ev.test.confidence === "inferred" ? W.softMismatch / 2 : W.softMismatch;
        reasons.push({ code: "ATTR_MISMATCH", effect: "mismatch", text: `با انتخاب شما «${label}» کامل نمی‌خواند${ev.test.confidence === "inferred" ? " (برداشت از نوع محصول)" : ""}`, evidence });
      } else {
        score += hard ? W.hardUnknown : W.softUnknown;
        const conflict = item.attrs[ev.qd.attribute]?.conflict;
        reasons.push({ code: "ATTR_UNKNOWN", effect: "unknown", text: conflict ? `نمی‌توان تأیید کرد: ${conflict}` : `برای «${ev.qd.text.replace(/[؟?]$/, "")}» در داده شاهدی ثبت نشده`, evidence });
      }
    }
    if (excluded) continue;

    // budget: hard when the price evidence is reliable, otherwise unverifiable (kept, ranked lower)
    const bs = budgetState(item, intent.budget, data.lowCut);
    if (bs === "over_budget" || bs === "under_budget") { funnel.outOfBudget++; continue; }
    if (bs === "in_budget") {
      score += W.budgetFit;
      const e = item.row.ev;
      reasons.push({ code: "BUDGET_FIT", effect: "match", text: `قیمت‌های قابل مقایسه (${fa(e.min!)} تا ${fa(e.max!)} تومان) با بودجه‌ی شما هم‌پوشانی دارند`, evidence: [{ kind: "price", label: "قیمت ثبت‌شده", text: `${fa(e.min!)} – ${fa(e.max!)} تومان (${e.reliableCount} پیشنهاد قابل مقایسه)`, confidence: "explicit" }] });
    } else if (bs === "unverified") {
      funnel.budgetUnverified++;
      score += W.budgetUnverified;
      const cheap = item.row.ev.status === "reliable" && data.lowCut !== null && (item.row.ev.max ?? Infinity) < data.lowCut;
      reasons.push({ code: "BUDGET_UNVERIFIED", effect: "unknown", text: cheap ? "قیمت ثبت‌شده بسیار پایین‌تر از معمول این دسته است و برای بررسی بودجه قابل اتکا نیست" : "قیمت قابل اتکا برای بررسی بودجه موجود نیست", evidence: [] });
      if (cheap) cautions.push("قیمت ثبت‌شده بسیار پایین‌تر از قیمت‌های معمول این دسته است؛ ممکن است قطعه‌ی جانبی یا ثبت اشتباه باشد.");
    }

    const tc = textCoverage(intent.text, db, item, categoryTokens);
    if (tc > 0) {
      score += W.text * tc;
      reasons.push({ code: "TEXT_MATCH", effect: "match", text: `کلمه‌های توضیح شما در عنوان یا مشخصات دیده می‌شود`, evidence: [{ kind: "title", label: "عنوان", text: item.row.title.slice(0, 80), confidence: "explicit" }] });
    }
    if (wantsBrand.length && wantsBrand.some((b) => item.haystack.includes(b))) {
      score += W.brand;
      reasons.push({ code: "BRAND_MATCH", effect: "match", text: "برند مورد نظر شما", evidence: [{ kind: "title", label: "برند/عنوان", text: (item.row.brandName ?? item.row.title).slice(0, 60), confidence: "explicit" }] });
    }
    // missing-evidence signal and weak secondary signals
    const attrIds = schema ? Object.keys(schema.attributeLabels) : [];
    if (attrIds.length) {
      const known = attrIds.filter((id) => item.attrs[id]?.confidence !== "unknown").length;
      score += W.coverage * (known / attrIds.length);
      reasons.push({ code: "SPEC_COVERAGE", effect: "info", text: `${fa(known)} از ${fa(attrIds.length)} مشخصه‌ی کلیدی این دسته در داده ثبت شده`, evidence: [] });
    }
    score += W.sellers * Math.min(1, Math.log2(1 + item.row.ev.distinctSellers) / 4) + (item.row.ev.status === "reliable" ? W.reliablePrice : 0);
    if ((item.row.ev.staleShare ?? 0) >= 0.8 && item.row.ev.status === "reliable") {
      score += W.stale;
      cautions.push("بیشتر قیمت‌های ثبت‌شده قدیمی‌اند؛ قیمت روز را بپرسید.");
    }
    if (item.row.ev.status !== "reliable") cautions.push(item.row.ev.status === "no_price" ? "قیمتی برای این محصول ثبت نشده است." : "قیمت قابل اتکا برای این محصول موجود نیست.");
    for (const a of Object.values(item.attrs)) if (a.conflict && !cautions.includes(a.conflict)) cautions.push(a.conflict);
    scored.push({ item, score: +score.toFixed(2), reasons, cautions, budget: bs });
  }
  funnel.afterHardFilters = scored.length;
  // with a budget, products whose price is VERIFIED inside it come first; unverifiable ones follow (never above verified ones)
  const tier = (x: Scored) => (x.budget === "in_budget" || x.budget === "none" ? 0 : 1);
  scored.sort((a, b) => tier(a) - tier(b) || b.score - a.score || b.item.row.ev.distinctSellers - a.item.row.ev.distinctSellers || a.item.row.id.localeCompare(b.item.row.id));

  const page = scored.slice(offset, offset + limit);
  const candidates: Candidate[] = page.map((s, i) => {
    const sig = variantSignals(db, s.item.row.id);
    const cautions = [...s.cautions];
    if (sig.modelMismatch) cautions.push(`${fa(sig.modelMismatch)} پیشنهاد کد مدل شبیه‌ولی‌متفاوت دارند؛ ممکن است نسخه‌ی دیگری باشند.`);
    if (sig.unitAmbiguous) cautions.push("واحد قیمت پیشنهادها یکسان نیست (مثلاً متری و حلقه‌ای).");
    cautions.push("وجود پیشنهاد به معنی موجودی نیست؛ موجودی را از فروشنده بپرسید.");
    return { rank: offset + i + 1, score: s.score, card: toCard(s.item.row, sig), reasons: s.reasons, cautions, budget: s.budget };
  });

  // ---------- 4) recovery when the list is empty or very short ----------
  // few results — or, with a budget, few products whose price can actually be VERIFIED inside it
  const budgetSet = intent.budget.min !== null || intent.budget.max !== null;
  const verified = budgetSet ? scored.filter((s) => s.budget === "in_budget").length : scored.length;
  if (scored.length < 3 || verified < 3) recovery = buildRecovery(db, data, intent, answered, verified);

  const refinement = (schema?.questions ?? [])
    .filter((qd) => !(qd.id in intent.answers))
    .map((qd) => toQuestion(qd, data))
    .filter((qq) => qq.options.length > 0);

  return {
    stage: "results", intent, progress: { current: steps, total: steps }, category: categoryInfo, categoryChoices: [], question: null, budgetBands: data.bands,
    candidates, funnel, refinement, recovery,
    answered: answered.map((a) => ({ questionId: a.qd.id, questionText: a.qd.text, optionLabel: a.option.label, hardness: a.qd.hardness })),
    limitations: [
      ...(schema?.limitations ?? ["برای این دسته پرسش‌های تخصصی تعریف نشده است؛ پیشنهادها فقط بر پایه‌ی دسته، توضیح شما، برند و بودجه‌اند."]),
      "هیچ امتیاز کیفیت، نظر کاربران یا محبوبیتی در داده نیست؛ ترتیب فقط نشان می‌دهد کدام محصول با ترجیحات شما بیشتر هم‌خوان است.",
      ...(data.excluded ? [`${fa(data.excluded)} مورد قطعه، لوازم جانبی یا عنوان حذف‌شده از فهرست کنار گذاشته شد.`] : []),
    ],
    hasMore: scored.length > offset + limit,
  };
}

/** Counterfactuals computed from the data: which single relaxation would bring products back? */
function buildRecovery(db: DatabaseSync, data: CategoryData, intent: ProductIntent, answered: Array<{ qd: QuestionDef; option: QuestionDef["options"][number] }>, current: number): Recovery {
  void db;
  const suggestions: Recovery["suggestions"] = [];
  const passes = (item: Prepared, skipQ?: string, skipBudget = false): boolean => {
    for (const a of answered) {
      if (a.qd.id === skipQ) continue;
      const t = a.option.test(item.attrs);
      if (a.qd.hardness === "hard" && t.effect === "mismatch" && t.confidence === "explicit") return false;
    }
    if (!skipBudget) {
      const b = budgetState(item, intent.budget, data.lowCut);
      if (b === "over_budget" || b === "under_budget") return false;
    }
    return true;
  };
  if (intent.budget.max !== null) {
    const pool = data.items.filter((i) => passes(i, undefined, true) && i.row.ev.status === "reliable" && i.row.ev.min !== null && (data.lowCut === null || (i.row.ev.max ?? 0) >= data.lowCut));
    const over = pool.filter((i) => i.row.ev.min! > intent.budget.max!).map((i) => i.row.ev.min!).sort((a, b) => a - b);
    if (over.length) {
      const target = over[Math.min(over.length - 1, 4)]!;
      const newMax = Math.ceil(target / 100000) * 100000; // round UP so the suggested ceiling really admits those products
      suggestions.push({ id: "raise-budget", label: `افزایش سقف بودجه تا حدود ${fa(newMax)} تومان (${fa(over.filter((x) => x <= newMax).length)} محصول بیشتر)`, patch: { budget: { min: intent.budget.min, max: newMax } } });
    }
  }
  for (const a of answered) {
    if (a.qd.hardness !== "hard") continue;
    const n = data.items.filter((i) => passes(i, a.qd.id)).length;
    if (n > current) suggestions.push({ id: `drop-${a.qd.id}`, label: `کنار گذاشتن شرط «${a.option.label}» (${fa(n)} محصول)`, patch: { dropAnswer: a.qd.id } });
  }
  const budgetSet = intent.budget.min !== null || intent.budget.max !== null;
  const base = current === 0 ? (budgetSet ? "محصولی با قیمت قابل اتکا در این بودجه پیدا نشد (محصول‌های بدون قیمت قابل اتکا فقط پایین فهرست می‌آیند)." : "با این ترکیب شرط‌ها محصولی پیدا نشد.") : "فقط تعداد کمی محصول با این ترکیب شرط‌ها پیدا شد.";
  return { message: `${base} این تغییرها را امتحان کنید:`, suggestions: suggestions.slice(0, 4) };
}
