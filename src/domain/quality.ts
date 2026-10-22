/**
 * Quality-flag catalogue shared by the importer, repositories and UI.
 * Flags EXPLAIN data quality; they never delete or hide a row.
 */
export const RULES_VERSION = "qf-2026.1";

export type FlagSeverity = "info" | "warn" | "error";
export type FlagEntity = "offer" | "shop" | "product";

export interface FlagDef {
  code: string;
  entity: FlagEntity;
  severity: FlagSeverity;
  /** Persian, user-presentable. */
  reason: string;
  /** If true, an offer carrying this flag must not enter a numeric price ranking. */
  blocksComparison?: boolean;
}

const defs = [
  // ---- offers: price
  { code: "NULL_PRICE", entity: "offer", severity: "info", reason: "قیمت برای این پیشنهاد ثبت نشده است.", blocksComparison: true },
  { code: "PRICE_MALFORMED", entity: "offer", severity: "error", reason: "مقدار قیمت قابل‌خواندن نیست.", blocksComparison: true },
  { code: "NONPOSITIVE_PRICE", entity: "offer", severity: "error", reason: "قیمت صفر یا منفی ثبت شده است.", blocksComparison: true },
  { code: "PRICE_ABSURD_MAGNITUDE", entity: "offer", severity: "error", reason: "اندازه‌ی قیمت از هر کالای خرد منطقی بزرگ‌تر است.", blocksComparison: true },
  { code: "PRICE_PEER_OUTLIER_HIGH", entity: "offer", severity: "warn", reason: "قیمت بسیار بالاتر از سایر پیشنهادهای قابل‌مقایسه‌ی همین کالاست.", blocksComparison: true },
  { code: "PRICE_PEER_OUTLIER_LOW", entity: "offer", severity: "warn", reason: "قیمت بسیار پایین‌تر از سایر پیشنهادهای قابل‌مقایسه‌ی همین کالاست.", blocksComparison: true },
  { code: "PRICE_CATEGORY_OUTLIER_HIGH", entity: "offer", severity: "warn", reason: "قیمت نسبت به میانه‌ی دسته‌ی کالا بسیار بالاست و همتایی برای مقایسه نیست.", blocksComparison: true },
  { code: "PRICE_CATEGORY_OUTLIER_LOW", entity: "offer", severity: "warn", reason: "قیمت نسبت به میانه‌ی دسته‌ی کالا بسیار پایین است و همتایی برای مقایسه نیست.", blocksComparison: true },
  // ---- offers: time
  { code: "TIMESTAMP_MISSING", entity: "offer", severity: "warn", reason: "زمان آخرین تغییر قیمت ثبت نشده است." },
  { code: "TIMESTAMP_MALFORMED", entity: "offer", severity: "warn", reason: "زمان آخرین تغییر قیمت قابل‌خواندن نیست." },
  { code: "TIMESTAMP_FUTURE", entity: "offer", severity: "warn", reason: "زمان ثبت‌شده پس از زمان واردسازی داده است." },
  { code: "TIMESTAMP_STALE", entity: "offer", severity: "warn", reason: "قیمت قدیمی است (بیش از ۹۰ روز پیش از اسنپ‌شات داده)." },
  // ---- offers: identity
  { code: "VARIANT_MODEL_MISMATCH", entity: "offer", severity: "warn", reason: "کد مدل در عنوان فروشنده بسیار شبیه اما متفاوت با کد مدل محصول است؛ احتمالاً نسخه‌ی دیگری است.", blocksComparison: true },
  { code: "VARIANT_MODEL_UNCONFIRMED", entity: "offer", severity: "info", reason: "کد مدل عنوان فروشنده با کد مدل محصول قابل تطبیق نیست؛ هم‌مدل بودن تأیید نشده است." },
  { code: "UNIT_AMBIGUOUS", entity: "offer", severity: "warn", reason: "واحد قیمت (متری، حلقه/بسته، عددی) در پیشنهادهای این محصول یکسان نیست.", blocksComparison: true },
  { code: "EXACT_DUPLICATE_OFFER", entity: "offer", severity: "info", reason: "پیشنهاد تکراری دقیق (همان فروشگاه، محصول، قیمت و عنوان).", blocksComparison: true },
  { code: "MULTI_OFFER_SAME_SHOP_PRODUCT", entity: "offer", severity: "info", reason: "این فروشگاه برای این محصول چند پیشنهاد (احتمالاً نسخه‌های متفاوت) دارد." },
  { code: "PARSE_WARRANTY_INVALID", entity: "offer", severity: "warn", reason: "فیلد گارانتی قابل‌خواندن نیست." },
  // ---- shops
  { code: "HOURS_UNKNOWN", entity: "shop", severity: "warn", reason: "برنامه‌ی کاری ثبت نشده است؛ وضعیت باز/بسته نامشخص است." },
  { code: "HOURS_INVALID", entity: "shop", severity: "warn", reason: "برنامه‌ی کاری قابل‌خواندن نیست؛ نامشخص در نظر گرفته می‌شود." },
  { code: "HOURS_PLACEHOLDER_IGNORED", entity: "shop", severity: "info", reason: "شیفت‌های جای‌خالی ۰۰:۰۰ تا ۰۰:۰۰ نادیده گرفته شد (۲۴ ساعته نیست)." },
  { code: "HOURS_UNSUPPORTED_DAY", entity: "shop", severity: "info", reason: "برای برخی روزها وضعیت «پشتیبانی‌نشده» ثبت شده است؛ نامشخص در نظر گرفته می‌شود." },
  { code: "SHOP_NO_OFFERS", entity: "shop", severity: "info", reason: "این فروشگاه هیچ پیشنهادی ندارد؛ دسته‌ی فعالیت دلیل داشتن کالا نیست." },
  { code: "SHOP_SHARED_COORDINATES", entity: "shop", severity: "info", reason: "مختصات با فروشگاه‌های دیگر مشترک است (احتمالاً یک پاساژ)." },
  { code: "SHOP_COORDS_INVALID", entity: "shop", severity: "error", reason: "مختصات معتبر نیست." },
  { code: "PARSE_SHOP_JSON_INVALID", entity: "shop", severity: "warn", reason: "یکی از فیلدهای JSON فروشگاه قابل‌خواندن نیست." },
  // ---- products
  { code: "PARSE_SPECS_INVALID", entity: "product", severity: "warn", reason: "مشخصات محصول قابل‌خواندن نیست." },
  { code: "PARSE_IMAGES_INVALID", entity: "product", severity: "warn", reason: "فهرست تصاویر قابل‌خواندن نیست." },
] as const satisfies readonly FlagDef[];

export const FLAG_DEFS: readonly FlagDef[] = defs;
export type QualityFlagCode = (typeof defs)[number]["code"];
export const QUALITY_FLAG_CODES = defs.map((d) => d.code) as QualityFlagCode[];

const byCode = new Map<string, FlagDef>(FLAG_DEFS.map((d) => [d.code, d]));
export const flagDef = (code: string): FlagDef | undefined => byCode.get(code);

/** An offer may enter a numeric price ranking only if none of its flags blocks comparison. */
export function isComparisonEligible(codes: readonly string[]): boolean {
  return !codes.some((c) => byCode.get(c)?.blocksComparison);
}

/** Thresholds are documented heuristics, not global price bounds. */
export const THRESHOLDS = {
  /** Beyond any plausible retail price in Toman (10^13 ≈ ten trillion). */
  absurdMagnitudeToman: 1e13,
  staleDays: 90,
  peerMinCohort: 3,
  peerRatio: 20,
  categoryMinOffers: 50,
  categoryRatio: 1000,
  /** A price range is shown as one range only if max/min among comparable offers stays within this ratio. */
  priceSpreadReliableMax: 3,
} as const;

export const EVIDENCE_RULES_VERSION = "pe-2026.1";

export type PriceStatus = "reliable" | "wide_spread" | "mixed_units" | "no_eligible" | "no_price";
