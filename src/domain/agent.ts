import type { RankingPriority } from "./comparison";

/**
 * Phase 7 contracts — the tool-grounded shopping assistant. Everything here is JSON-serialisable and client-safe.
 * Hard rules encoded in the types:
 *  - the MODEL only chooses tools and writes explanatory text; CARDS and ACTIONS are built by the server from validated tool results
 *  - state never holds GPS, phone numbers, demo replies or secrets (origin = a district preset or a snapped map point)
 *  - every card/claim carries an evidence badge so dataset facts, external facts, opinions, user reports and demos are never mixed
 */
export const AGENT_STATE_VERSION = 1;
export type AgentStage = 1 | 2 | 3 | 4;
export const STAGE_FA: Record<AgentStage, string> = { 1: "انتخاب محصول", 2: "یافتن فروشنده", 3: "مقایسه‌ی فروشنده", 4: "پرسش و پیگیری" };

export type OriginRef = { kind: "preset"; id: "ferdowsi" | "sheikh-hadi" | "baharestan" } | { kind: "map"; lat: number; lon: number };

export interface AgentState {
  v: typeof AGENT_STATE_VERSION;
  stage: AgentStage;
  /** last free-text need (≤ 200) */
  text: string;
  category: string | null;
  answers: Record<string, string>;
  skipped: string[];
  budget: { min: number | null; max: number | null };
  /** user-stated notes (not facts): "hard" must hold, "soft" is a wish. The advisor answers do the real filtering. */
  constraints: { hard: string[]; soft: string[] };
  /** exact model typed by the user (e.g. HDW1200CLQP) */
  model: string | null;
  selection: { productId: string; variantGroupId: string | null } | null;
  origin: OriginRef | null;
  radius: number;
  priority: RankingPriority;
  visit: string | null;
  /** ids this conversation has actually seen from tools — a tool argument id must come from here (no hallucinated ids) */
  seen: { products: string[]; shops: string[] };
  selectedShopIds: string[];
  selectedOffer: { shopId: string; offerId: string } | null;
  /** user opted in to external evidence for this conversation (the server may still have it disabled) */
  externalEvidence: boolean;
}

export const initialAgentState = (): AgentState => ({
  v: AGENT_STATE_VERSION, stage: 1, text: "", category: null, answers: {}, skipped: [], budget: { min: null, max: null }, constraints: { hard: [], soft: [] }, model: null,
  selection: null, origin: null, radius: 1000, priority: "price", visit: null, seen: { products: [], shops: [] }, selectedShopIds: [], selectedOffer: null, externalEvidence: false,
});

// ---------- controls (structured input; no prompt needed) ----------
export type AgentControl =
  | { type: "set_budget"; min: number | null; max: number | null }
  | { type: "set_radius"; radius: number }
  | { type: "set_origin"; id: "ferdowsi" | "sheikh-hadi" | "baharestan" }
  | { type: "set_priority"; priority: RankingPriority }
  | { type: "set_visit"; visit: string | null }
  | { type: "answer"; questionId: string; optionId: string }
  | { type: "skip_question"; questionId: string }
  | { type: "select_product"; productId: string; variantGroupId: string | null }
  | { type: "select_shops"; shopIds: string[] }
  | { type: "select_offer"; shopId: string; offerId: string }
  | { type: "toggle_external"; on: boolean }
  | { type: "reset" };

// ---------- badges ----------
export type EvidenceBadgeKind = "OFFICIAL_DATASET" | "EXTERNAL_FACT" | "EXTERNAL_OPINION" | "USER_REPORTED" | "DEMO_SIMULATION" | "SYSTEM_ESTIMATE" | "UNKNOWN";
export const BADGE_FA: Record<EvidenceBadgeKind, { label: string; help: string }> = {
  OFFICIAL_DATASET: { label: "داده‌ی رسمی ترب", help: "پیشنهاد/قیمت ثبت‌شده‌ی دیتاست؛ نه موجودی و نه قیمت امروز." },
  EXTERNAL_FACT: { label: "ادعای منبع بیرونی", help: "مشخصه یا ادعا از یک منبع بیرونی با نشانی و تاریخ بازیابی؛ نه تأیید مستقل." },
  EXTERNAL_OPINION: { label: "نظر (منبع بیرونی)", help: "نظر نویسنده‌ی منبع؛ حقیقت اندازه‌گیری‌شده نیست." },
  USER_REPORTED: { label: "گزارش شما", help: "چیزی که شما می‌گویید فروشنده گفته؛ تأییدنشده." },
  DEMO_SIMULATION: { label: "شبیه‌سازی — واقعی نیست", help: "نمونه‌ی ساختگی برای دمو." },
  SYSTEM_ESTIMATE: { label: "برآورد سیستم", help: "استنباط الگوریتمی از داده؛ قطعی نیست." },
  UNKNOWN: { label: "نامعلوم", help: "شاهدی در دست نیست." },
};

export type GeoEntityType = "MATCHED_OFFER_SELLER" | "CATEGORY_ACTIVITY_ONLY" | "VERIFIED_SHOPPING_DISTRICT" | "DATASET_DENSITY_ESTIMATE";
export const GEO_TYPE_FA: Record<GeoEntityType, string> = {
  MATCHED_OFFER_SELLER: "فروشگاه دارای پیشنهاد ثبت‌شده برای همین محصول",
  CATEGORY_ACTIVITY_ONLY: "فروشگاه فعال در همین دسته (پیشنهاد برای این محصول ثبت نشده)",
  VERIFIED_SHOPPING_DISTRICT: "منطقه‌ی خرید با منبع بررسی‌شده (فروشنده یا موجودی نیست)",
  DATASET_DENSITY_ESTIMATE: "برآورد از تراکم داده (اطمینان کم؛ فروشنده یا موجودی نیست)",
};

// ---------- cards (built by the SERVER from tool results) ----------
interface CardBase { id: string; badges: EvidenceBadgeKind[] }
export interface ProductCardView extends CardBase {
  type: "product";
  productId: string; title: string; categoryName: string; priceText: string; distinctSellers: number;
  reasons: string[]; cautions: string[]; rank: number | null;
  hrefs: { product: string; sellers: string };
  selected: boolean;
}
export interface SellerCardView extends CardBase {
  type: "seller";
  geoType: GeoEntityType; shopId: string; name: string; locationLabel: string | null; distanceText: string | null; priceText: string;
  variantStatus: "PLAUSIBLE" | "UNCERTAIN" | "CONFLICTING" | "UNSELECTED"; offerCount: number; offerId: string | null; hoursText: string;
  hrefs: { shop: string; inquiry: string | null };
  selected: boolean;
}
export interface ComparisonCardView extends CardBase {
  type: "comparison";
  verdictKind: string; headline: string; detail: string;
  rows: Array<{ shopId: string; offerId: string | null; name: string; rank: number | null; tier: "A" | "B" | "C" | "D"; priceText: string; comparability: string; hoursText: string; summary: string }>;
  hrefs: { compare: string };
}
export interface AreaCardView extends CardBase {
  type: "area";
  areaId: string; geoType: Extract<GeoEntityType, "VERIFIED_SHOPPING_DISTRICT" | "DATASET_DENSITY_ESTIMATE">; name: string; reason: string; confidenceText: string; sourcesText: string; verifiedAt: string; distanceText: string | null;
  hrefs: { map: string };
}
export interface EvidenceItemView {
  id: string; kind: "SPEC_CLAIM" | "EXPERT_REVIEW" | "USER_REVIEW_SUMMARY"; badge: "EXTERNAL_FACT" | "EXTERNAL_OPINION";
  sourceName: string; sourceHost: string; url: string | null; retrievedAt: string; publishedAt: string | null;
  matchText: string; summary: string; strengths: string[]; weaknesses: string[]; limitations: string[]; fixture: boolean;
  /** short VERBATIM source spans (source language), each with where it came from; ≤ 25 words for third-party text */
  quotes: Array<{ text: string; field: string | null }>; attribution: string | null;
  /** a human-verified link only: nothing from the page is reproduced */
  linkOnly: boolean;
}
export interface EvidenceCardView extends CardBase {
  type: "evidence";
  productId: string; status: "NO_EVIDENCE" | "PARTIAL" | "OK" | "DISABLED"; mode: "off" | "fixture" | "live"; items: EvidenceItemView[]; conflicts: string[]; notes: string[];
}
export interface InquiryCardView extends CardBase {
  type: "inquiry";
  shopId: string; offerId: string; draft: string; notSentText: string; hrefs: { workspace: string; mission: string };
}
export interface OutcomeCardView extends CardBase {
  type: "outcome";
  headline: string; claim: string; provenance: "USER_REPORTED" | "UNKNOWN"; flags: string[]; nextActions: Array<{ label: string; href: string | null }>;
}
export interface NoticeCardView extends CardBase { type: "notice"; tone: "info" | "warn" | "error"; text: string }
export type AgentCard = ProductCardView | SellerCardView | ComparisonCardView | AreaCardView | EvidenceCardView | InquiryCardView | OutcomeCardView | NoticeCardView;

// ---------- actions (server-built; validated route builders only) ----------
export type AgentAction =
  | { kind: "navigate"; label: string; href: string }
  | { kind: "control"; label: string; control: AgentControl }
  | { kind: "suggest"; label: string; message: string };

export interface ClarifyView { questionId: string; text: string; help: string | null; options: Array<{ id: string; label: string; hint: string | null; control: AgentControl }>; skip: AgentControl | null }

export const TOOL_NAMES = [
  "understand_or_clarify_need", "search_products", "advise_products", "get_product_details", "find_product_alternatives", "find_sellers_for_product",
  "compare_sellers", "get_shop_declared_hours", "recommend_shopping_areas", "compose_seller_inquiry", "summarize_user_reported_reply", "get_external_evidence",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const TOOL_LABEL_FA: Record<ToolName, string> = {
  understand_or_clarify_need: "فهم نیاز", search_products: "جست‌وجوی محصول", advise_products: "مشاور انتخاب", get_product_details: "مشخصات محصول", find_product_alternatives: "یافتن جایگزین",
  find_sellers_for_product: "یافتن فروشنده‌ی نزدیک", compare_sellers: "مقایسه‌ی فروشنده‌ها", get_shop_declared_hours: "ساعت اعلام‌شده", recommend_shopping_areas: "مناطق خرید",
  compose_seller_inquiry: "پیش‌نویس پرسش", summarize_user_reported_reply: "جمع‌بندی پاسخ شما", get_external_evidence: "شواهد بیرونی",
};

export type ToolStatus = "ok" | "not_found" | "unknown" | "ambiguous" | "no_comparable_offer" | "disabled" | "invalid_args" | "error";
export interface ToolTraceEntry { tool: ToolName | "unknown_tool"; status: ToolStatus; ms: number; argsSummary: string }

export interface ProviderInfo {
  id: "mock" | "openai-compatible" | "none" | "locked";
  /** shown in the UI: a mock is a deterministic offline planner, NOT a language model */
  labelFa: string;
  isLanguageModel: boolean;
  liveVerified: boolean;
  model: string | null;
}

export type FallbackReason = "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "PROVIDER_RATE_LIMITED" | "INVALID_PROVIDER_OUTPUT" | "TOOL_LOOP_LIMIT" | "GROUNDING_REJECTED" | "BUDGET_EXCEEDED";

export interface AgentTurnResponse {
  ok: true;
  state: AgentState;
  assistant: { text: string; groundingFallback: boolean };
  cards: AgentCard[];
  actions: AgentAction[];
  clarify: ClarifyView | null;
  trace: ToolTraceEntry[];
  provider: ProviderInfo;
  fallback: { used: boolean; reason: FallbackReason | null };
  notices: string[];
  durationMs: number;
}
export interface AgentErrorResponse { ok: false; error: "INVALID_INPUT" | "RATE_LIMITED" | "BUSY" | "AGENT_DISABLED" | "AGENT_LIVE_LOCKED" | "DATABASE_UNAVAILABLE" | "CROSS_SITE" | "INTERNAL"; messageFa: string; retryAfterSec?: number }

export interface AgentPublicStatus { enabled: boolean; provider: ProviderInfo; lockedReasonFa: string | null; evidenceMode: "off" | "fixture" | "live"; maxMessageChars: number }
export const FALLBACK_FA: Record<FallbackReason, string> = {
  PROVIDER_UNAVAILABLE: "مدل زبانی در دسترس نبود", PROVIDER_TIMEOUT: "مدل زبانی پاسخ نداد", PROVIDER_RATE_LIMITED: "مدل زبانی موقتاً محدود شد", INVALID_PROVIDER_OUTPUT: "خروجی مدل معتبر نبود",
  TOOL_LOOP_LIMIT: "چرخه‌ی ابزارها از حد مجاز گذشت", GROUNDING_REJECTED: "متن مدل ادعای پشتیبانی‌نشده داشت", BUDGET_EXCEEDED: "بودجه‌ی زمانی پاسخ تمام شد",
};

export function describeControl(c: AgentControl): string {
  const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
  switch (c.type) {
    case "set_budget": return c.max ? `بودجه: حداکثر ${fa(c.max)} تومان${c.min ? ` (از ${fa(c.min)})` : ""}` : c.min ? `بودجه: حداقل ${fa(c.min)} تومان` : "بودجه برداشته شد";
    case "set_radius": return `شعاع: ${c.radius >= 1000 ? `${fa(c.radius / 1000)} کیلومتر` : `${fa(c.radius)} متر`}`;
    case "set_origin": return `محله‌ی شروع: ${{ ferdowsi: "فردوسی", "sheikh-hadi": "شیخ هادی", baharestan: "بهارستان" }[c.id]}`;
    case "set_priority": return "اولویت مقایسه عوض شد";
    case "set_visit": return c.visit ? "زمان بازدید تنظیم شد" : "زمان بازدید برداشته شد";
    case "answer": return "پاسخ شما ثبت شد";
    case "skip_question": return "این پرسش رد شد (مطمئن نیستم)";
    case "select_product": return "محصول را انتخاب کردید";
    case "select_shops": return `${fa(c.shopIds.length)} فروشگاه برای مقایسه`;
    case "select_offer": return "پرسش از یک فروشگاه";
    case "toggle_external": return c.on ? "شواهد بیرونی فعال شد" : "شواهد بیرونی خاموش شد";
    case "reset": return "شروع از نو";
  }
}
