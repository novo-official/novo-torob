import type { VariantGroup } from "./advisor";
import type { EvidenceSource } from "./provenance";
import type { SellerOfferLine } from "./sellers";

/**
 * Phase 5 contracts — seller comparison as a TRUST mechanism.
 * Rule of thumb: declining to rank incomparable offers is better than a wrong "cheapest".
 */

// ---------- identity tiers ----------
/**
 * A  same model code evidenced in the offer title AND same unit AND no identity flag → the only tier that may receive an unconditional cheapest claim
 * B  likely same family/variant (same variant group, but model code not exact/absent) → claims must be qualified
 * C  evidenced MISMATCH (other unit, sibling model code, different pack quantity) → never ranked against A/B
 * D  identity unknown (no variant chosen, no usable evidence, no offer for the variant) → never ranked
 */
export type ComparisonTier = "A" | "B" | "C" | "D";
export const TIER_META: Record<ComparisonTier, { labelFa: string; descriptionFa: string; rankable: boolean }> = {
  A: { labelFa: "هم‌مدل و هم‌واحد (شاهد: عنوان)", descriptionFa: "کد مدل دقیقاً در عنوان پیشنهاد آمده و واحد قیمت یکی است؛ باز هم از روی عنوان فروشنده است، نه گواهی تطابق.", rankable: true },
  B: { labelFa: "احتمالاً هم‌نسخه (تأییدنشده)", descriptionFa: "هم‌گروه نسخه است ولی کد مدل دقیق یا کافی در عنوان نیست؛ ادعاها فقط به‌صورت مشروط بیان می‌شود.", rankable: true },
  C: { labelFa: "ناهم‌خوان (مدل/واحد/بسته)", descriptionFa: "واحد قیمت، کد مدل یا تعداد بسته فرق دارد؛ با بقیه رتبه‌بندی نمی‌شود.", rankable: false },
  D: { labelFa: "هویت نامشخص", descriptionFa: "برای مقایسه‌ی منصفانه شاهد کافی نیست؛ رتبه‌بندی نمی‌شود.", rankable: false },
};

export type IdentityEvidenceCode =
  | "EXACT_MODEL_KEY"
  | "FAMILY_KEY_ONLY"
  | "SAME_GROUP_NO_KEY"
  | "UNIT_MISMATCH"
  | "SIBLING_MODEL"
  | "UNRELATED_MODEL"
  | "NO_MODEL_KEY_VS_KEYED"
  | "PACK_QUANTITY_DIFFERS"
  | "IDENTITY_FLAG_CAP"
  | "VARIANT_NOT_SELECTED"
  | "NO_OFFER_FOR_VARIANT";

export const IDENTITY_EVIDENCE_FA: Record<IdentityEvidenceCode, string> = {
  EXACT_MODEL_KEY: "کد مدل انتخابی دقیقاً در عنوان این پیشنهاد آمده است.",
  FAMILY_KEY_ONLY: "کد مدل هم‌خانواده است ولی عیناً یکسان نیست.",
  SAME_GROUP_NO_KEY: "فقط شناسه‌ی محصول یکی است؛ عنوان کد مدل مشخصی ندارد.",
  UNIT_MISMATCH: "واحد قیمت (متری/حلقه/بسته) با نسخه‌ی انتخابی فرق دارد.",
  SIBLING_MODEL: "کد مدل شبیه ولی متفاوت است (احتمالاً نسخه‌ی دیگر).",
  UNRELATED_MODEL: "کد مدل با نسخه‌ی انتخابی ارتباطی ندارد.",
  NO_MODEL_KEY_VS_KEYED: "عنوان کد مدلی ندارد که با نسخه‌ی انتخابی سنجیده شود.",
  PACK_QUANTITY_DIFFERS: "تعداد در بسته با پیشنهادهای دیگر فرق دارد یا ذکر نشده است.",
  IDENTITY_FLAG_CAP: "پرچم کیفیت داده درباره‌ی هویت مدل/واحد دارد؛ بیش از «احتمالاً هم‌نسخه» نمی‌شود.",
  VARIANT_NOT_SELECTED: "نسخه‌ی دقیق هنوز انتخاب نشده است.",
  NO_OFFER_FOR_VARIANT: "این فروشگاه برای نسخه‌ی انتخابی پیشنهادی ثبت نکرده است.",
};

export interface ComparableOfferIdentity {
  offerId: string;
  productId: string;
  shopId: string;
  /** RAW seller title — never rewritten */
  rawSellerTitle: string;
  variantGroupId: string;
  /** model keys extracted from the title (heuristic, uppercase) */
  modelKeys: string[];
  /** the selected group's key this offer was compared against (null when none) */
  referenceModelKey: string | null;
  unitHint: "per_metre" | "roll_or_pack" | "unknown";
  unitOfSaleFa: string;
  /** only when an explicit pack count (e.g. «۲ عددی») appears in the title; NEVER inferred from the price */
  packQuantity: { value: number; evidence: string } | null;
  tier: ComparisonTier;
  evidence: IdentityEvidenceCode[];
  /** where the offer comes from: always the Torob hackathon dataset (registered offer, not stock) */
  source: Pick<EvidenceSource, "sourceType" | "sourceName" | "claimType" | "scopeLimits"> & { file: "offers.csv"; row: number | null };
}

// ---------- price ----------
export type PriceComparability =
  | "TRUSTED"            // priced, no blocking flags, fresh (per snapshot rule), timestamp known, tier A/B, not unusual
  | "CAUTION"            // valid but unusual vs peers — shown, never declared cheapest
  | "STALE"              // older than 90 days before the data snapshot
  | "NO_TIMESTAMP"       // price without a (valid) recorded time
  | "OUTLIER_OR_INVALID" // peer/category outlier, absurd, malformed, unsafe integer, duplicate
  | "NO_PRICE"           // null price = UNKNOWN (never zero)
  | "IDENTITY_BLOCKED";  // tier C/D: price exists but is not comparable with the others

export const COMPARABILITY_FA: Record<PriceComparability, string> = {
  TRUSTED: "قیمت قابل‌اتکا برای مقایسه",
  CAUTION: "قیمت غیرعادی نسبت به همتایان — کنار گذاشته شد",
  STALE: "قیمت قدیمی — فقط نمایش",
  NO_TIMESTAMP: "زمان ثبت قیمت نامعلوم — فقط نمایش",
  OUTLIER_OR_INVALID: "قیمت پرت یا نامعتبر — فقط نمایش",
  NO_PRICE: "قیمتی ثبت نشده (نامعلوم، نه صفر)",
  IDENTITY_BLOCKED: "با سایر پیشنهادها هم‌واحد/هم‌مدل نیست",
};

export type PriceCaution = "FAR_BELOW_PEERS" | "FAR_ABOVE_PEERS";

export interface PriceEvidenceView {
  offerId: string | null;
  /** integer Toman when safe; null when absent or unusable */
  priceToman: number | null;
  /** exactly what the dataset holds (string), shown next to the parsed number */
  priceRaw: string | null;
  /** true when the raw value exceeds safe/plausible integers (never ranked) */
  priceUnsafe: boolean;
  recordedAt: string | null;
  recordedAtKnown: boolean;
  /** elapsed whole Tehran calendar days between the recorded date and TODAY */
  ageDaysToday: number | null;
  /** elapsed whole days between the recorded date and the DATASET SNAPSHOT (what the stale flag measures) */
  ageDaysAtSnapshot: number | null;
  staleBySnapshotRule: boolean;
  comparability: PriceComparability;
  cautions: PriceCaution[];
  flags: string[];
  /** ratio to the median of trusted peers of the selected variant (null if fewer than 5 peers) */
  ratioToPeerMedian: number | null;
}

// ---------- hours / payment / warranty ----------
export type HoursAtVisit = {
  state: "WITHIN_DECLARED" | "OUTSIDE_DECLARED" | "UNKNOWN";
  /** Persian wording — always «طبق اعلام فروشگاه» */
  labelFa: string;
  atTehran: string;
  window: { start: string; end: string } | null;
  reasonCode: string;
};

export interface PaymentView {
  declared: boolean;
  providers: Array<{ name: string; channel: "in_person" | "online" | "unknown" }>;
  /** "in_person" when at least one provider is declared for in-person payment */
  bucket: "IN_PERSON_DECLARED" | "DECLARED_CHANNEL_UNKNOWN" | "UNDECLARED";
  labelFa: string;
}

export interface WarrantyView {
  kind: "MONTHS" | "DESCRIPTION" | "NONE_DECLARED" | "TEST_AT_DELIVERY" | "UNKNOWN";
  months: number | null;
  provider: string | null;
  description: string | null;
  labelFa: string;
}

export type BudgetStatus = "NOT_SET" | "WITHIN" | "OVER" | "UNKNOWN" | "NOT_COMPARABLE";

// ---------- ranking ----------
export type RankingPriority = "price" | "distance" | "hours" | "payment" | "warranty";
export const PRIORITY_FA: Record<RankingPriority, string> = {
  price: "قیمت قابل‌اتکا",
  distance: "نزدیکی (خط مستقیم)",
  hours: "باز بودن طبق ساعت اعلام‌شده",
  payment: "پرداخت حضوری اعلام‌شده",
  warranty: "گارانتی اعلام‌شده",
};
export const DEFAULT_PRIORITY_ORDER: readonly RankingPriority[] = ["price", "distance", "hours", "payment", "warranty"];

export type RankingReasonCode =
  | "LOWEST_TRUSTED_PRICE" | "PRICE_HIGHER_THAN_BEST" | "PRICE_TIE"
  | "PRICE_UNUSUALLY_LOW" | "PRICE_UNUSUALLY_HIGH" | "PRICE_STALE" | "PRICE_NO_TIMESTAMP" | "PRICE_INVALID_OR_OUTLIER" | "PRICE_MISSING"
  | "NEAREST" | "FARTHER_THAN_NEAREST" | "DISTANCE_UNKNOWN"
  | "HOURS_WITHIN" | "HOURS_OUTSIDE" | "HOURS_UNKNOWN"
  | "PAYMENT_IN_PERSON" | "PAYMENT_CHANNEL_UNKNOWN" | "PAYMENT_UNDECLARED"
  | "WARRANTY_DECLARED" | "WARRANTY_NONE_DECLARED" | "WARRANTY_UNKNOWN"
  | "IDENTITY_EXACT_KEY" | "IDENTITY_LIKELY_ONLY" | "IDENTITY_MISMATCH" | "IDENTITY_UNKNOWN"
  | "BUDGET_WITHIN" | "BUDGET_OVER" | "BUDGET_UNKNOWN"
  | "MULTIPLE_OFFERS_SAME_SHOP";

export const REASON_META: Record<RankingReasonCode, { polarity: "positive" | "negative" | "neutral"; meaningFa: string }> = {
  LOWEST_TRUSTED_PRICE: { polarity: "positive", meaningFa: "کمترین قیمت ثبت‌شده‌ی قابل‌اتکا میان فروشگاه‌های مقایسه‌شده" },
  PRICE_HIGHER_THAN_BEST: { polarity: "negative", meaningFa: "قیمت ثبت‌شده بالاتر از کمترین قیمت قابل‌اتکا (اختلاف نمایش داده می‌شود)" },
  PRICE_TIE: { polarity: "neutral", meaningFa: "قیمت ثبت‌شده برابر با فروشگاه دیگر است؛ برنده‌ی قیمتی اعلام نمی‌شود" },
  PRICE_UNUSUALLY_LOW: { polarity: "negative", meaningFa: "قیمت بسیار پایین‌تر از میانه‌ی همتایان است؛ ممکن است خطا یا کالای دیگر باشد، پس برنده حساب نمی‌شود" },
  PRICE_UNUSUALLY_HIGH: { polarity: "neutral", meaningFa: "قیمت بسیار بالاتر از میانه‌ی همتایان است" },
  PRICE_STALE: { polarity: "negative", meaningFa: "قیمت بیش از ۹۰ روز پیش از اسنپ‌شات داده ثبت شده" },
  PRICE_NO_TIMESTAMP: { polarity: "negative", meaningFa: "زمان ثبت قیمت معلوم نیست" },
  PRICE_INVALID_OR_OUTLIER: { polarity: "negative", meaningFa: "قیمت پرت، نامعتبر یا تکراری است" },
  PRICE_MISSING: { polarity: "neutral", meaningFa: "قیمتی ثبت نشده؛ نامعلوم است و صفر حساب نمی‌شود" },
  NEAREST: { polarity: "positive", meaningFa: "نزدیک‌ترین در خط مستقیم" },
  FARTHER_THAN_NEAREST: { polarity: "negative", meaningFa: "دورتر از نزدیک‌ترین فروشگاه (خط مستقیم)" },
  DISTANCE_UNKNOWN: { polarity: "neutral", meaningFa: "نقطه‌ی شروع انتخاب نشده یا مختصات معتبر نیست" },
  HOURS_WITHIN: { polarity: "positive", meaningFa: "در زمان بازدید داخل ساعت اعلام‌شده (باز بودن تأییدشده نیست)" },
  HOURS_OUTSIDE: { polarity: "negative", meaningFa: "در زمان بازدید خارج از ساعت اعلام‌شده" },
  HOURS_UNKNOWN: { polarity: "neutral", meaningFa: "ساعت کاری اعلام نشده؛ بسته حساب نمی‌شود" },
  PAYMENT_IN_PERSON: { polarity: "positive", meaningFa: "پرداخت حضوری اعلام‌شده" },
  PAYMENT_CHANNEL_UNKNOWN: { polarity: "neutral", meaningFa: "ارائه‌دهنده‌ی پرداخت اعلام شده ولی حضوری بودنش مشخص نیست" },
  PAYMENT_UNDECLARED: { polarity: "neutral", meaningFa: "پرداخت اعلام نشده (به معنی پشتیبانی‌نشدن نیست)" },
  WARRANTY_DECLARED: { polarity: "positive", meaningFa: "گارانتی اعلام‌شده" },
  WARRANTY_NONE_DECLARED: { polarity: "negative", meaningFa: "صریحاً «بدون گارانتی» اعلام شده" },
  WARRANTY_UNKNOWN: { polarity: "neutral", meaningFa: "گارانتی اعلام نشده؛ نبودنش نیست" },
  IDENTITY_EXACT_KEY: { polarity: "positive", meaningFa: "کد مدل انتخابی عیناً در عنوان است" },
  IDENTITY_LIKELY_ONLY: { polarity: "neutral", meaningFa: "فقط احتمالاً هم‌نسخه است؛ ادعاها مشروط‌اند" },
  IDENTITY_MISMATCH: { polarity: "negative", meaningFa: "مدل/واحد/بسته ناهم‌خوان است" },
  IDENTITY_UNKNOWN: { polarity: "negative", meaningFa: "هویت نسخه نامشخص است" },
  BUDGET_WITHIN: { polarity: "positive", meaningFa: "قیمت قابل‌اتکا داخل بودجه" },
  BUDGET_OVER: { polarity: "negative", meaningFa: "قیمت قابل‌اتکا بیش از بودجه" },
  BUDGET_UNKNOWN: { polarity: "neutral", meaningFa: "قیمت قابل‌اتکا نیست؛ نسبت به بودجه نامعلوم" },
  MULTIPLE_OFFERS_SAME_SHOP: { polarity: "neutral", meaningFa: "این فروشگاه چند پیشنهاد برای این محصول دارد؛ همه نمایش داده می‌شود" },
};

export interface RankingReason {
  code: RankingReasonCode;
  textFa: string;
  polarity: "positive" | "negative" | "neutral";
  /** the concrete numbers/ids the sentence is based on (reproducibility) */
  evidence: Record<string, string | number | boolean | null>;
}

export type PriceVerdictKind =
  | "CHEAPEST_CONFIRMED"      // all trusted prices are tier A and one is strictly lowest
  | "CHEAPEST_QUALIFIED"      // lowest among LIKELY-same offers (tier B present) — wording must be qualified
  | "NO_WINNER_TIE"
  | "NO_WINNER_INSUFFICIENT"  // fewer than 2 trusted comparable prices
  | "NO_WINNER_MISMATCH"      // pack quantity / unit differs among candidates
  | "NO_WINNER_WIDE_SPREAD"   // trusted prices differ by more than 3× — probably not the same item
  | "NO_WINNER_UNKNOWN_IDENTITY";

export interface PriceVerdict {
  kind: PriceVerdictKind;
  winnerShopId: string | null;
  /** next-best trusted price delta (Toman) for the winner, when a winner exists */
  marginToman: number | null;
  headlineFa: string;
  detailFa: string;
  /** an unusually low record was set aside while a trusted winner exists */
  setAsideShopIds: string[];
}

export interface SellerComparisonResult {
  shopId: string;
  name: string;
  locationLabel: string | null;
  lat: number | null;
  lon: number | null;
  /** 1-based among rankable sellers; null when not rankable (tier C/D) */
  rank: number | null;
  /** equal on every criterion except the id tie-break */
  tiedWithPrevious: boolean;
  tier: ComparisonTier;
  /** the offer used for ranking (null when the shop has no usable offer for the variant) */
  representative: ComparableOfferIdentity | null;
  /** EVERY offer of this shop for the product, kept separate, each with its own tier */
  offers: Array<{ identity: ComparableOfferIdentity; price: PriceEvidenceView; warranty: WarrantyView }>;
  price: PriceEvidenceView;
  budget: BudgetStatus;
  distanceMeters: number | null;
  /** null when there is no origin; false = farther than the chosen radius (still shown — the user picked this shop) */
  withinRadius: boolean | null;
  hours: HoursAtVisit;
  payment: PaymentView;
  warranty: WarrantyView;
  reasons: RankingReason[];
  /** one-sentence summary of why this seller sits where it sits under the chosen priority */
  summaryFa: string;
  stock: "unconfirmed";
}

export type ComparisonSituation =
  | "OK"
  | "NO_SELLERS_SELECTED"
  | "SINGLE_SELLER"
  | "VARIANT_UNCONFIRMED"
  | "NO_COMPARABLE_SELLERS"
  | "PRODUCT_NOT_FOUND";

export interface ComparisonCriteria {
  priority: RankingPriority;
  visitAtTehran: string;
  visitIsNow: boolean;
  origin: { source: "manual" | "gps"; lat: number; lon: number; label: string } | null;
  radiusMeters: number;
  budget: { min: number | null; max: number | null };
  /** strict = over-budget and unknown-price sellers are listed in separate groups instead of mixed in */
  strictBudget: boolean;
}

export interface ComparisonCandidate {
  shopId: string;
  name: string;
  locationLabel: string | null;
  distanceMeters: number | null;
  offerCount: number;
  variantMatchStatus: SellerOfferLine["variantMatch"];
}

export interface SellerComparisonResponse {
  state: "SELLER_COMPARISON";
  situation: ComparisonSituation;
  product: { id: string; title: string; categoryName: string } | null;
  variant: { selectedGroupId: string | null; selected: VariantGroup | null; groups: VariantGroup[]; needsConfirmation: boolean };
  criteria: ComparisonCriteria;
  /** rankable sellers in rank order, then non-rankable (C/D) in stable order */
  sellers: SellerComparisonResult[];
  verdict: PriceVerdict;
  /** with strictBudget: ids split so UNKNOWN is never silently YES or NO */
  budgetGroups: { within: string[]; over: string[]; unknown: string[] } | null;
  requestedShopIds: string[];
  /** nearby offer-linked sellers (same Selection) that can be added, nearest first */
  candidates: ComparisonCandidate[];
  notices: string[];
  /** dataset snapshot the stale rule is relative to, and the date "today" used for elapsed ages (Tehran) */
  time: { snapshotRef: string | null; todayTehran: string; staleRuleDays: number };
  selection: { productId: string; variantGroupId: string | null };
  engineVersion: string;
}

export const COMPARISON_VERSION = "cmp-2026.1";

export const COMPARE_LIMITS = { minSellers: 2, maxSellers: 4 } as const;
