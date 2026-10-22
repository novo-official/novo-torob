import type { RankingPriority } from "./comparison";
import { initialInquiryState, inquiryReducer, STATUS_FA, type InquiryEvent, type InquiryState, type OutcomeFlag } from "./inquiry";
import { sanitizeText } from "./inquiry-parse";
import { MISSION_STATE_LABELS_FA } from "./mission-state";
import type { MissionState } from "./types";

/**
 * PHASE 8 — the purchase mission.
 *
 * A mission is the user's OWN plan: ids of dataset entities, their own preferences, their own manual observations and ticks.
 * It is never a source of facts: prices, hours, identity tiers are re-derived from the dataset every time it is opened.
 *
 *  - Pure + deterministic: `missionReducer(m, event, at)` has no clock, no storage, no network.
 *  - Contains NO: precise GPS, phone numbers, tokens, demo (simulated) replies, chain-of-thought.
 *  - `inquiries[].state` is the Phase 6 `InquiryState` reused as-is (same reducer, same USER_REPORTED guard).
 */
export const MISSION_VERSION = 1 as const;
export const MISSION_ID_RE = /^msn_[0-9a-f]{32}$/;
export const PRODUCT_ID_RE = /^product_[0-9a-f]{8,40}$/;
export const SHOP_ID_RE = /^shop_[0-9a-f]{8,40}$/;
export const OFFER_ID_RE = /^offer_[0-9a-f]{8,40}$/;
export const VISIT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const DISTRICTS = ["ferdowsi", "sheikh-hadi", "baharestan"] as const;
export type District = (typeof DISTRICTS)[number];

export const MISSION_LIMITS = { need: 200, note: 400, timeline: 80, inquiries: 6, shortlist: 4, candidates: 6, history: 12 } as const;

export type MissionStatus = "ACTIVE" | "VISITED" | "ABANDONED";

// ---------- checklist ----------
export type ChecklistItemId = "confirm_model" | "ask_stock_price" | "ask_warranty_payment" | "contact_result" | "check_hours" | "verify_location" | "open_map";
/** which facts an item's tick depends on: a tick made for another shop/offer/visit time is IGNORED (not deleted) */
export type ChecklistScope = "offer" | "visit";
export interface ChecklistDef { id: ChecklistItemId; scope: ChecklistScope; required: boolean; titleFa: string; whyFa: string }
export const CHECKLIST: readonly ChecklistDef[] = [
  { id: "confirm_model", scope: "offer", required: true, titleFa: "مدل دقیق، نسخه/مشخصات، تعداد و واحد فروش را با فروشنده روشن کنید", whyFa: "شناسه‌ی محصول به‌تنهایی ثابت نمی‌کند که پیشنهاد همان نسخه‌ی فروشی است." },
  { id: "ask_stock_price", scope: "offer", required: true, titleFa: "موجودی واقعی و قیمت امروز را بپرسید", whyFa: "وجود پیشنهاد در داده موجودی نیست و قیمت ثبت‌شده قیمت امروز نیست." },
  { id: "ask_warranty_payment", scope: "offer", required: false, titleFa: "گارانتی و شیوه‌ی پرداخت (حضوری/اقساط) را در صورت نیاز روشن کنید", whyFa: "اگر در داده ثبت نشده باشد، «ثبت‌نشده» به معنی «نیست» نیست." },
  { id: "contact_result", scope: "offer", required: true, titleFa: "نتیجه‌ی پرسش خودتان از فروشنده را ثبت کنید (یا ردش کنید)", whyFa: "فقط پاسخی که خودتان گرفته‌اید و ثبت می‌کنید؛ تأییدنشده می‌ماند." },
  { id: "check_hours", scope: "visit", required: true, titleFa: "زمان مراجعه را با ساعت اعلام‌شده‌ی فروشگاه بسنجید", whyFa: "ساعت اعلام‌شده محاسبه‌ی برنامه است، نه تأیید زنده‌ی باز بودن." },
  { id: "verify_location", scope: "offer", required: true, titleFa: "نشانی (پاساژ/طبقه/واحد) را پیش از رفتن بررسی کنید", whyFa: "مختصات داده در سطح پاساژ/ساختمان است و طبقه یا واحد را نمی‌گوید." },
  { id: "open_map", scope: "offer", required: false, titleFa: "مسیر را روی نقشه ببینید", whyFa: "فقط پیوند نقشه برای مکان ثبت‌شده؛ زمان رسیدن یا مسیر بهینه محاسبه نمی‌شود." },
] as const;
export const checklistDef = (id: ChecklistItemId): ChecklistDef => CHECKLIST.find((c) => c.id === id)!;
export const CHECKLIST_IDS = CHECKLIST.map((c) => c.id) as readonly ChecklistItemId[];

export interface ChecklistMark { kind: "done" | "skipped"; at: string; key: string }

// ---------- recovery ----------
export type RecoveryTrigger = "UNAVAILABLE" | "PRICE_CHANGED" | "WRONG_MODEL" | "NO_REPLY" | "OUTSIDE_HOURS" | "PAYMENT_WARRANTY";
export const RECOVERY_TRIGGER_FA: Record<RecoveryTrigger, string> = {
  UNAVAILABLE: "طبق گزارش شما کالا موجود نیست",
  PRICE_CHANGED: "قیمتی که فروشنده گفته با قیمت ثبت‌شده فرق دارد",
  WRONG_MODEL: "فروشنده مدل/واحد دیگری را گفته",
  NO_REPLY: "پاسخی نیامده",
  OUTSIDE_HOURS: "زمان مراجعه بیرون از ساعت اعلام‌شده است",
  PAYMENT_WARRANTY: "گارانتی یا پرداخت با داده نمی‌خواند",
};
export type RecoveryResolution = "SWITCHED_SHOP" | "SWITCHED_PRODUCT" | "TIME_CHANGED" | "DISMISSED";
export interface RecoveryDecision { trigger: RecoveryTrigger; resolution: RecoveryResolution; at: string; shopId: string | null; offerId: string | null }

/** trigger → what the outcome flags / inquiry status / hours say. Pure; used by UI and tests. */
export function triggersOf(args: { flags: readonly OutcomeFlag[]; inquiryStatus: InquiryState["status"] | null; hoursState: "WITHIN_DECLARED" | "OUTSIDE_DECLARED" | "UNKNOWN" | null }): RecoveryTrigger[] {
  const f = new Set(args.flags);
  const out: RecoveryTrigger[] = [];
  if (f.has("STOCK_REPORTED_NO")) out.push("UNAVAILABLE");
  if (f.has("MODEL_DIFFERENT") || f.has("UNIT_DIFFERENT") || f.has("MODEL_UNSURE")) out.push("WRONG_MODEL");
  if (f.has("PRICE_HIGHER") || f.has("PRICE_LOWER")) out.push("PRICE_CHANGED");
  if (f.has("WARRANTY_MISMATCH") || f.has("PAYMENT_NOT_AVAILABLE")) out.push("PAYMENT_WARRANTY");
  if (args.inquiryStatus === "NO_RESPONSE") out.push("NO_REPLY");
  if (args.hoursState === "OUTSIDE_DECLARED") out.push("OUTSIDE_HOURS");
  return out;
}

// ---------- timeline ----------
/** DEMO_SIMULATED is deliberately NOT a member: a simulated message can never appear in a mission */
export type TimelineProvenance = "DATASET_RECORDED" | "USER_REPORTED" | "USER_ACTION" | "SYSTEM";
export interface TimelineEvent { rev: number; at: string; kind: string; provenance: TimelineProvenance; textFa: string; /** what the user can do next, derived from the mission AFTER this event */ nextFa?: string }

// ---------- the mission ----------
export interface InquiryRecord { shopId: string; offerId: string; state: InquiryState }
export interface ShoppingMissionV1 {
  v: typeof MISSION_VERSION;
  id: string;
  /** +1 on every ACCEPTED event; persistence uses it for compare-and-set (no lost updates between tabs/clicks) */
  rev: number;
  createdAt: string;
  updatedAt: string;
  status: MissionStatus;
  need: { text: string | null; category: string | null };
  candidates: string[];
  budget: { min: number | null; max: number | null };
  priority: RankingPriority;
  /** a NAMED district preset only; exact GPS / map points are never part of a mission */
  area: { district: District | null; radius: number };
  product: { productId: string; variantGroupId: string | null } | null;
  shop: { shopId: string; offerId: string } | null;
  shortlist: string[];
  /** Asia/Tehran wall clock «YYYY-MM-DDTHH:mm»; null = "now" */
  visit: string | null;
  inquiries: InquiryRecord[];
  checklist: Partial<Record<ChecklistItemId, ChecklistMark>>;
  recovery: { history: RecoveryDecision[]; dismissed: Array<{ trigger: RecoveryTrigger; key: string }> };
  /** present only when the user explicitly allowed notes to be kept */
  notes: string | null;
  timeline: TimelineEvent[];
}

export function createMission(id: string, at: string): ShoppingMissionV1 {
  return {
    v: MISSION_VERSION, id, rev: 0, createdAt: at, updatedAt: at, status: "ACTIVE", need: { text: null, category: null }, candidates: [], budget: { min: null, max: null },
    priority: "price", area: { district: null, radius: 1000 }, product: null, shop: null, shortlist: [], visit: null, inquiries: [], checklist: {},
    recovery: { history: [], dismissed: [] }, notes: null, timeline: [],
  };
}

/** 128-bit random id from the Web Crypto API (never Math.random, never derived from content). */
export function newMissionId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return `msn_${[...random(16)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------- keys (what a tick / dismissal / inquiry is bound to) ----------
export const offerKey = (m: Pick<ShoppingMissionV1, "product" | "shop">): string | null => (m.product && m.shop ? `${m.product.productId}|${m.product.variantGroupId ?? "-"}|${m.shop.shopId}|${m.shop.offerId}` : null);
export const markKey = (m: ShoppingMissionV1, scope: ChecklistScope): string | null => {
  const o = offerKey(m);
  return o ? (scope === "visit" ? `${o}|${m.visit ?? "now"}` : o) : null;
};
export const activeInquiry = (m: ShoppingMissionV1): InquiryState | null => (m.shop ? m.inquiries.find((i) => i.shopId === m.shop!.shopId && i.offerId === m.shop!.offerId)?.state ?? null : null);

export type ItemState = "done" | "skipped" | "pending";
/** effective state of a checklist item: a tick bound to another shop/offer/visit time does not count */
export function itemState(m: ShoppingMissionV1, id: ChecklistItemId): { state: ItemState; derived: boolean } {
  const def = checklistDef(id);
  const key = markKey(m, def.scope);
  if (id === "contact_result" && activeInquiry(m)?.replies.some((r) => r.provenance === "USER_REPORTED")) return { state: "done", derived: true };
  const mk = m.checklist[id];
  if (!key || !mk || mk.key !== key) return { state: "pending", derived: false };
  return { state: mk.kind, derived: false };
}

// ---------- readiness ----------
export interface ReadinessFacts {
  hoursState: "WITHIN_DECLARED" | "OUTSIDE_DECLARED" | "UNKNOWN" | null;
  /** the outcome blocks "this is the item you wanted" (different model / unit / unsure) */
  blocksExactConfirmation: boolean;
  triggers: RecoveryTrigger[];
}
export interface Readiness { ready: boolean; blockers: Array<{ code: string; textFa: string }>; caveats: string[]; remaining: ChecklistItemId[] }
export const READY_LABEL_FA = "آماده مراجعه (بررسی‌های لازم را مرور کرده‌اید؛ موجودی تأیید نشده است)";

export function readiness(m: ShoppingMissionV1, f: ReadinessFacts): Readiness {
  const blockers: Readiness["blockers"] = [];
  const caveats: string[] = ["موجودی و قیمت امروز تأییدشده نیست؛ پیش از رفتن دوباره بپرسید."];
  if (m.status !== "ACTIVE") blockers.push({ code: "NOT_ACTIVE", textFa: m.status === "VISITED" ? "این ماموریت به پایان رسیده است." : "این ماموریت رها شده است." });
  if (!m.product) blockers.push({ code: "NO_PRODUCT", textFa: "هنوز محصولی انتخاب نشده است." });
  else if (!m.shop) blockers.push({ code: "NO_SHOP", textFa: "هنوز فروشگاه/پیشنهادی انتخاب نشده است." });
  if (m.shop && !m.visit) blockers.push({ code: "NO_VISIT", textFa: "زمان مراجعه را مشخص کنید تا ساعت اعلام‌شده سنجیده شود." });
  if (f.blocksExactConfirmation) blockers.push({ code: "VARIANT_BLOCKED", textFa: "مدل/واحد دقیق روشن نیست؛ تأیید «همین کالا» مسدود است." });
  for (const t of f.triggers) if (t === "UNAVAILABLE" || t === "WRONG_MODEL" || t === "OUTSIDE_HOURS") if (!isDismissed(m, t)) blockers.push({ code: `TRIGGER_${t}`, textFa: RECOVERY_TRIGGER_FA[t] + " — ابتدا مسیر جایگزین را انتخاب کنید." });
  const remaining = m.shop ? CHECKLIST.filter((c) => c.required && itemState(m, c.id).state === "pending").map((c) => c.id) : [];
  if (remaining.length) blockers.push({ code: "CHECKLIST", textFa: `${remaining.length} بررسی لازم مانده است.` });
  if (f.hoursState === "UNKNOWN") caveats.push("ساعت کاری فروشگاه برای این زمان نامعلوم است (بسته حساب نشده).");
  if (f.triggers.includes("PRICE_CHANGED")) caveats.push("قیمت گزارش‌شده‌ی شما با قیمت ثبت‌شده فرق دارد؛ گزارش شما تأییدنشده است.");
  return { ready: blockers.length === 0, blockers, caveats, remaining };
}
export const isDismissed = (m: ShoppingMissionV1, trigger: RecoveryTrigger): boolean => {
  const k = offerKey(m);
  return !!k && m.recovery.dismissed.some((d) => d.trigger === trigger && d.key === k);
};

// ---------- phase (derived; never stored, so it can never disagree with the facts) ----------
export type MissionPhase = "NEED" | "PRODUCT" | "SELLERS" | "INQUIRY" | "AWAIT_REPLY" | "REPLIED" | "VISIT_READY" | "VISITED" | "ABANDONED";
export const PHASE_FA: Record<MissionPhase, string> = {
  NEED: "نیاز", PRODUCT: "انتخاب محصول", SELLERS: "انتخاب فروشنده", INQUIRY: "پرسش از فروشنده", AWAIT_REPLY: "منتظر پاسخ شما", REPLIED: "پاسخ ثبت‌شده", VISIT_READY: "آماده مراجعه", VISITED: "پایان", ABANDONED: "رهاشده",
};
export const PHASE_ORDER: readonly MissionPhase[] = ["NEED", "PRODUCT", "SELLERS", "INQUIRY", "REPLIED", "VISIT_READY", "VISITED"];

export function missionPhase(m: ShoppingMissionV1, ready: boolean): MissionPhase {
  if (m.status === "ABANDONED") return "ABANDONED";
  if (m.status === "VISITED") return "VISITED";
  if (!m.product) return m.need.text || m.need.category || m.candidates.length ? "PRODUCT" : "NEED";
  if (!m.shop) return "SELLERS";
  if (ready) return "VISIT_READY";
  const inq = activeInquiry(m);
  if (inq?.replies.length) return "REPLIED";
  if (inq && (inq.status === "USER_MARKED_CONTACTED" || inq.status === "NO_RESPONSE")) return "AWAIT_REPLY";
  return "INQUIRY";
}
/** bridge to the Phase 1 / Phase 6 mission-state machine (`missionStateFor` in inquiry.ts is used for the inquiry part) */
export function legacyStateOf(phase: MissionPhase): MissionState {
  switch (phase) {
    case "NEED": return "UNDERSTAND_NEED";
    case "PRODUCT": return "SELECT_PRODUCT";
    case "SELLERS": return "DISCOVER_SELLERS";
    case "INQUIRY": return "CONTACT_PREPARATION";
    case "AWAIT_REPLY": case "REPLIED": return "CONTACT_RESULT";
    default: return "VISIT_PLAN";
  }
}
export const legacyLabelFa = (phase: MissionPhase): string => MISSION_STATE_LABELS_FA[legacyStateOf(phase)];

/** a short «what next» sentence from the mission alone (no dataset facts needed); the UI shows a richer primary step */
export function nextHintFa(m: ShoppingMissionV1): string {
  if (m.status === "VISITED") return "ماموریت پایان یافته؛ اگر چیزی عوض شد دوباره بازش کنید.";
  if (m.status === "ABANDONED") return "ماموریت رها شده؛ می‌توانید دوباره بازش کنید.";
  if (!m.product) return "محصول را انتخاب کنید.";
  if (!m.shop) return "فروشگاه دارای پیشنهاد ثبت‌شده را انتخاب کنید.";
  const inq = activeInquiry(m);
  if (!inq || inq.status === "DRAFT" || inq.status === "COPIED") return "پرسش را بسازید و خودتان از فروشنده بپرسید.";
  if (!inq.replies.length) return "پاسخی را که گرفته‌اید ثبت کنید یا «پاسخی نیامد» را بزنید.";
  const left = CHECKLIST.filter((c) => c.required && itemState(m, c.id).state === "pending").length;
  return left ? `${left} بررسی لازم مانده است.` : "پیش از رفتن دوباره موجودی و قیمت امروز را بپرسید.";
}

// ---------- events ----------
export type MissionEvent =
  | { type: "SET_NEED"; text: string | null; category: string | null }
  | { type: "SET_CANDIDATES"; productIds: string[] }
  | { type: "SET_BUDGET"; min: number | null; max: number | null }
  | { type: "SET_AREA"; district: District | null; radius: number }
  | { type: "SET_PRIORITY"; priority: RankingPriority }
  | { type: "SELECT_PRODUCT"; productId: string; variantGroupId: string | null }
  | { type: "SELECT_VARIANT"; variantGroupId: string | null }
  | { type: "SHORTLIST"; shopIds: string[] }
  | { type: "SELECT_SHOP"; shopId: string; offerId: string; via: "USER" | "RECOVERY" }
  | { type: "SET_VISIT"; visit: string | null }
  | { type: "INQUIRY"; event: InquiryEvent; defaults?: string[] }
  | { type: "CHECK"; item: ChecklistItemId; kind: "done" | "skipped" }
  | { type: "UNCHECK"; item: ChecklistItemId }
  | { type: "RECOVERY_DECISION"; trigger: RecoveryTrigger; resolution: RecoveryResolution }
  | { type: "SET_NOTES"; text: string | null; consent: boolean }
  | { type: "MARK_VISITED" }
  | { type: "ABANDON" }
  | { type: "REOPEN" };

export type MissionRejection = "NO_PRODUCT" | "NO_SHOP" | "BAD_ID" | "BAD_VALUE" | "NOT_ACTIVE" | "NOT_READY" | "NOT_APPLICABLE";
export type MissionResult = { ok: true; mission: ShoppingMissionV1; changed: boolean } | { ok: false; error: MissionRejection; messageFa: string };
const rej = (error: MissionRejection, messageFa: string): MissionResult => ({ ok: false, error, messageFa });

const validMoney = (n: number | null) => n === null || (Number.isSafeInteger(n) && n > 0 && n <= 1e12);
const cleanIds = (xs: readonly string[], re: RegExp, max: number) => [...new Set(xs.filter((x) => re.test(x)))].slice(0, max);

/**
 * The single place a mission changes. Declarative invariants:
 *   - a shop/offer needs a product; a checklist tick needs a shop; the inquiry needs the active shop/offer
 *   - changing product/variant discards the seller-linked parts (shop, shortlist, inquiries, recovery); need/budget/area/visit/priority stay
 *   - changing shop/offer or visit time does NOT delete ticks: ticks are bound to a key and simply stop counting
 *   - only USER_REPORTED replies can enter (the Phase 6 reducer enforces it); there is no event that accepts a simulated reply
 *   - MARK_VISITED requires `ready` to have been computed by the caller from fresh facts (passed as `readyNow`)
 */
export function missionReducer(m: ShoppingMissionV1, e: MissionEvent, at: string, opts: { readyNow?: boolean } = {}): MissionResult {
  const done = (next: ShoppingMissionV1, kind: string, provenance: TimelineProvenance, textFa: string | null): MissionResult => {
    const rev = m.rev + 1;
    const after = { ...next, rev, updatedAt: at };
    const timeline = textFa ? [...next.timeline, { rev, at, kind, provenance, textFa, nextFa: nextHintFa(after) }].slice(-MISSION_LIMITS.timeline) : next.timeline;
    return { ok: true, changed: true, mission: { ...after, timeline } };
  };
  const same = (): MissionResult => ({ ok: true, changed: false, mission: m });
  if (m.status !== "ACTIVE" && e.type !== "REOPEN") return rej("NOT_ACTIVE", "این ماموریت بسته شده است؛ ابتدا آن را دوباره باز کنید.");

  switch (e.type) {
    case "SET_NEED": {
      const text = e.text === null ? null : sanitizeText(e.text, MISSION_LIMITS.need) || null;
      const category = e.category === null ? null : sanitizeText(e.category, 120) || null;
      if (text === m.need.text && category === m.need.category) return same();
      return done({ ...m, need: { text, category } }, "NEED", "USER_ACTION", "نیاز ثبت شد.");
    }
    case "SET_CANDIDATES": {
      const c = cleanIds(e.productIds, PRODUCT_ID_RE, MISSION_LIMITS.candidates);
      return JSON.stringify(c) === JSON.stringify(m.candidates) ? same() : done({ ...m, candidates: c }, "CANDIDATES", "SYSTEM", null);
    }
    case "SET_BUDGET": {
      if (!validMoney(e.min) || !validMoney(e.max) || (e.min !== null && e.max !== null && e.min > e.max)) return rej("BAD_VALUE", "بودجه معتبر نیست.");
      if (e.min === m.budget.min && e.max === m.budget.max) return same();
      return done({ ...m, budget: { min: e.min, max: e.max } }, "BUDGET", "USER_ACTION", "بودجه تغییر کرد (قیمت‌های ثبت‌شده‌ی داده دست‌نخورده ماند).");
    }
    case "SET_AREA": {
      if (e.district !== null && !DISTRICTS.includes(e.district)) return rej("BAD_VALUE", "محله معتبر نیست.");
      if (!Number.isInteger(e.radius) || e.radius < 100 || e.radius > 50_000) return rej("BAD_VALUE", "شعاع معتبر نیست.");
      if (e.district === m.area.district && e.radius === m.area.radius) return same();
      return done({ ...m, area: { district: e.district, radius: e.radius } }, "AREA", "USER_ACTION", "محله یا شعاع جست‌وجو تغییر کرد.");
    }
    case "SET_PRIORITY": return e.priority === m.priority ? same() : done({ ...m, priority: e.priority }, "PRIORITY", "USER_ACTION", null);
    case "SELECT_PRODUCT": {
      if (!PRODUCT_ID_RE.test(e.productId)) return rej("BAD_ID", "شناسه‌ی محصول معتبر نیست.");
      const variant = e.variantGroupId ? e.variantGroupId.slice(0, 120) : null;
      if (m.product?.productId === e.productId && m.product.variantGroupId === variant) return same();
      const sameProduct = m.product?.productId === e.productId;
      // another product (or another variant) invalidates everything that hangs on a seller of the old one
      return done(
        { ...m, product: { productId: e.productId, variantGroupId: variant }, shop: null, shortlist: [], inquiries: [], recovery: { ...m.recovery, dismissed: [] } },
        "PRODUCT", "USER_ACTION", sameProduct ? "نسخه‌ی محصول عوض شد؛ فروشنده‌ی قبلی کنار رفت چون ممکن است همان نسخه نباشد." : "محصول انتخاب شد.",
      );
    }
    case "SELECT_VARIANT": {
      if (!m.product) return rej("NO_PRODUCT", "ابتدا محصول را انتخاب کنید.");
      return missionReducer(m, { type: "SELECT_PRODUCT", productId: m.product.productId, variantGroupId: e.variantGroupId }, at, opts);
    }
    case "SHORTLIST": {
      if (!m.product) return rej("NO_PRODUCT", "ابتدا محصول را انتخاب کنید.");
      const ids = cleanIds(e.shopIds, SHOP_ID_RE, MISSION_LIMITS.shortlist);
      return JSON.stringify(ids) === JSON.stringify(m.shortlist) ? same() : done({ ...m, shortlist: ids }, "SHORTLIST", "USER_ACTION", `${ids.length} فروشگاه برای مقایسه انتخاب شد.`);
    }
    case "SELECT_SHOP": {
      if (!m.product) return rej("NO_PRODUCT", "ابتدا محصول را انتخاب کنید؛ فروشنده بدون محصول معنی ندارد.");
      if (!SHOP_ID_RE.test(e.shopId) || !OFFER_ID_RE.test(e.offerId)) return rej("BAD_ID", "شناسه‌ی فروشگاه یا پیشنهاد معتبر نیست.");
      if (m.shop?.shopId === e.shopId && m.shop.offerId === e.offerId) return same();
      const shortlist = m.shortlist.includes(e.shopId) ? m.shortlist : [e.shopId, ...m.shortlist].slice(0, MISSION_LIMITS.shortlist);
      return done({ ...m, shop: { shopId: e.shopId, offerId: e.offerId }, shortlist }, "SHOP", "USER_ACTION", e.via === "RECOVERY" ? "فروشنده‌ی جایگزین از مسیر بازیابی انتخاب شد؛ بررسی‌ها برای این پیشنهاد از اول شمرده می‌شوند." : "فروشگاه و پیشنهاد انتخاب شد.");
    }
    case "SET_VISIT": {
      if (e.visit !== null && !VISIT_RE.test(e.visit)) return rej("BAD_VALUE", "زمان مراجعه معتبر نیست.");
      if (e.visit === m.visit) return same();
      return done({ ...m, visit: e.visit }, "VISIT", "USER_ACTION", e.visit ? "زمان مراجعه تغییر کرد؛ ساعت اعلام‌شده دوباره سنجیده می‌شود." : "زمان مراجعه روی «همین حالا» برگشت.");
    }
    case "INQUIRY": {
      if (!m.shop) return rej("NO_SHOP", "ابتدا فروشگاه و پیشنهاد را انتخاب کنید.");
      const { shopId, offerId } = m.shop;
      const cur = activeInquiry(m) ?? initialInquiryState(e.defaults ?? []);
      const next = inquiryReducer(cur, e.event, e.defaults ?? []);
      if (next === cur && activeInquiry(m)) return same();
      const rest = m.inquiries.filter((i) => !(i.shopId === shopId && i.offerId === offerId));
      const inquiries = [...rest, { shopId, offerId, state: next }].slice(-MISSION_LIMITS.inquiries);
      const reply = e.event.type === "ENTER_REPLY";
      return done({ ...m, inquiries }, `INQUIRY_${e.event.type}`, reply ? "USER_REPORTED" : "USER_ACTION", reply ? "پاسخ فروشنده را شما ثبت کردید (گزارش شما؛ تأییدنشده)." : INQUIRY_TEXT[e.event.type] ?? null);
    }
    case "CHECK": {
      if (!m.shop) return rej("NO_SHOP", "ابتدا فروشگاه را انتخاب کنید.");
      if (!CHECKLIST_IDS.includes(e.item)) return rej("BAD_VALUE", "گزینه‌ی نامعتبر.");
      if (e.item === "contact_result" && e.kind === "done") return rej("NOT_APPLICABLE", "نتیجه‌ی پرسش با ثبت پاسخ خودتان شمرده می‌شود، نه با تیک.");
      const key = markKey(m, checklistDef(e.item).scope)!;
      const cur = m.checklist[e.item];
      if (cur && cur.key === key && cur.kind === e.kind) return same();
      return done({ ...m, checklist: { ...m.checklist, [e.item]: { kind: e.kind, at, key } } }, "CHECK", "USER_ACTION", e.kind === "done" ? `«${checklistDef(e.item).titleFa.slice(0, 40)}» را مرور کردید.` : `«${checklistDef(e.item).titleFa.slice(0, 40)}» را رد کردید.`);
    }
    case "UNCHECK": {
      if (!m.checklist[e.item]) return same();
      const { [e.item]: _removed, ...rest } = m.checklist;
      void _removed;
      return done({ ...m, checklist: rest }, "UNCHECK", "USER_ACTION", null);
    }
    case "RECOVERY_DECISION": {
      const key = offerKey(m);
      if (!key || !m.shop) return rej("NO_SHOP", "ابتدا فروشگاه را انتخاب کنید.");
      const history = [...m.recovery.history, { trigger: e.trigger, resolution: e.resolution, at, shopId: m.shop.shopId, offerId: m.shop.offerId }].slice(-MISSION_LIMITS.history);
      const dismissed = e.resolution === "DISMISSED" ? [...m.recovery.dismissed.filter((d) => !(d.trigger === e.trigger && d.key === key)), { trigger: e.trigger, key }] : m.recovery.dismissed;
      return done({ ...m, recovery: { history, dismissed } }, "RECOVERY", "USER_ACTION", `${RECOVERY_TRIGGER_FA[e.trigger]} — ${e.resolution === "DISMISSED" ? "ادامه با آگاهی از خطر" : "مسیر جایگزین انتخاب شد"}.`);
    }
    case "SET_NOTES": {
      const text = e.consent && e.text ? sanitizeText(e.text, MISSION_LIMITS.note) || null : null;
      return text === m.notes ? same() : done({ ...m, notes: text }, "NOTES", "USER_ACTION", null);
    }
    case "MARK_VISITED": {
      if (!m.shop) return rej("NO_SHOP", "ابتدا فروشگاه را انتخاب کنید.");
      if (!opts.readyNow) return rej("NOT_READY", "ماموریت هنوز «آماده مراجعه» نیست.");
      return done({ ...m, status: "VISITED" }, "VISITED", "USER_ACTION", "طبق گفته‌ی شما مراجعه انجام شد (برنامه چیزی را تأیید نمی‌کند).");
    }
    case "ABANDON": return done({ ...m, status: "ABANDONED" }, "ABANDON", "USER_ACTION", "ماموریت رها شد.");
    case "REOPEN": return m.status === "ACTIVE" ? same() : done({ ...m, status: "ACTIVE" }, "REOPEN", "USER_ACTION", "ماموریت دوباره باز شد.");
  }
}

const INQUIRY_TEXT: Partial<Record<InquiryEvent["type"], string>> = {
  COPY: "متن پرسش را کپی کردید (چیزی ارسال نشد).", MARK_CONTACTED: "طبق گفته‌ی شما خودتان از فروشنده پرسیدید.", MARK_NO_RESPONSE: "ثبت شد: پاسخی نیامد.", CANCEL: "پرسش لغو شد.", RESET: "پرسش و پاسخ‌ها پاک شد.",
};

/** apply several events atomically-in-order; stops at the first rejection (used by the "start from context" builders) */
export function applyAll(m: ShoppingMissionV1, events: MissionEvent[], at: string): MissionResult {
  let cur = m, changed = false;
  for (const e of events) {
    const r = missionReducer(cur, e, at);
    if (!r.ok) return r;
    cur = r.mission; changed ||= r.changed;
  }
  return { ok: true, mission: cur, changed };
}

// ---------- sanitized export (checklist for the USER; never a seller message) ----------
export interface ExportFacts { productTitle: string | null; shopName: string | null; priceText: string | null; priceNoteFa: string | null; hoursLabelFa: string | null; visitLabelFa: string | null; addressFa: string | null }
export function exportChecklistText(m: ShoppingMissionV1, f: ExportFacts, ready: Readiness): string {
  const mark = (id: ChecklistItemId) => { const s = itemState(m, id).state; return s === "done" ? "☑" : s === "skipped" ? "⊘" : "☐"; };
  const lines = [
    "فهرست آماده‌سازی مراجعه — هم‌قدم",
    "(برای استفاده‌ی خودتان؛ پیام به فروشنده نیست و چیزی ارسال نشده است)",
    "",
    `محصول: ${f.productTitle ?? "انتخاب نشده"}`,
    `فروشگاه (نام مستعار در داده): ${f.shopName ?? "انتخاب نشده"}`,
    `قیمت ثبت‌شده در داده: ${f.priceText ?? "ثبت نشده"}${f.priceNoteFa ? ` — ${f.priceNoteFa}` : ""}`,
    `زمان مراجعه: ${f.visitLabelFa ?? "همین حالا"}${f.hoursLabelFa ? ` — ${f.hoursLabelFa}` : ""}`,
    ...(f.addressFa ? [`نشانی ثبت‌شده: ${f.addressFa}`] : []),
    "",
    ...CHECKLIST.map((c) => `${mark(c.id)} ${c.titleFa}${c.required ? "" : " (اختیاری)"}`),
    "",
    ready.ready ? `وضعیت: ${READY_LABEL_FA}` : `وضعیت: هنوز آماده نیست — ${ready.blockers.map((b) => b.textFa).join(" ")}`,
    ...ready.caveats.map((c) => `• ${c}`),
    "",
    "منبع: قیمت و ساعت از دیتاست هکاتون (ثبت‌شده)؛ پاسخ‌ها اگر باشند «گزارش شما» و تأییدنشده‌اند.",
  ];
  return lines.join("\n");
}

// ---------- typed, read-only summary for a (future) agent. Carries provenance; excludes anything simulated. ----------
export interface MissionAgentSummary {
  kind: "MISSION_SUMMARY";
  source: "USER_PLAN";
  phase: MissionPhase;
  productId: string | null; variantGroupId: string | null; shopId: string | null; offerId: string | null;
  budget: { min: number | null; max: number | null }; district: District | null; radius: number; visit: string | null;
  inquiryStatus: keyof typeof STATUS_FA | null;
  /** only what the USER typed, flagged unverified */
  userReported: Array<{ stock: "yes" | "no" | "unknown"; reportedPriceToman: number | null; model: string; verified: false }>;
  checklist: Record<string, ItemState>;
  /** a model may READ this; it has no write path into a mission */
  writable: false;
}
export function summarizeMissionForAgent(m: ShoppingMissionV1, ready: boolean): MissionAgentSummary {
  const inq = activeInquiry(m);
  return {
    kind: "MISSION_SUMMARY", source: "USER_PLAN", phase: missionPhase(m, ready), productId: m.product?.productId ?? null, variantGroupId: m.product?.variantGroupId ?? null,
    shopId: m.shop?.shopId ?? null, offerId: m.shop?.offerId ?? null, budget: m.budget, district: m.area.district, radius: m.area.radius, visit: m.visit, inquiryStatus: inq?.status ?? null,
    userReported: (inq?.replies ?? []).filter((r) => r.provenance === "USER_REPORTED").map((r) => ({ stock: r.stock, reportedPriceToman: r.reportedPriceToman, model: r.model, verified: false as const })),
    checklist: Object.fromEntries(CHECKLIST_IDS.map((id) => [id, itemState(m, id).state])), writable: false,
  };
}
