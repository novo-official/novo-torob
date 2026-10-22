import type { ComparisonTier, HoursAtVisit, PaymentView, WarrantyView } from "./comparison";
import { comparePrices, LIMITS, sanitizeText, type PriceDelta } from "./inquiry-parse";
import type { MissionState } from "./types";

/**
 * Phase 6 contracts: seller inquiry (stage 4). Three kinds of facts are NEVER conflated:
 *   DATASET_RECORDED  what the Torob hackathon dataset recorded (offer, price at a past time, declared hours)
 *   USER_REPORTED     what the USER says a seller told them (independent outreach; unverified)
 *   DEMO_SIMULATED    scripted sample text from the demo mode (fiction; never real, never exported as evidence)
 *   UNKNOWN           not known
 */
export type FactProvenance = "DATASET_RECORDED" | "USER_REPORTED" | "DEMO_SIMULATED" | "UNKNOWN";
export const PROVENANCE_FA: Record<FactProvenance, { label: string; help: string }> = {
  DATASET_RECORDED: { label: "ثبت‌شده در داده", help: "از دیتاست هکاتون؛ زمان قیمت لحظه‌ی ثبت داده است و موجودی را تأیید نمی‌کند." },
  USER_REPORTED: { label: "ثبت‌شده توسط شما؛ هنوز مستقلاً تأیید نشده", help: "چیزی که شما می‌گویید فروشنده گفته است؛ برنامه آن را تأیید نکرده است." },
  DEMO_SIMULATED: { label: "نمونه‌ی شبیه‌سازی‌شده — واقعی نیست", help: "متن ساختگی برای دمو؛ از هیچ فروشنده‌ای نیامده است." },
  UNKNOWN: { label: "نامعلوم", help: "اطلاعاتی در دست نیست." },
};

// ---------- context (resolved on the SERVER from the real DB; the client never supplies prices) ----------
export type CategoryProfileId = "cctv" | "headphones" | "generator" | "cable" | "footwear" | "powerbank" | "pump" | "generic";

export interface ContextFact { key: string; labelFa: string; valueFa: string; provenance: FactProvenance; noteFa?: string }

export interface InquiryContext {
  product: { id: string; title: string; categoryName: string; productHref: string };
  variant: { selectedGroupId: string | null; label: string | null; modelKey: string | null; unitHint: "per_metre" | "roll_or_pack" | "unknown"; needsConfirmation: boolean };
  shop: {
    id: string; name: string; locationLabel: string | null; address: string | null;
    /** names in the dataset are mostly pseudonymised — never present them as a real business name */
    pseudonymNoteFa: string;
    sharedCoordinates: number;
    website: { href: string; label: string } | null;
    instagram: { href: string; label: string } | null;
    shopHref: string;
  };
  offer: {
    id: string; sellerTitle: string; priceToman: number | null; priceRaw: string | null; recordedAt: string | null; recordedAtLabel: string | null;
    ageDaysToday: number | null; unitHint: "per_metre" | "roll_or_pack" | "unknown"; packQuantity: number | null;
    tier: ComparisonTier; identityEvidenceFa: string[]; comparabilityFa: string; warranty: WarrantyView; flags: string[];
    /** the offer is NOT part of the user's selected variant group (identity mismatch is kept, never silently swapped) */
    outsideSelectedVariant: boolean;
  };
  otherOffersOfShop: Array<{ offerId: string; sellerTitle: string; tier: ComparisonTier }>;
  payment: PaymentView;
  hours: HoursAtVisit;
  visit: { atTehran: string; isNow: boolean; input: string | null };
  category: CategoryProfileId;
  facts: ContextFact[];
  /** what is still unknown and must be confirmed with the seller */
  unknownsFa: string[];
  routes: { sellersHref: string; compareHref: string; discoverHref: string };
  /** explicit guarantee: no phone/contact field exists in this object */
  contactChannel: "NONE_VERIFIED";
}

export type InquiryContextError = "INVALID_ID" | "PRODUCT_NOT_FOUND" | "SHOP_NOT_FOUND" | "OFFER_NOT_FOUND" | "OFFER_MISMATCH" | "VARIANT_UNKNOWN" | "OFFER_REQUIRED";
export const CONTEXT_ERROR_FA: Record<InquiryContextError, { title: string; detail: string }> = {
  INVALID_ID: { title: "پیوند ناقص یا نامعتبر است", detail: "شناسه‌ی محصول، فروشگاه یا پیشنهاد معتبر نیست." },
  PRODUCT_NOT_FOUND: { title: "این محصول در داده پیدا نشد", detail: "برای شناسه‌ی داده‌شده محصولی نداریم؛ چیزی ساخته نشد." },
  SHOP_NOT_FOUND: { title: "این فروشگاه در داده پیدا نشد", detail: "برای شناسه‌ی داده‌شده فروشگاهی نداریم؛ چیزی ساخته نشد." },
  OFFER_NOT_FOUND: { title: "این پیشنهاد در داده پیدا نشد", detail: "پیشنهادی با این شناسه نداریم." },
  OFFER_MISMATCH: { title: "این پیشنهاد به این فروشگاه و محصول تعلق ندارد", detail: "برای جلوگیری از نمایش اطلاعات اشتباه، پرسش ساخته نشد. شناسه‌ها را دستی تغییر نداده‌اید؟ از فهرست فروشگاه‌ها دوباره شروع کنید." },
  VARIANT_UNKNOWN: { title: "نسخه‌ی انتخاب‌شده دیگر پیدا نشد", detail: "نسخه‌ای با این شناسه برای این محصول نداریم؛ نسخه را دوباره انتخاب کنید." },
  OFFER_REQUIRED: { title: "کدام پیشنهاد این فروشگاه؟", detail: "این فروشگاه چند پیشنهاد برای این محصول دارد؛ یکی را انتخاب کنید." },
};
export type InquiryContextResult =
  | { ok: true; context: InquiryContext }
  | { ok: false; error: InquiryContextError; candidates?: Array<{ offerId: string; sellerTitle: string; tier: ComparisonTier }>; recovery: { sellersHref: string; compareHref: string } };

// ---------- questions ----------
export type InquiryIntent = "exact_variant" | "stock_availability" | "fresh_price" | "warranty" | "installments" | "hours" | "locate_in_mall" | "category" | "custom";
export interface InquiryQuestion { id: string; intent: InquiryIntent; textFa: string; reasonFa: string; defaultOn: boolean; custom?: boolean }

// ---------- replies ----------
export type StockReport = "yes" | "no" | "unknown";
export type ModelReport = "same" | "different" | "unsure" | "not_asked";
export type WarrantyReport = "declared" | "none" | "not_asked";
export type PaymentReport = "in_person_ok" | "not_available" | "not_asked";
export type ReportedUnit = "same" | "per_metre" | "roll_or_pack" | "unknown";

export interface ReplyEvidence {
  id: string;
  provenance: "USER_REPORTED" | "DEMO_SIMULATED";
  /** sanitised, bounded; rendered as plain text only */
  rawText: string;
  stock: StockReport;
  reportedPriceToman: number | null;
  reportedUnit: ReportedUnit;
  model: ModelReport;
  warranty: { report: WarrantyReport; months: number | null };
  payment: PaymentReport;
  visitNote: string;
  /** user-entered (manual) or scripted label (demo). Never a fabricated wall-clock for demo replies. */
  receivedLabel: string | null;
  scenarioId: DemoScenarioId | null;
}

export type DemoScenarioId = "AVAILABLE" | "NOT_AVAILABLE" | "PRICE_CHANGED" | "VARIANT_DIFFERENT" | "WARRANTY_OR_PAYMENT_CHANGED" | "NO_RESPONSE";

// ---------- status machine ----------
export type InquiryStatus =
  | "DRAFT" | "COPIED" | "USER_MARKED_CONTACTED" | "USER_ENTERED_REPLY"
  | "USER_REPORTED_AVAILABLE" | "USER_REPORTED_UNAVAILABLE" | "NO_RESPONSE" | "CANCELLED" | "NEXT_ACTION_SELECTED";

export const STATUS_FA: Record<InquiryStatus, string> = {
  DRAFT: "پیش‌نویس", COPIED: "متن کپی شد (ارسال نشده)", USER_MARKED_CONTACTED: "شما می‌گویید پرسیده‌اید", USER_ENTERED_REPLY: "پاسخ ثبت‌شده توسط شما",
  USER_REPORTED_AVAILABLE: "گزارش شما: موجود است (تأییدنشده)", USER_REPORTED_UNAVAILABLE: "گزارش شما: موجود نیست", NO_RESPONSE: "پاسخی نیامده", CANCELLED: "لغو شد", NEXT_ACTION_SELECTED: "گام بعد انتخاب شد",
};

export type NextActionId = "RECONFIRM_BEFORE_VISIT" | "FIND_OTHER_SELLER" | "COMPARE_AGAIN" | "CLARIFY_VARIANT" | "FOLLOW_UP" | "ALTERNATIVE_PRODUCT" | "CHECK_VISIT_HOURS" | "AWAIT_REPLY";

export interface InquiryState {
  v: 1;
  status: InquiryStatus;
  /** the status before NEXT_ACTION_SELECTED / CANCELLED, so the user can go back */
  previous: InquiryStatus | null;
  questionIds: string[];            // enabled question ids in user order
  customQuestions: Array<{ id: string; textFa: string }>;
  draftOverride: string | null;      // user-edited final text (null = use the generated text)
  copiedAt: string | null;
  contactedAt: string | null;
  replies: ReplyEvidence[];
  nextAction: NextActionId | null;
  events: Array<{ type: InquiryEvent["type"]; at: string }>;
}

export type InquiryEvent =
  | { type: "SET_QUESTIONS"; ids: string[]; at: string }
  | { type: "ADD_CUSTOM"; id: string; textFa: string; at: string }
  | { type: "REMOVE_CUSTOM"; id: string; at: string }
  | { type: "EDIT_DRAFT"; text: string | null; at: string }
  | { type: "COPY"; at: string }
  | { type: "MARK_CONTACTED"; at: string }
  | { type: "ENTER_REPLY"; reply: ReplyEvidence; at: string }
  | { type: "REMOVE_REPLY"; id: string; at: string }
  | { type: "MARK_NO_RESPONSE"; at: string }
  | { type: "CANCEL"; at: string }
  | { type: "REOPEN"; at: string }
  | { type: "SELECT_NEXT_ACTION"; action: NextActionId; at: string }
  | { type: "RESET"; at: string };

export const initialInquiryState = (questionIds: string[]): InquiryState => ({
  v: 1, status: "DRAFT", previous: null, questionIds, customQuestions: [], draftOverride: null, copiedAt: null, contactedAt: null, replies: [], nextAction: null, events: [],
});

const statusAfterReply = (r: ReplyEvidence): InquiryStatus => (r.stock === "yes" ? "USER_REPORTED_AVAILABLE" : r.stock === "no" ? "USER_REPORTED_UNAVAILABLE" : "USER_ENTERED_REPLY");

/**
 * Pure reducer with guards. Idempotent (COPY twice, REOPEN when open, MARK_NO_RESPONSE twice are no-ops except the log),
 * retry-safe (a late reply after NO_RESPONSE is accepted), and only the USER's own events can create USER_* statuses.
 * Demo scripts never go through this reducer (see inquiry-demo.ts): they cannot change a manual inquiry.
 */
export function inquiryReducer(s: InquiryState, e: InquiryEvent, initialQuestionIds: string[] = []): InquiryState {
  const log = (st: InquiryState): InquiryState => ({ ...st, events: [...st.events, { type: e.type, at: e.at }].slice(-LIMITS.maxEvents) });
  if (e.type === "RESET") return initialInquiryState(initialQuestionIds);
  if (s.status === "CANCELLED") return e.type === "REOPEN" ? log({ ...s, status: s.previous ?? "DRAFT", previous: null }) : s;
  switch (e.type) {
    case "SET_QUESTIONS": return log({ ...s, questionIds: [...new Set(e.ids)].slice(0, 20), draftOverride: null, status: s.status === "COPIED" ? "DRAFT" : s.status });
    case "ADD_CUSTOM": {
      const text = sanitizeText(e.textFa, LIMITS.custom);
      if (!text || s.customQuestions.length >= LIMITS.maxCustomQuestions || s.customQuestions.some((c) => c.id === e.id)) return s;
      return log({ ...s, customQuestions: [...s.customQuestions, { id: e.id, textFa: text }], questionIds: [...s.questionIds, e.id], draftOverride: null, status: s.status === "COPIED" ? "DRAFT" : s.status });
    }
    case "REMOVE_CUSTOM": return log({ ...s, customQuestions: s.customQuestions.filter((c) => c.id !== e.id), questionIds: s.questionIds.filter((i) => i !== e.id), draftOverride: null });
    case "EDIT_DRAFT": return log({ ...s, draftOverride: e.text === null ? null : sanitizeText(e.text, LIMITS.draft), status: s.status === "COPIED" ? "DRAFT" : s.status });
    case "COPY": return s.status === "DRAFT" ? log({ ...s, status: "COPIED", copiedAt: e.at }) : s.status === "COPIED" ? { ...s, copiedAt: e.at } : s; // copying later never regresses a contacted/replied inquiry
    case "MARK_CONTACTED":
      return s.status === "DRAFT" || s.status === "COPIED" || s.status === "NO_RESPONSE" ? log({ ...s, status: "USER_MARKED_CONTACTED", contactedAt: e.at }) : s;
    case "ENTER_REPLY": {
      if (s.replies.some((r) => r.id === e.reply.id) || e.reply.provenance !== "USER_REPORTED") return s; // demo evidence can never enter a manual inquiry
      const reply: ReplyEvidence = { ...e.reply, rawText: sanitizeText(e.reply.rawText, LIMITS.reply), visitNote: sanitizeText(e.reply.visitNote, LIMITS.visitNote) };
      return log({ ...s, status: statusAfterReply(reply), contactedAt: s.contactedAt ?? e.at, replies: [...s.replies, reply].slice(-LIMITS.maxReplies), nextAction: null, previous: null });
    }
    case "REMOVE_REPLY": {
      const replies = s.replies.filter((r) => r.id !== e.id);
      const last = replies.at(-1);
      return log({ ...s, replies, status: last ? statusAfterReply(last) : s.contactedAt ? "USER_MARKED_CONTACTED" : s.copiedAt ? "COPIED" : "DRAFT", nextAction: null });
    }
    case "MARK_NO_RESPONSE": return s.status === "USER_MARKED_CONTACTED" || s.status === "COPIED" || s.status === "DRAFT" ? log({ ...s, status: "NO_RESPONSE", contactedAt: s.contactedAt ?? e.at }) : s;
    case "CANCEL": return log({ ...s, previous: s.status, status: "CANCELLED" });
    case "REOPEN": return s;
    case "SELECT_NEXT_ACTION": return s.status === "DRAFT" ? s : log({ ...s, previous: s.status === "NEXT_ACTION_SELECTED" ? s.previous : s.status, status: "NEXT_ACTION_SELECTED", nextAction: e.action });
  }
}

/** Where this inquiry sits in the Phase 1 mission machine (src/domain/mission-state.ts). */
export function missionStateFor(status: InquiryStatus, nextAction: NextActionId | null): MissionState {
  if (status === "DRAFT" || status === "COPIED" || status === "USER_MARKED_CONTACTED" || status === "CANCELLED") return "CONTACT_PREPARATION";
  if (status === "NEXT_ACTION_SELECTED") return nextAction === "FIND_OTHER_SELLER" ? "DISCOVER_SELLERS" : nextAction === "COMPARE_AGAIN" ? "COMPARE_SELLERS" : nextAction === "RECONFIRM_BEFORE_VISIT" || nextAction === "CHECK_VISIT_HOURS" ? "VISIT_PLAN" : "CONTACT_RESULT";
  return "CONTACT_RESULT";
}

// ---------- outcome ----------
export type OutcomeFlag = "STOCK_REPORTED_YES" | "STOCK_REPORTED_NO" | "PRICE_HIGHER" | "PRICE_LOWER" | "PRICE_SAME" | "PRICE_NOT_COMPARABLE" | "MODEL_DIFFERENT" | "MODEL_UNSURE" | "UNIT_DIFFERENT" | "WARRANTY_MISMATCH" | "PAYMENT_NOT_AVAILABLE" | "VISIT_OUTSIDE_DECLARED_HOURS" | "VISIT_HOURS_UNKNOWN";

export interface NextAction { id: NextActionId; labelFa: string; descriptionFa: string; href: string | null; primary: boolean }

/** Typed hand-off for Phase 8 (mission planning). Demo outcomes are NEVER exportable as evidence. */
export interface InquiryOutcome {
  mode: "MANUAL" | "DEMO";
  provenance: "USER_REPORTED" | "DEMO_SIMULATED" | "UNKNOWN";
  contextRef: { productId: string; variantGroupId: string | null; shopId: string; offerId: string };
  status: InquiryStatus;
  headlineFa: string;
  claimFa: string;
  flags: OutcomeFlag[];
  priceDelta: PriceDelta | null;
  /** a user-reported price/stock is NEVER applied to the canonical catalog or its ranking */
  affectsCanonicalRanking: false;
  /** true when the current evidence blocks "this is the item you wanted" */
  blocksExactConfirmation: boolean;
  nextActions: NextAction[];
  /** present only for MANUAL (user-reported); null for demo */
  missionEvidence: MissionEvidence | null;
}

export interface MissionEvidence {
  kind: "USER_REPORTED_SELLER_REPLY";
  shopId: string; productId: string; offerId: string;
  stock: StockReport; reportedPriceToman: number | null; recordedPriceToman: number | null;
  model: ModelReport; reportedAtLabel: string | null;
  verified: false;
}

const faPct = (n: number) => String(Math.abs(n)).replace(".", "٫");

export function deriveOutcome(ctx: InquiryContext, state: Pick<InquiryState, "status" | "replies" | "nextAction"> & { previous?: InquiryState["previous"] }, mode: "MANUAL" | "DEMO"): InquiryOutcome {
  const reply = state.replies.at(-1) ?? null;
  const flags: OutcomeFlag[] = [];
  const delta = reply ? comparePrices(ctx.offer.priceToman, reply.reportedPriceToman) : null;
  if (reply) {
    if (reply.stock === "yes") flags.push("STOCK_REPORTED_YES");
    if (reply.stock === "no") flags.push("STOCK_REPORTED_NO");
    if (reply.reportedPriceToman !== null) flags.push(delta ? (delta.direction === "higher" ? "PRICE_HIGHER" : delta.direction === "lower" ? "PRICE_LOWER" : "PRICE_SAME") : "PRICE_NOT_COMPARABLE");
    if (reply.model === "different") flags.push("MODEL_DIFFERENT");
    if (reply.model === "unsure") flags.push("MODEL_UNSURE");
    if (reply.reportedUnit !== "same" && reply.reportedUnit !== "unknown" && reply.reportedUnit !== ctx.offer.unitHint) flags.push("UNIT_DIFFERENT");
    const rec = ctx.offer.warranty.kind;
    if (reply.warranty.report === "none" && (rec === "MONTHS" || rec === "DESCRIPTION")) flags.push("WARRANTY_MISMATCH");
    if (reply.warranty.report === "declared" && rec === "MONTHS" && reply.warranty.months !== null && ctx.offer.warranty.months !== null && reply.warranty.months !== ctx.offer.warranty.months) flags.push("WARRANTY_MISMATCH");
    if (reply.payment === "not_available" && ctx.payment.bucket === "IN_PERSON_DECLARED") flags.push("PAYMENT_NOT_AVAILABLE");
  }
  if (ctx.hours.state === "OUTSIDE_DECLARED") flags.push("VISIT_OUTSIDE_DECLARED_HOURS");
  else if (ctx.hours.state === "UNKNOWN") flags.push("VISIT_HOURS_UNKNOWN");
  const blocks = flags.includes("MODEL_DIFFERENT") || flags.includes("UNIT_DIFFERENT") || flags.includes("MODEL_UNSURE");

  const actions: NextAction[] = [];
  const add = (id: NextActionId, labelFa: string, descriptionFa: string, href: string | null, primary = false) => actions.push({ id, labelFa, descriptionFa, href, primary });
  const noReply = state.status === "NO_RESPONSE" || (state.status === "NEXT_ACTION_SELECTED" && !reply && state.previous === "NO_RESPONSE");
  if (blocks) add("CLARIFY_VARIANT", "مدل/واحد دقیق را بپرسید", "تا مدل و واحد دقیق روشن نشود، «همین کالا» تأیید نمی‌شود؛ پرسش تکمیلی اضافه کنید.", null, true);
  if (flags.includes("STOCK_REPORTED_NO") || noReply || blocks) add("FIND_OTHER_SELLER", "دنبال فروشنده‌ی دیگری بگرد", "همان محصول و نسخه را نگه می‌دارد و فروشگاه‌های دیگر را نشان می‌دهد.", ctx.routes.sellersHref, !blocks);
  if (flags.includes("STOCK_REPORTED_NO")) add("ALTERNATIVE_PRODUCT", "محصول جایگزین", "به مشاور برمی‌گردد؛ موجودی هیچ محصول جایگزینی تأیید نشده است.", ctx.routes.discoverHref);
  if (flags.some((f) => f === "PRICE_HIGHER" || f === "PRICE_LOWER" || f === "PAYMENT_NOT_AVAILABLE" || f === "WARRANTY_MISMATCH")) add("COMPARE_AGAIN", "مقایسه‌ی دوباره", "به مقایسه برمی‌گردد؛ گزارش شما فقط یادداشت است و در رتبه‌بندی رسمی اثر نمی‌گذارد.", ctx.routes.compareHref, !blocks && !flags.includes("STOCK_REPORTED_NO"));
  if (flags.includes("STOCK_REPORTED_YES") && !blocks) add("RECONFIRM_BEFORE_VISIT", "پیش از رفتن دوباره تأیید بگیرید", "گزارش موجودی ادعای فروشنده است و ممکن است تا رسیدن شما عوض شود؛ قبل از حرکت دوباره بپرسید.", null, true);
  if (flags.includes("VISIT_OUTSIDE_DECLARED_HOURS")) add("CHECK_VISIT_HOURS", "زمان بازدید را تغییر دهید", "زمان انتخابی بیرون از ساعت اعلام‌شده است.", null);
  if (noReply) add("FOLLOW_UP", "پیام پیگیری کوتاه", "یک پیام کوتاه‌تر برای پیگیری آماده می‌شود (باز هم ارسال با خودتان است).", null, true);
  if (!reply && !noReply) add("AWAIT_REPLY", "منتظر پاسخ بمانید", "پس از پرسیدن از راه مستقل خودتان، پاسخ را اینجا ثبت کنید یا اگر جواب ندادند «پاسخی نیامد» را بزنید.", null, true);
  if (reply && !actions.length) add("FOLLOW_UP", "پرسش تکمیلی یا پیگیری", "پاسخ ثبت‌شده موجودی و قیمت را روشن نمی‌کند؛ یک پرسش تکمیلی بپرسید یا پیش از رفتن دوباره تأیید بگیرید.", null, true);
  if (reply && !actions.some((a) => a.primary)) actions[0] = { ...actions[0]!, primary: true };

  const prov: InquiryOutcome["provenance"] = !reply ? "UNKNOWN" : mode === "DEMO" ? "DEMO_SIMULATED" : "USER_REPORTED";
  const prefix = mode === "DEMO" ? "نتیجه‌ی شبیه‌سازی (فقط دمو): " : "";
  let headlineFa = "هنوز پاسخی ثبت نشده";
  let claimFa = "موجودی و قیمت امروز نامعلوم‌اند؛ فقط پیشنهاد ثبت‌شده در داده را دارید.";
  if (noReply) { headlineFa = "پاسخی نیامده"; claimFa = "بدون پاسخ، هیچ ادعایی درباره‌ی موجودی یا قیمت امروز نداریم."; }
  if (reply) {
    if (flags.includes("MODEL_DIFFERENT")) { headlineFa = "فروشنده مدل دیگری را اعلام کرده"; claimFa = "مدل پیشنهادشده با خواسته‌ی شما یکی نیست؛ تأیید «همین کالا» مسدود است."; }
    else if (flags.includes("UNIT_DIFFERENT")) { headlineFa = "واحد قیمت فرق دارد"; claimFa = "قیمت اعلام‌شده برای واحد دیگری است؛ با قیمت ثبت‌شده مقایسه نمی‌شود."; }
    else if (flags.includes("STOCK_REPORTED_NO")) { headlineFa = "طبق گزارش شما موجود نیست"; claimFa = "گزارش شما از پاسخ فروشنده؛ تأیید مستقل نشده."; }
    else if (flags.includes("STOCK_REPORTED_YES")) { headlineFa = "طبق گزارش شما موجود است"; claimFa = "این ادعای فروشنده طبق گزارش شماست («موجودی تأیید شد» نیست)؛ پیش از رفتن دوباره تأیید بگیرید."; }
    else { headlineFa = "پاسخ ثبت شد"; claimFa = "پاسخ شما ثبت شد و هنوز موجودی روشن نیست."; }
    if (delta && delta.direction !== "same") claimFa += ` قیمت گزارش‌شده ${delta.direction === "higher" ? "بالاتر" : "پایین‌تر"} از قیمت ثبت‌شده است (${faPct(delta.pct)}٪).`;
  }
  const evidence: MissionEvidence | null = mode === "MANUAL" && reply && reply.provenance === "USER_REPORTED"
    ? { kind: "USER_REPORTED_SELLER_REPLY", shopId: ctx.shop.id, productId: ctx.product.id, offerId: ctx.offer.id, stock: reply.stock, reportedPriceToman: reply.reportedPriceToman, recordedPriceToman: ctx.offer.priceToman, model: reply.model, reportedAtLabel: reply.receivedLabel, verified: false }
    : null;
  return {
    mode, provenance: prov, contextRef: { productId: ctx.product.id, variantGroupId: ctx.variant.selectedGroupId, shopId: ctx.shop.id, offerId: ctx.offer.id },
    status: state.status, headlineFa: prefix + headlineFa, claimFa, flags, priceDelta: delta, affectsCanonicalRanking: false, blocksExactConfirmation: blocks, nextActions: actions, missionEvidence: evidence,
  };
}
