import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  TOOL_NAMES, initialAgentState, type AgentAction, type AgentCard, type AgentControl, type AgentState, type ClarifyView, type ToolName, type ToolStatus,
} from "@/domain/agent";
import type { PriceSummary } from "@/domain/advisor";
import { deriveOutcome, type InquiryContext, type ReplyEvidence } from "@/domain/inquiry";
import { interpretAmount, sanitizeText, suggestFromText } from "@/domain/inquiry-parse";
import { buildQuestions, composeInquiry, defaultQuestionIds } from "@/domain/inquiry-questions";
import { buildCompareHref } from "@/lib/compare-url";
import { formatToman, toFaDigits } from "@/lib/format";
import { formatDistance, snapOrigin } from "@/lib/geo";
import { buildMissionStartHref, buildMissionHref } from "@/lib/mission-url";
import { buildSellersHref, buildShopHref } from "@/lib/sellers-url";
import { adviseProducts } from "@/server/advisor/engine";
import { getProductDetail } from "@/server/catalog/detail";
import { compareSellersForProduct } from "@/server/compare/service";
import { hoursAtVisit } from "@/server/compare/engine";
import { parseTehranLocal } from "@/server/compare/time";
import { recommendShoppingAreas } from "@/server/areas/recommend";
import { searchCatalog } from "@/server/search/search";
import { findCategoryActivityShops } from "@/server/sellers/activity";
import { findSellersForProduct } from "@/server/sellers/find";
import { resolveOrigin } from "@/server/sellers/origins";
import { getShop } from "@/server/repositories/shops";
import { resolveInquiryContext } from "@/server/inquiry/context";
import { buildEvidenceCard } from "./evidence/card";
import { getExternalEvidence } from "./evidence/service";
import type { AgentConfig } from "./config";
import type { Ledger } from "./ledger";
import { idOf, remember } from "./state";
import type { Understanding } from "./intent";

export interface ToolContext {
  db: DatabaseSync;
  state: AgentState;
  userMessage: string | null;
  understanding: Understanding | null;
  ledger: Ledger;
  config: AgentConfig;
  now: Date;
}
export interface ToolOutput {
  status: ToolStatus;
  /** the ONLY thing a language model sees: compact, bounded, untrusted-text-marked JSON */
  summary: Record<string, unknown>;
  cards: AgentCard[];
  actions: AgentAction[];
  clarify: ClarifyView | null;
  notes: string[];
  /** state transition caused by the tool (applied by the orchestrator, never by the model) */
  patch?: (s: AgentState) => AgentState;
}
export interface ToolDef { name: ToolName; description: string; args: z.ZodType; run(ctx: ToolContext, args: never): Promise<ToolOutput> | ToolOutput }

const empty = (status: ToolStatus, notes: string[] = [], summary: Record<string, unknown> = {}): ToolOutput => ({ status, summary, cards: [], actions: [], clarify: null, notes, });
const clip = (s: string, n: number) => sanitizeText(s, n);
/** untrusted dataset/seller/web text: bounded + flagged so the model treats it as DATA */
const u = (s: string | null | undefined, n = 90) => (s ? clip(s, n) : null);

export function priceText(p: PriceSummary): string {
  if (p.status === "reliable" && p.min !== null && p.max !== null) return p.min === p.max ? `${formatToman(p.min)} (ثبت‌شده)` : `${formatToman(p.min)?.replace(" تومان", "")} تا ${formatToman(p.max)} (ثبت‌شده)`;
  return p.label;
}
const regLedger = (l: Ledger, p: PriceSummary) => { l.num(p.min, p.max, p.median, p.reliableCount, p.totalOffers, p.pricedOffers); };

const seenOk = (ctx: ToolContext, kind: "products" | "shops", id: string, sel?: string | null) => idOf(kind === "products" ? "product" : "shop", id) && (ctx.state.seen[kind].includes(id) || id === sel);

function originOf(ctx: ToolContext) {
  const o = ctx.state.origin;
  const r = resolveOrigin(ctx.db, o?.kind === "map" ? { point: snapOrigin({ lat: o.lat, lon: o.lon }) } : { preset: o?.kind === "preset" ? o.id : null });
  return { ...r, defaulted: o === null };
}

const productHref = (id: string, variant?: string | null) => `/products/${id}${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`;
const sellersHrefFor = (ctx: ToolContext, id: string, variant: string | null) => buildSellersHref({ product: id, variant, origin: ctx.state.origin?.kind === "preset" ? ctx.state.origin.id : ctx.state.origin?.kind === "map" ? "map" : null, ll: ctx.state.origin?.kind === "map" ? { lat: ctx.state.origin.lat, lon: ctx.state.origin.lon } : null, radius: ctx.state.radius, bmin: ctx.state.budget.min, bmax: ctx.state.budget.max });
const ctl = (c: AgentControl) => c;

// ---------------------------------------------------------------- tools
const understandTool: ToolDef = {
  name: "understand_or_clarify_need",
  description: "Extract the user's explicit preferences (category, budget, exact model, radius, district, intent) from THEIR latest message. Returns hints, never facts.",
  args: z.object({}).strict(),
  run(ctx) {
    const un = ctx.understanding;
    if (!un || un.empty) return empty("unknown", ["پیام خالی است."]);
    const s = { category: un.category, categoryChoices: un.categoryChoices, budget: un.budget, model: un.model, radiusMeters: un.radius, district: un.district, intents: un.intents, hasNeed: un.hasNeed };
    if (un.intents.includes("reset")) { const r = empty("ok", ["همه‌ی ترجیحات پاک شد."], { reset: true }); r.patch = () => initialAgentState(); return r; }
    const out = empty(un.category || un.model || un.budget || un.radius || un.district || un.intents.length ? "ok" : "ambiguous", [], s);
    // a command about the CURRENT product (sellers/compare/review/inquiry…) must never re-interpret its own words as a new product need
    const workflow = un.intents.some((i) => ["sellers", "compare", "review", "inquiry", "alternatives", "areas", "reply", "send", "hours", "phone", "stock"].includes(i));
    out.patch = (st) => {
      const keepNeed = workflow && !!st.selection;
      let n = { ...st, text: un.hasNeed && !keepNeed ? clip(un.needText || un.text, 200) : st.text };
      if (un.category && un.category !== st.category && !keepNeed) n = { ...n, category: un.category, answers: {}, skipped: [], selection: null, selectedShopIds: [], selectedOffer: null, stage: 1 };
      if (un.budget) n = { ...n, budget: { min: un.budget.min ?? (un.budget.max !== null && !un.budget.min ? n.budget.min : un.budget.min), max: un.budget.max ?? n.budget.max } };
      if (un.budget && un.budget.min === null && un.budget.max !== null) n = { ...n, budget: { min: st.budget.min, max: un.budget.max } };
      if (un.radius) n = { ...n, radius: un.radius };
      if (un.district) n = { ...n, origin: { kind: "preset", id: un.district } };
      if (un.model) n = { ...n, model: un.model, ...(un.model !== st.model ? { selection: null, selectedShopIds: [], selectedOffer: null } : {}) };
      if (un.constraints.hard.length || un.constraints.soft.length) n = { ...n, constraints: { hard: [...new Set([...n.constraints.hard, ...un.constraints.hard])].slice(0, 6), soft: [...new Set([...n.constraints.soft, ...un.constraints.soft])].slice(0, 6) } };
      return n;
    };
    ctx.ledger.num(un.budget?.min, un.budget?.max, un.radius);
    ctx.ledger.untrusted(un.text);
    return out;
  },
};

const searchTool: ToolDef = {
  name: "search_products",
  description: "Search the OFFICIAL Torob dataset catalog by name or exact model code. Dataset matches are always kept.",
  args: z.object({ query: z.string().min(1).max(120), limit: z.number().int().min(1).max(8).optional() }).strict(),
  run(ctx, a: { query: string; limit?: number }) {
    const q = clip(a.query, 120);
    const r = searchCatalog(ctx.db, { q, category: null, limit: a.limit ?? 6, offset: 0, facets: true });
    if (!r.valid || r.items.length === 0) {
      const out = empty("not_found", ["در نمونه‌ی داده‌ی هکاتون محصولی با این نام/مدل پیدا نشد؛ این به معنی نبودنش در بازار تهران نیست."], { query: q, categoryHints: r.categoryHints.slice(0, 3), valid: r.valid });
      return out;
    }
    const exact = r.items.filter((i) => i.match === "exact_model");
    const cards: AgentCard[] = r.items.map((it, i) => productCard(ctx, it.card, i + 1, [it.match === "exact_model" ? "تطبیق دقیق کد مدل" : it.match === "offer_model" ? "کد مدل فقط در عنوان پیشنهادها" : "تطبیق نام"], [], false));
    r.items.forEach((it) => regLedger(ctx.ledger, it.card.price));
    ctx.ledger.num(r.items.length, ...r.items.map((i) => i.card.distinctSellers));
    const out: ToolOutput = {
      status: exact.length > 1 ? "ambiguous" : "ok",
      summary: { query: q, count: r.items.length, exactModelMatches: exact.length, items: r.items.map((it) => ({ productId: it.card.id, title: u(it.card.title), match: it.match, price: { status: it.card.price.status, min: it.card.price.min, max: it.card.price.max }, distinctSellers: it.card.distinctSellers, untrusted: ["title"] })) },
      cards, actions: [], clarify: null,
      notes: exact.length > 1 ? ["چند محصول کد مدل یکسان دارند؛ نسخه‌ی دقیق باید انتخاب شود."] : [],
      patch: (s) => remember({ ...s, ...(exact.length === 1 ? { selection: { productId: exact[0]!.card.id, variantGroupId: null }, stage: 2 as const, selectedShopIds: [], selectedOffer: null } : {}) }, { products: r.items.map((i) => i.card.id) }),
    };
    return out;
  },
};

const adviseTool: ToolDef = {
  name: "advise_products",
  description: "Need-based shortlist from the dataset using the conversation's answers and budget. May return ONE clarifying question instead of results.",
  args: z.object({ category: z.string().max(120).optional(), showResults: z.boolean().optional() }).strict(),
  run(ctx, a: { category?: string; showResults?: boolean }) {
    const st = ctx.state;
    const known = a.category && ctx.db.prepare("SELECT 1 FROM products WHERE category_name = ? LIMIT 1").get(a.category) ? a.category : null;
    const answered = Object.keys(st.answers).length + st.skipped.length;
    const r = adviseProducts(ctx.db, { text: st.text, category: known ?? st.category, answers: st.answers, skipped: st.skipped, budget: st.budget, show: a.showResults || answered >= 2, limit: 6, offset: 0 });
    if (r.stage === "need") return empty("ambiguous", ["نیازتان را بنویسید: چه کالایی با چه کاربردی؟"], { stage: r.stage });
    if (r.stage === "clarify_category") {
      const choices = r.categoryChoices.slice(0, 5);
      const clarify: ClarifyView = { questionId: "category", text: "منظورتان کدام دسته‌ی کالاست؟", help: null, options: choices.map((c) => ({ id: c.category, label: c.label, hint: `${toFaDigits(c.productCount)} محصول در داده`, control: ctl({ type: "answer", questionId: "category", optionId: c.category }) })), skip: null };
      ctx.ledger.num(...choices.map((c) => c.productCount));
      return { ...empty("ambiguous", [], { stage: r.stage, categoryChoices: choices.map((c) => ({ category: c.category, productCount: c.productCount })) }), clarify };
    }
    if (r.stage === "question" && r.question) {
      const q = r.question;
      const opts = q.kind === "budget"
        ? r.budgetBands.slice(0, 5).map((b) => ({ id: b.id, label: b.label, hint: `${toFaDigits(b.count)} محصول`, control: ctl({ type: "set_budget", min: b.min, max: b.max }) as AgentControl }))
        : q.options.slice(0, 6).map((o) => ({ id: o.id, label: o.label, hint: o.hint ?? null, control: ctl({ type: "answer", questionId: q.id, optionId: o.id }) as AgentControl }));
      const clarify: ClarifyView = { questionId: q.id, text: q.text, help: q.help ?? null, options: opts, skip: ctl({ type: "skip_question", questionId: q.id }) };
      ctx.ledger.num(r.progress.current, r.progress.total);
      return { ...empty("ambiguous", [], { stage: r.stage, question: { id: q.id, text: q.text, hardness: q.hardness } }), clarify, patch: (s) => ({ ...s, category: r.category?.category ?? s.category }) };
    }
    if (!r.candidates.length) {
      const out = empty("not_found", [r.recovery?.message ?? "با این شرط‌ها محصولی در نمونه‌ی داده پیدا نشد."], { funnel: r.funnel, recovery: r.recovery?.suggestions.map((x) => x.label).slice(0, 3) ?? [] });
      out.actions = (r.recovery?.suggestions ?? []).slice(0, 2).map((x) => (x.patch.budget ? { kind: "control", label: x.label, control: ctl({ type: "set_budget", min: x.patch.budget.min ?? null, max: x.patch.budget.max ?? null }) } : { kind: "suggest", label: x.label, message: x.label }) as AgentAction);
      return out;
    }
    const cards = r.candidates.slice(0, 6).map((c) => productCard(ctx, c.card, c.rank, c.reasons.filter((x) => x.effect === "match").map((x) => x.text).slice(0, 3), c.cautions.slice(0, 2), false));
    r.candidates.forEach((c) => { regLedger(ctx.ledger, c.card.price); ctx.ledger.num(c.rank, c.card.distinctSellers); });
    ctx.ledger.num(r.funnel?.inCategory, r.funnel?.afterHardFilters, r.funnel?.outOfBudget, r.candidates.length, Math.min(6, r.candidates.length));
    return {
      status: "ok",
      summary: { category: r.category?.category ?? null, funnel: r.funnel, answered: r.answered.map((x) => `${x.questionText}: ${x.optionLabel}`).slice(0, 6), items: r.candidates.slice(0, 6).map((c) => ({ productId: c.card.id, rank: c.rank, title: u(c.card.title), price: { status: c.card.price.status, min: c.card.price.min, max: c.card.price.max }, budget: c.budget, distinctSellers: c.card.distinctSellers, cautions: c.cautions.slice(0, 2), untrusted: ["title", "cautions"] })), limitations: r.limitations.slice(0, 2) },
      cards, actions: [], clarify: null, notes: r.limitations.slice(0, 2),
      patch: (s) => remember({ ...s, category: r.category?.category ?? s.category }, { products: r.candidates.map((c) => c.card.id) }),
    };
  },
};

function productCard(ctx: ToolContext, c: import("@/domain/advisor").ProductCard, rank: number | null, reasons: string[], cautions: string[], selected: boolean): AgentCard {
  return {
    type: "product", id: `product:${c.id}`, badges: ["OFFICIAL_DATASET"], productId: c.id, title: clip(c.title, 140), categoryName: c.categoryName, priceText: priceText(c.price), distinctSellers: c.distinctSellers,
    reasons: reasons.map((r) => clip(r, 160)), cautions: cautions.map((r) => clip(r, 160)), rank, hrefs: { product: productHref(c.id), sellers: sellersHrefFor(ctx, c.id, null) }, selected,
  };
}

const detailsTool: ToolDef = {
  name: "get_product_details",
  description: "Specs, price evidence and variant groups of ONE dataset product the conversation has already shown.",
  args: z.object({ productId: z.string().regex(/^product_[0-9a-f]{8,40}$/) }).strict(),
  run(ctx, a: { productId: string }) {
    if (!seenOk(ctx, "products", a.productId, ctx.state.selection?.productId)) return empty("not_found", ["این محصول در این گفت‌وگو نشان داده نشده است."]);
    const d = getProductDetail(ctx.db, a.productId);
    if (!d) return empty("not_found", ["محصول پیدا نشد."]);
    regLedger(ctx.ledger, d.card.price);
    ctx.ledger.num(d.variantGroups.length, ...d.variantGroups.map((g) => g.offerCount), d.card.distinctSellers);
    const out = empty(d.needsVariantConfirmation ? "ambiguous" : "ok", d.needsVariantConfirmation ? ["پیشنهادهای این محصول لزوماً یک کالا نیستند؛ نسخه‌ی دقیق را تأیید کنید."] : [], {
      productId: d.card.id, title: u(d.card.title), category: d.card.categoryName, price: { status: d.card.price.status, min: d.card.price.min, max: d.card.price.max }, distinctSellers: d.card.distinctSellers,
      needsVariantConfirmation: d.needsVariantConfirmation, variants: d.variantGroups.slice(0, 5).map((g) => ({ id: g.id, label: g.label, offerCount: g.offerCount, flags: g.flags.slice(0, 3) })),
      specs: d.specs.slice(0, 8).map((s) => ({ key: u(s.key, 40), value: u(s.value, 60) })), untrusted: ["title", "specs"],
    });
    out.cards = [productCard(ctx, d.card, null, d.specs.slice(0, 2).map((s) => `${s.key}: ${s.value}`), d.needsVariantConfirmation ? ["نسخه‌ی دقیق باید تأیید شود"] : [], ctx.state.selection?.productId === d.card.id)];
    if (d.needsVariantConfirmation && d.variantGroups.length > 1) {
      out.clarify = { questionId: "variant", text: "کدام نسخه را می‌خواهید؟", help: "پیشنهادها از نظر کد مدل یا واحد قیمت یکسان نیستند.", options: d.variantGroups.slice(0, 5).map((g) => ({ id: g.id, label: g.label, hint: `${toFaDigits(g.offerCount)} پیشنهاد`, control: ctl({ type: "select_product", productId: a.productId, variantGroupId: g.id }) })), skip: null };
    }
    return out;
  },
};

const alternativesTool: ToolDef = {
  name: "find_product_alternatives",
  description: "Other products from the SAME category in the dataset (explicit criterion: same category, current budget). Never off-topic padding.",
  args: z.object({ productId: z.string().regex(/^product_[0-9a-f]{8,40}$/) }).strict(),
  run(ctx, a: { productId: string }) {
    if (!seenOk(ctx, "products", a.productId, ctx.state.selection?.productId)) return empty("not_found", ["این محصول در این گفت‌وگو نشان داده نشده است."]);
    const row = ctx.db.prepare("SELECT category_name AS c FROM products WHERE product_id = ?").get(a.productId) as { c: string } | undefined;
    if (!row) return empty("not_found", ["محصول پیدا نشد."]);
    const r = adviseProducts(ctx.db, { category: row.c, budget: ctx.state.budget, show: true, limit: 8, offset: 0 });
    const alts = r.candidates.filter((c) => c.card.id !== a.productId && c.card.distinctSellers > 0).slice(0, 4);
    if (!alts.length) return empty("not_found", ["جایگزین مرتبطی در همین دسته و بودجه پیدا نشد."], { category: row.c });
    alts.forEach((c) => { regLedger(ctx.ledger, c.card.price); ctx.ledger.num(c.card.distinctSellers); });
    return {
      status: "ok", summary: { criterion: "همان دسته‌ی داده و بودجه‌ی فعلی", category: row.c, items: alts.map((c) => ({ productId: c.card.id, title: u(c.card.title), price: { status: c.card.price.status, min: c.card.price.min, max: c.card.price.max }, distinctSellers: c.card.distinctSellers, untrusted: ["title"] })) },
      cards: alts.map((c, i) => productCard(ctx, c.card, i + 1, ["هم‌دسته با محصول انتخابی", ...c.reasons.filter((x) => x.effect === "match").map((x) => x.text).slice(0, 1)], c.cautions.slice(0, 1), false)), actions: [], clarify: null,
      notes: ["جایگزین‌ها فقط از همان دسته‌ی داده‌اند؛ موجودی هیچ‌کدام تأیید نشده است."], patch: (s) => remember(s, { products: alts.map((c) => c.card.id) }),
    };
  },
};

const sellersTool: ToolDef = {
  name: "find_sellers_for_product",
  description: "Nearby shops with a REGISTERED OFFER for the selected product/variant (never inferred from shop category). Offers are not stock.",
  args: z.object({ productId: z.string().regex(/^product_[0-9a-f]{8,40}$/).optional(), variantGroupId: z.string().max(120).nullable().optional() }).strict(),
  run(ctx, a: { productId?: string; variantGroupId?: string | null }) {
    const pid = a.productId ?? ctx.state.selection?.productId;
    if (!pid || !seenOk(ctx, "products", pid, ctx.state.selection?.productId)) return empty("ambiguous", ["ابتدا یک محصول را انتخاب کنید."]);
    const variant = a.variantGroupId === undefined ? ctx.state.selection?.variantGroupId ?? null : a.variantGroupId;
    const o = originOf(ctx);
    const r = findSellersForProduct(ctx.db, { productId: pid, variantGroupId: variant, origin: o, radiusMeters: ctx.state.radius, pageSize: 6, includeOutside: true, at: ctx.now });
    if (!r) return empty("not_found", ["محصول پیدا نشد."]);
    const mk = (s: import("@/domain/sellers").SellerMatch, outside: boolean): AgentCard => {
      const pe = s.priceEvidence;
      ctx.ledger.meters(s.distanceMeters); ctx.ledger.num(pe.min, pe.max, s.offerCount);
      return {
        type: "seller", id: `shop:${s.shopId}`, badges: ["OFFICIAL_DATASET"], geoType: "MATCHED_OFFER_SELLER", shopId: s.shopId, name: clip(s.name, 80), locationLabel: s.locationLabel,
        distanceText: s.distanceMeters !== null ? `حدود ${formatDistance(s.distanceMeters)}${outside ? " (خارج از شعاع)" : ""} — خط مستقیم` : null,
        priceText: pe.status === "recorded" && pe.min !== null ? `${pe.min === pe.max ? formatToman(pe.min) : `${formatToman(pe.min)?.replace(" تومان", "")} تا ${formatToman(pe.max)}`} (ثبت‌شده)` : "قیمت قابل‌اتکا ثبت نشده",
        variantStatus: s.variantMatchStatus, offerCount: s.offerCount, offerId: s.offerIds.length === 1 ? s.offerIds[0]! : null,
        hoursText: s.declaredSchedule.status.state === "open" ? "داخل ساعت اعلام‌شده" : s.declaredSchedule.status.state === "closed" ? "خارج از ساعت اعلام‌شده" : "ساعت اعلام نشده",
        hrefs: { shop: buildShopHref(s.shopId, { product: pid, variant }), inquiry: s.offerIds.length === 1 ? buildMissionHref({ product: pid, variant, shop: s.shopId, offer: s.offerIds[0]! }) : null }, selected: ctx.state.selectedShopIds.includes(s.shopId),
      };
    };
    ctx.ledger.num(r.counts.shopsWithinRadius, r.counts.shopsTotal, r.counts.shopsAnyVariant, r.counts.offersTotal, ctx.state.radius, ...r.radiusHints.map((h) => h.shops), ...r.radiusHints.map((h) => h.radiusMeters));
    // outside-radius shops are shown only when NOTHING is inside the radius (they are the recovery, not padding)
    const outsideShown = r.sellers.length === 0 ? r.outsideRadius.slice(0, 3) : [];
    const cards: AgentCard[] = [...r.sellers.map((s) => mk(s, false)), ...outsideShown.map((s) => mk(s, true))];
    const status: ToolStatus = r.situation === "VARIANT_UNCONFIRMED" ? "ambiguous" : r.situation === "OK" ? "ok" : r.situation === "NO_SHOP_IN_RADIUS" ? "not_found" : r.situation === "NO_RELIABLE_VARIANT_MATCH" || r.situation === "NO_OFFERS" ? "not_found" : "unknown";
    const out: ToolOutput = {
      status,
      summary: {
        productId: pid, situation: r.situation, origin: { label: o.label, defaulted: o.defaulted }, radiusMeters: ctx.state.radius, counts: r.counts, outsideDatasetCoverage: r.outsideDatasetCoverage,
        sellers: r.sellers.map((s) => ({ shopId: s.shopId, name: u(s.name, 60), distanceMeters: s.distanceMeters !== null ? Math.round(s.distanceMeters) : null, variantStatus: s.variantMatchStatus, priceMin: s.priceEvidence.min, priceMax: s.priceEvidence.max, offerCount: s.offerCount, hours: s.declaredSchedule.status.state, untrusted: ["name"] })),
        outsideRadius: r.outsideRadius.slice(0, 3).map((s) => ({ shopId: s.shopId, name: u(s.name, 60), distanceMeters: s.distanceMeters !== null ? Math.round(s.distanceMeters) : null })), radiusHints: r.radiusHints.slice(0, 3),
      },
      cards, actions: [], clarify: null, notes: r.notices.slice(0, 3),
      patch: (s) => remember({ ...s, stage: 2 }, { shops: [...r.sellers, ...r.outsideRadius].map((x) => x.shopId) }),
    };
    // nothing matched inside the radius: also show the nearest shops ACTIVE in the category — a different, clearly labelled entity type
    if (r.sellers.length === 0 && r.situation !== "VARIANT_UNCONFIRMED") {
      const cat = ctx.db.prepare("SELECT category_name AS c FROM products WHERE product_id = ?").get(pid) as { c: string } | undefined;
      const act = cat ? findCategoryActivityShops(ctx.db, { category: cat.c, productId: pid, origin: { lat: o.lat, lon: o.lon }, radiusMeters: ctx.state.radius, limit: 3 }) : null;
      for (const sh of act?.shops ?? []) {
        ctx.ledger.meters(sh.distanceMeters);
        out.cards.push({ type: "seller", id: `act:${sh.shopId}`, badges: ["OFFICIAL_DATASET", "SYSTEM_ESTIMATE"], geoType: "CATEGORY_ACTIVITY_ONLY", shopId: sh.shopId, name: clip(sh.name, 80), locationLabel: sh.locationLabel, distanceText: sh.distanceMeters !== null ? `حدود ${formatDistance(sh.distanceMeters)} — خط مستقیم` : null, priceText: "برای این محصول پیشنهادی ثبت نشده", variantStatus: "UNSELECTED", offerCount: 0, offerId: null, hoursText: "—", hrefs: { shop: buildShopHref(sh.shopId, {}), inquiry: null }, selected: false });
      }
      out.summary.categoryActivity = (act?.shops ?? []).map((sh) => ({ shopId: sh.shopId, name: u(sh.name, 60), distanceMeters: sh.distanceMeters !== null ? Math.round(sh.distanceMeters) : null, type: "CATEGORY_ACTIVITY_ONLY", note: "فعال در دسته؛ پیشنهادی برای این محصول ثبت نشده" }));
      ctx.ledger.num(act?.total, act?.withinRadius);
    }
    r.sellers.forEach((s) => ctx.ledger.num(Math.round(s.distanceMeters ?? 0)));
    r.outsideRadius.forEach((s) => ctx.ledger.meters(s.distanceMeters));
    if (r.situation === "VARIANT_UNCONFIRMED") {
      const groups = r.variant.groups.slice(0, 5);
      out.clarify = { questionId: "variant", text: "نسخه‌ی دقیق کدام است؟ بدون آن، فروشنده‌ی «همین نسخه» اعلام نمی‌شود.", help: null, options: groups.map((g) => ({ id: g.id, label: g.label, hint: `${toFaDigits(g.offerCount)} پیشنهاد`, control: ctl({ type: "select_product", productId: pid, variantGroupId: g.id }) })), skip: null };
      out.cards = [];
    }
    for (const h of r.radiusHints.slice(0, 2)) out.actions.push({ kind: "control", label: `گسترش شعاع تا ${toFaDigits(h.radiusMeters / 1000)} کیلومتر (${toFaDigits(h.shops)} فروشگاه)`, control: ctl({ type: "set_radius", radius: h.radiusMeters }) });
    out.actions.push({ kind: "navigate", label: "نقشه و فهرست کامل", href: sellersHrefFor(ctx, pid, variant) });
    return out;
  },
};

const compareTool: ToolDef = {
  name: "compare_sellers",
  description: "Side-by-side comparison of 2–4 shops already shown, with identity grades A–D and a conservative price verdict (it may decline to name a winner).",
  args: z.object({ shopIds: z.array(z.string().regex(/^shop_[0-9a-f]{8,40}$/)).min(1).max(4), priority: z.enum(["price", "distance", "hours", "payment", "warranty"]).optional() }).strict(),
  run(ctx, a: { shopIds: string[]; priority?: AgentState["priority"] }) {
    const pid = ctx.state.selection?.productId;
    if (!pid) return empty("ambiguous", ["ابتدا یک محصول را انتخاب کنید."]);
    const ids = [...new Set(a.shopIds)].filter((id) => seenOk(ctx, "shops", id));
    if (ids.length < a.shopIds.length) return empty("not_found", ["برخی فروشگاه‌ها در این گفت‌وگو نشان داده نشده‌اند."]);
    const o = originOf(ctx);
    const r = compareSellersForProduct(ctx.db, {
      productId: pid, variantGroupId: ctx.state.selection?.variantGroupId ?? null, shopIds: ids, origin: { lat: o.lat, lon: o.lon, source: o.source, label: o.label }, radiusMeters: ctx.state.radius,
      visit: ctx.state.visit, budget: ctx.state.budget, priority: a.priority ?? ctx.state.priority, now: ctx.now,
    });
    if (!r) return empty("not_found", ["محصول پیدا نشد."]);
    const rows = r.sellers.map((s) => ({ shopId: s.shopId, offerId: s.representative?.offerId ?? null, name: clip(s.name, 80), rank: s.rank, tier: s.tier, priceText: s.price.priceToman !== null ? formatToman(s.price.priceToman)! : "قیمت ثبت نشده", comparability: s.price.comparability, hoursText: s.hours.state === "WITHIN_DECLARED" ? "داخل ساعت اعلام‌شده" : s.hours.state === "OUTSIDE_DECLARED" ? "خارج از ساعت اعلام‌شده" : "ساعت نامعلوم", summary: clip(s.summaryFa, 200) }));
    r.sellers.forEach((s) => { ctx.ledger.num(s.price.priceToman, s.rank); ctx.ledger.meters(s.distanceMeters); });
    ctx.ledger.num(r.verdict.marginToman, r.sellers.length);
    if (r.verdict.kind === "CHEAPEST_CONFIRMED") ctx.ledger.flag("VERDICT_CONFIRMED");
    if (r.verdict.winnerShopId) ctx.ledger.flag("HAS_WINNER");
    const status: ToolStatus = r.situation === "NO_COMPARABLE_SELLERS" ? "no_comparable_offer" : r.situation === "VARIANT_UNCONFIRMED" ? "ambiguous" : r.situation === "SINGLE_SELLER" ? "ok" : r.situation === "OK" ? "ok" : "unknown";
    const href = buildCompareHref({ product: pid, variant: ctx.state.selection?.variantGroupId ?? null, shops: ids, origin: ctx.state.origin?.kind === "preset" ? ctx.state.origin.id : ctx.state.origin?.kind === "map" ? "map" : "ferdowsi", ll: ctx.state.origin?.kind === "map" ? { lat: ctx.state.origin.lat, lon: ctx.state.origin.lon } : null, radius: ctx.state.radius, visit: ctx.state.visit, bmin: ctx.state.budget.min, bmax: ctx.state.budget.max, prio: a.priority ?? ctx.state.priority });
    return {
      status,
      summary: { situation: r.situation, verdict: { kind: r.verdict.kind, winnerShopId: r.verdict.winnerShopId, marginToman: r.verdict.marginToman, headline: r.verdict.headlineFa }, priority: a.priority ?? ctx.state.priority, sellers: rows.map((x) => ({ ...x, untrusted: ["name"] })), notices: r.notices.slice(0, 2) },
      cards: [{ type: "comparison", id: `cmp:${ids.join(",")}`, badges: ["OFFICIAL_DATASET", "SYSTEM_ESTIMATE"], verdictKind: r.verdict.kind, headline: r.verdict.headlineFa, detail: clip(r.verdict.detailFa, 400), rows, hrefs: { compare: href } }],
      actions: [{ kind: "navigate", label: "جدول کامل مقایسه", href }], clarify: null, notes: r.notices.slice(0, 2),
      patch: (s) => ({ ...s, stage: 3, selectedShopIds: ids, priority: a.priority ?? s.priority }),
    };
  },
};

const hoursTool: ToolDef = {
  name: "get_shop_declared_hours",
  description: "A shop's DECLARED opening state at a visit time (Asia/Tehran). Declared only; unknown is never 'closed'.",
  args: z.object({ shopId: z.string().regex(/^shop_[0-9a-f]{8,40}$/), visit: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional() }).strict(),
  run(ctx, a: { shopId: string; visit?: string | null }) {
    if (!seenOk(ctx, "shops", a.shopId)) return empty("not_found", ["این فروشگاه در این گفت‌وگو نشان داده نشده است."]);
    const s = getShop(ctx.db, a.shopId);
    if (!s) return empty("not_found", ["فروشگاه پیدا نشد."]);
    const at = parseTehranLocal(a.visit ?? ctx.state.visit) ?? ctx.now;
    const h = hoursAtVisit(s.shop.hours, at);
    return { ...empty(h.state === "UNKNOWN" ? "unknown" : "ok", [], { shopId: a.shopId, name: u(s.shop.name, 60), state: h.state, label: h.labelFa, window: h.window, atTehran: h.atTehran, untrusted: ["name"] }), actions: [{ kind: "navigate", label: "جزئیات فروشگاه", href: buildShopHref(a.shopId, { product: ctx.state.selection?.productId ?? null }) }] };
  },
};

const areasTool: ToolDef = {
  name: "recommend_shopping_areas",
  description: "Where to LOOK when no seller matches: verified/sourced shopping areas or dataset-density estimates. Never a seller, never stock, no coordinates from the model.",
  args: z.object({ category: z.string().max(120).optional() }).strict(),
  run(ctx, a: { category?: string }) {
    const hint = a.category ?? ctx.state.category ?? ctx.state.text;
    const o = originOf(ctx);
    const r = recommendShoppingAreas(ctx.db, { categoryHint: hint, origin: { lat: o.lat, lon: o.lon }, limit: 3 });
    if (!r.areas.length) return empty("unknown", [r.reason === "NO_CATEGORY" ? "دسته‌ی کالا را تشخیص ندادیم، پس منطقه‌ای پیشنهاد نمی‌کنیم." : "برای این دسته شاهد کافی برای معرفی یک منطقه نداریم؛ حدس نمی‌زنیم."], { reason: r.reason });
    const cards: AgentCard[] = r.areas.map((x) => {
      const curated = x.area.sourceType === "curated_external";
      ctx.ledger.meters(x.distanceMeters); ctx.ledger.num(x.density?.shopsListing, x.density?.shopsWithOffers, x.area.sources.length);
      return {
        type: "area", id: `area:${x.area.id}`, badges: curated ? ["EXTERNAL_FACT", "SYSTEM_ESTIMATE"] : ["SYSTEM_ESTIMATE"], areaId: x.area.id, geoType: curated ? "VERIFIED_SHOPPING_DISTRICT" : "DATASET_DENSITY_ESTIMATE", name: clip(x.area.nameFa, 100),
        reason: clip(x.area.recommendationReasonFa, 220), confidenceText: x.area.confidence === "high" ? "اطمینان بالا" : x.area.confidence === "medium" ? "اطمینان متوسط" : "اطمینان کم", sourcesText: curated ? `${toFaDigits(x.area.sources.length)} منبع بررسی‌شده` : "از تراکم داده‌ی هکاتون", verifiedAt: x.area.verifiedAt,
        distanceText: x.distanceMeters !== null ? `حدود ${formatDistance(x.distanceMeters)} تا مرکز (خط مستقیم)` : null, hrefs: { map: `/sellers?category=${encodeURIComponent(r.category ?? hint)}` },
      };
    });
    return {
      status: "ok", summary: { category: r.category, areas: r.areas.map((x) => ({ id: x.area.id, name: u(x.area.nameFa, 80), type: x.area.sourceType === "curated_external" ? "VERIFIED_SHOPPING_DISTRICT" : "DATASET_DENSITY_ESTIMATE", confidence: x.area.confidence, verifiedAt: x.area.verifiedAt, sources: x.area.sources.length })), disclaimer: "سرنخ مکانی است؛ فروشنده یا موجودی نیست" },
      cards, actions: [{ kind: "navigate", label: "نقشه‌ی مناطق پیشنهادی", href: `/sellers?category=${encodeURIComponent(r.category ?? hint)}` }], clarify: null, notes: ["منطقه‌ی خرید فقط سرنخ است؛ موجودی هیچ کالایی را تأیید نمی‌کند."],
    };
  },
};

function inquiryContext(ctx: ToolContext, shopId: string, offerId: string | null): { ctx: InquiryContext } | { out: ToolOutput } {
  const pid = ctx.state.selection?.productId ?? null;
  if (!pid) return { out: empty("ambiguous", ["ابتدا یک محصول را انتخاب کنید."]) };
  const r = resolveInquiryContext(ctx.db, { product: pid, variant: ctx.state.selection?.variantGroupId ?? null, shop: shopId, offer: offerId, visit: ctx.state.visit, now: ctx.now });
  if (!r.ok) return { out: empty(r.error === "OFFER_REQUIRED" ? "ambiguous" : "not_found", [r.error === "OFFER_MISMATCH" ? "این پیشنهاد به این فروشگاه و محصول تعلق ندارد." : r.error === "OFFER_REQUIRED" ? "این فروشگاه چند پیشنهاد دارد؛ یکی را انتخاب کنید." : "زمینه‌ی پرسش ساخته نشد."], { error: r.error }) };
  return { ctx: r.context };
}

const inquiryTool: ToolDef = {
  name: "compose_seller_inquiry",
  description: "Draft (NOT send) a question text for a shop's registered offer. The user copies it and asks the seller themselves.",
  args: z.object({ shopId: z.string().regex(/^shop_[0-9a-f]{8,40}$/), offerId: z.string().regex(/^offer_[0-9a-f]{8,40}$/).nullable().optional() }).strict(),
  run(ctx, a: { shopId: string; offerId?: string | null }) {
    if (!seenOk(ctx, "shops", a.shopId)) return empty("not_found", ["این فروشگاه در این گفت‌وگو نشان داده نشده است."]);
    const r = inquiryContext(ctx, a.shopId, a.offerId ?? (ctx.state.selectedOffer?.shopId === a.shopId ? ctx.state.selectedOffer.offerId : null));
    if ("out" in r) return r.out;
    const qs = buildQuestions(r.ctx);
    const draft = composeInquiry(r.ctx, qs.filter((q) => defaultQuestionIds(qs).includes(q.id)));
    ctx.ledger.num(r.ctx.offer.priceToman, r.ctx.offer.ageDaysToday);
    const href = buildMissionHref({ product: r.ctx.product.id, variant: r.ctx.variant.selectedGroupId, shop: a.shopId, offer: r.ctx.offer.id, visit: ctx.state.visit });
    // the assistant may SEED a mission from safe state (ids, budget, named district); it can never write trusted mission evidence
    const st = ctx.state;
    const missionHref = buildMissionStartHref({ product: r.ctx.product.id, variant: r.ctx.variant.selectedGroupId, shop: a.shopId, offer: r.ctx.offer.id, visit: st.visit, need: st.text || null, category: st.category, bmin: st.budget.min, bmax: st.budget.max, district: st.origin?.kind === "preset" ? st.origin.id : null, radius: st.radius, priority: st.priority });
    return {
      status: "ok", summary: { shopId: a.shopId, offerId: r.ctx.offer.id, questions: qs.filter((q) => q.defaultOn).map((q) => q.id), identityTier: r.ctx.offer.tier, notSent: true, draftChars: draft.length },
      cards: [{ type: "inquiry", id: `inq:${r.ctx.offer.id}`, badges: ["OFFICIAL_DATASET", "UNKNOWN"], shopId: a.shopId, offerId: r.ctx.offer.id, draft, notSentText: "این فقط پیش‌نویس است؛ چیزی ارسال نشده و هیچ تماسی گرفته نشده. خودتان از راه مستقل بپرسید.", hrefs: { workspace: href, mission: missionHref } }],
      actions: [{ kind: "navigate", label: "باز کردن فضای پرسش (کپی، ثبت پاسخ)", href }], clarify: null, notes: ["پیش‌نویس ارسال نمی‌شود؛ ارسال با خودتان است."],
      patch: (s) => ({ ...s, stage: 4, selectedOffer: { shopId: a.shopId, offerId: r.ctx.offer.id } }),
    };
  },
};

const replyTool: ToolDef = {
  name: "summarize_user_reported_reply",
  description: "Summarise what the USER says a seller replied (structured). Always USER_REPORTED and unverified; never feeds ranking or the dataset.",
  args: z.object({
    shopId: z.string().regex(/^shop_[0-9a-f]{8,40}$/), offerId: z.string().regex(/^offer_[0-9a-f]{8,40}$/).nullable().optional(),
    stock: z.enum(["yes", "no", "unknown"]).optional(), reportedPriceText: z.string().max(60).optional(), unit: z.enum(["toman", "rial"]).nullable().optional(), model: z.enum(["same", "different", "unsure", "not_asked"]).optional(),
  }).strict(),
  run(ctx, a: { shopId: string; offerId?: string | null; stock?: "yes" | "no" | "unknown"; reportedPriceText?: string; unit?: "toman" | "rial" | null; model?: "same" | "different" | "unsure" | "not_asked" }) {
    if (!seenOk(ctx, "shops", a.shopId)) return empty("not_found", ["این فروشگاه در این گفت‌وگو نشان داده نشده است."]);
    // a tool argument can never put words in the user's mouth: every reported fact must match the USER's own latest message
    const msg = ctx.userMessage ?? "";
    const sug = suggestFromText(msg);
    if (a.stock && a.stock !== "unknown" && sug.stock !== a.stock) return empty("invalid_args", ["گزارش موجودی با پیام خود شما نمی‌خواند؛ نادیده گرفته شد."]);
    if (a.reportedPriceText && !toLatin(msg).includes(toLatin(a.reportedPriceText).replace(/\s+/g, " ").trim().slice(0, 20).split(" ")[0] ?? "§")) return empty("invalid_args", ["مبلغ گزارش‌شده در پیام شما نیست؛ نادیده گرفته شد."]);
    if (a.model === "different" && !sug.modelDifferent) return empty("invalid_args", ["تفاوت مدل در پیام شما نیست؛ نادیده گرفته شد."]);
    const r = inquiryContext(ctx, a.shopId, a.offerId ?? (ctx.state.selectedOffer?.shopId === a.shopId ? ctx.state.selectedOffer.offerId : null));
    if ("out" in r) return r.out;
    let price: number | null = null;
    if (a.reportedPriceText) {
      const am = interpretAmount(a.reportedPriceText, r.ctx.offer.priceToman, a.unit ?? null);
      if (am.kind === "ambiguous") {
        const out = empty("ambiguous", ["مبلغ تومان است یا ریال؟ حدس نمی‌زنیم."]);
        out.actions = [{ kind: "suggest", label: "تومان", message: `${a.reportedPriceText} تومان` }, { kind: "suggest", label: "ریال", message: `${a.reportedPriceText} ریال` }];
        return out;
      }
      if (am.kind === "invalid") return empty("invalid_args", ["مبلغ معتبر نیست."]);
      price = am.toman;
    }
    const reply: ReplyEvidence = { id: "agent-reply", provenance: "USER_REPORTED", rawText: clip(msg, 300), stock: a.stock ?? sug.stock ?? "unknown", reportedPriceToman: price, reportedUnit: "same", model: a.model ?? (sug.modelDifferent ? "different" : "not_asked"), warranty: { report: "not_asked", months: null }, payment: "not_asked", visitNote: "", receivedLabel: null, scenarioId: null };
    const o = deriveOutcome(r.ctx, { status: reply.stock === "yes" ? "USER_REPORTED_AVAILABLE" : reply.stock === "no" ? "USER_REPORTED_UNAVAILABLE" : "USER_ENTERED_REPLY", replies: [reply], nextAction: null }, "MANUAL");
    ctx.ledger.num(o.priceDelta?.recordedToman, o.priceDelta?.reportedToman, o.priceDelta?.deltaToman, o.priceDelta ? Math.abs(o.priceDelta.pct) : null);
    return {
      status: "ok", summary: { provenance: "USER_REPORTED", verified: false, headline: o.headlineFa, claim: o.claimFa, flags: o.flags, priceDelta: o.priceDelta, affectsCanonicalRanking: false },
      cards: [{ type: "outcome", id: `out:${r.ctx.offer.id}`, badges: ["USER_REPORTED"], headline: o.headlineFa, claim: o.claimFa, provenance: "USER_REPORTED", flags: o.flags, nextActions: o.nextActions.slice(0, 4).map((x) => ({ label: x.labelFa, href: x.href })) }],
      actions: [], clarify: null, notes: ["این فقط گزارش شماست و تأیید نشده؛ در رتبه‌بندی رسمی اثر ندارد."],
    };
  },
};
const toLatin = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٬,،]/g, "");

const evidenceTool: ToolDef = {
  name: "get_external_evidence",
  description: "Permitted external specs/reviews for ONE dataset product (exact-model matched, cited, validated). Enrichment only: never replaces dataset offers.",
  args: z.object({ productId: z.string().regex(/^product_[0-9a-f]{8,40}$/) }).strict(),
  async run(ctx, a: { productId: string }) {
    if (!seenOk(ctx, "products", a.productId, ctx.state.selection?.productId)) return empty("not_found", ["این محصول در این گفت‌وگو نشان داده نشده است."]);
    const mode = ctx.state.externalEvidence ? ctx.config.evidenceMode : "off";
    if (mode === "off") {
      const why = ctx.config.evidenceMode === "off" ? "بازیابی شواهد بیرونی در این محیط غیرفعال است." : "شما شواهد بیرونی را فعال نکرده‌اید.";
      const out = empty("disabled", [why, "فقط داده‌ی رسمی ترب نمایش داده می‌شود؛ نظر یا مشخصات بیرونی ساخته نمی‌شود."], { enabled: false });
      out.cards = [{ type: "evidence", id: `ev:${a.productId}`, badges: ["UNKNOWN"], productId: a.productId, status: "DISABLED", mode: "off", items: [], conflicts: [], notes: out.notes }];
      if (ctx.config.evidenceMode !== "off" && !ctx.state.externalEvidence) out.actions = [{ kind: "control", label: "فعال‌کردن شواهد بیرونی برای این گفت‌وگو", control: ctl({ type: "toggle_external", on: true }) }];
      return out;
    }
    const r = await getExternalEvidence(ctx.db, a.productId, { mode, reproduce: ctx.config.evidenceReproduce, now: ctx.now });
    for (const it of r.items) { ctx.ledger.untrusted(it.summary); for (const p of it.passages) ctx.ledger.untrusted(p.text); }
    const card = buildEvidenceCard(a.productId, r, mode);
    const items = card.items;
    const status: ToolStatus = r.status === "NO_EVIDENCE" ? "unknown" : "ok";
    return {
      status,
      summary: { status: r.status, mode: r.mode, count: items.length, conflicts: r.conflicts.slice(0, 2), items: items.map((i) => ({ id: i.id, kind: i.kind, source: i.sourceName, retrievedAt: i.retrievedAt, strengths: i.strengths.length, weaknesses: i.weaknesses.length, fixture: i.fixture, untrusted: ["summary"] })), note: "NO star ratings, review counts or sentiment scores exist in this evidence" },
      cards: [card],
      actions: [], clarify: null, notes: [...r.notes, ...r.conflicts].slice(0, 3),
    };
  },
};

export const TOOLS: Record<ToolName, ToolDef> = {
  understand_or_clarify_need: understandTool, search_products: searchTool, advise_products: adviseTool, get_product_details: detailsTool, find_product_alternatives: alternativesTool,
  find_sellers_for_product: sellersTool, compare_sellers: compareTool, get_shop_declared_hours: hoursTool, recommend_shopping_areas: areasTool, compose_seller_inquiry: inquiryTool,
  summarize_user_reported_reply: replyTool, get_external_evidence: evidenceTool,
};
// the registry is a CLOSED allowlist: adding a tool requires editing this file and TOOL_NAMES
export const isToolName = (n: string): n is ToolName => (TOOL_NAMES as readonly string[]).includes(n) && n in TOOLS;
