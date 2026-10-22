import type { QualityFlagCode } from "./quality";

/**
 * Domain contracts (DESIGN ONLY in Phase 1).
 * No dataset is imported yet; these types fix the vocabulary used by docs, tools and UI.
 * Field names mirror the dataset audit (shops.csv / products.csv / offers.csv) where applicable.
 */

// ---------- Primitives ----------
export type ProductId = string; // "product_<hex>"
export type ShopId = string; // "shop_<hex>"
export type OfferId = string; // "offer_<hex>"
export type Toman = number; // integer, Iranian toman (dataset unit: price_toman)
export type IsoDateTime = string;

/** Where a value came from; shown to users for trust. */
export type Provenance =
  | { source: "dataset"; file: "shops" | "products" | "offers"; field: string }
  | { source: "derived"; method: string }
  | { source: "user_manual"; recordedAt: IsoDateTime }; // self-reported, never verified

// ---------- Catalog ----------
export interface Product {
  id: ProductId;
  title: string; // persian_title
  categoryName: string;
  brandName: string | null; // null for ~74% of products
  model: string | null; // null for ~98% of products — do NOT rely on it
  imageUrls: string[];
  specs: ProductSpec[]; // may be empty (~36% of products)
}

export interface ProductSpec {
  section: string;
  key: string;
  value: string;
}

/**
 * Normalized sellable identity. `product_id` alone does NOT guarantee identical variants:
 * seller titles may denote alternate models, and price units differ (piece / metre / roll).
 */
export interface VariantIdentity {
  productId: ProductId;
  /** Normalized model token(s), e.g. "HDW1200CLQP-IL-A"; null if undeterminable. */
  modelKey: string | null;
  unit: PriceUnit;
  /** Confidence that an offer's seller_title denotes this exact variant. */
  matchConfidence: "exact" | "probable" | "uncertain" | "mismatch";
}

export type PriceUnit = "piece" | "metre" | "roll" | "set" | "unknown";

// ---------- Shops & geography ----------
export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Shop {
  id: ShopId;
  name: string; // synthetic for ~98% of shops; see docs/requirements.md T7
  address: string | null;
  locationLabel: string | null; // e.g. "فردوسی" | "شیخ هادی" | "بهارستان"
  location: GeoPoint;
  categoryNames: string[]; // category is NOT proof of holding an item
  hours: DeclaredHours;
  payment: PaymentInfo;
  /** Dataset phone numbers are synthetic and are never actionable. */
  contactChannels: ContactChannel[];
  supportsFastDelivery: boolean | null;
  hasAnyOffer: boolean;
}

export type Weekday = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";

export interface TimeWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export type DayStatus =
  | { kind: "declared"; windows: TimeWindow[] } // real windows only (placeholder 00:00–00:00 stripped); end "24:00" = midnight, end < start = crosses midnight
  | { kind: "closed" }
  | { kind: "unsupported" }
  | { kind: "unknown" }; // missing schedule — NOT the same as closed

export interface DeclaredHours {
  /** false when the shop has no schedule at all (~31% of shops). */
  hasSchedule: boolean;
  days: Record<Weekday, DayStatus>;
}

export type OpenState = "open" | "closed" | "unknown";

export interface OpenStatus {
  state: OpenState;
  /** Always a *declared* status — the app never asserts real-time openness. */
  declared: true;
  nextChange?: { at: string; to: OpenState };
  reasonCode: "WITHIN_WINDOW" | "OUTSIDE_WINDOW" | "DAY_CLOSED" | "NO_SCHEDULE" | "UNSUPPORTED_DAY" | "NO_REAL_WINDOWS";
}

export type PaymentChannel = "in_person" | "online" | "unknown";

export interface PaymentProvider {
  providerName: string; // e.g. "ترب‌پی"
  channel: PaymentChannel;
}

export type PaymentInfo =
  | { declared: true; providers: PaymentProvider[] }
  | { declared: false }; // absent ≠ unsupported

export type ContactChannelKind = "phone" | "website" | "instagram";
export interface ContactChannel {
  kind: ContactChannelKind;
  value: string;
  /**
   * Only "verified" channels may be shown as actionable. Dataset phones are always "synthetic"
   * (and are never exposed by the repositories). Public web links from the dataset are
   * "unverified_public": https-validated, shown only as user-triggered links.
   */
  trust: "synthetic" | "unverified_public" | "verified";
}

// ---------- Offers & price quality ----------
export interface Offer {
  id: OfferId;
  productId: ProductId;
  shopId: ShopId;
  sellerTitle: string;
  priceToman: Toman | null; // null for ~4.5% (no price)
  lastPriceChangedAt: IsoDateTime | null;
  warranty: Warranty | null;
  description: string | null;
}

export interface Warranty {
  description: string | null;
  periodMonths: number | null;
  provider: string | null;
}

/** Implemented in Phase 2: see src/domain/quality.ts for the full catalogue and reasons. */
export type PriceQualityFlag = QualityFlagCode;

export interface NormalizedPrice {
  offerId: OfferId;
  rawToman: Toman | null;
  /** Price per comparable unit; null if not comparable. */
  comparableToman: Toman | null;
  unit: PriceUnit;
  ageDays: number | null;
  flags: PriceQualityFlag[];
  /** True only if the offer may enter a numeric price ranking. */
  comparisonEligible: boolean;
}

// ---------- Recommendation transparency ----------
export type ReasonCode =
  | "MATCHES_USE_CASE"
  | "WITHIN_BUDGET"
  | "SPEC_ADVANTAGE"
  | "WARRANTY_DECLARED"
  | "LOWER_PRICE"
  | "CLOSER"
  | "OPEN_DECLARED_NOW"
  | "PAYMENT_DECLARED"
  | "FRESH_PRICE"
  | "TRADE_OFF_HIGHER_PRICE"
  | "TRADE_OFF_FARTHER"
  | "UNKNOWN_HOURS"
  | "UNKNOWN_STOCK";

export interface Evidence {
  reason: ReasonCode;
  /** Persian sentence for the UI. */
  text: string;
  /** Dataset provenance. Required — no evidence, no claim. */
  provenance: Provenance[];
}

export interface Confidence {
  level: "high" | "medium" | "low";
  /** What is unknown (always includes stock unless confirmed manually). */
  unknowns: string[];
}

// ---------- Seller Q&A ----------
export type QuestionIntent =
  | "stock_availability"
  | "exact_variant"
  | "fresh_price"
  | "payment"
  | "warranty"
  | "hours"
  | "locate_in_mall"
  | "installments";

export interface SellerQuestionDraft {
  intents: QuestionIntent[];
  /** Persian text for the user to copy; NEVER auto-sent. */
  text: string;
  channel: ChannelAvailability;
}

export type ChannelAvailability =
  | { available: true; kind: ContactChannelKind; value: string } // verified only
  | { available: false; reason: "NO_VERIFIED_CHANNEL"; userMessage: string };

export interface RecordedSellerResponse {
  shopId: ShopId;
  intent: QuestionIntent;
  /** Free text typed by the user. */
  text: string;
  provenance: Extract<Provenance, { source: "user_manual" }>;
  /** Always false: nothing user-recorded is verified by the app. */
  verified: false;
}

// ---------- Mission ----------
export type MissionState =
  | "UNDERSTAND_NEED"
  | "EXPLORE_PRODUCTS"
  | "SELECT_PRODUCT"
  | "DISCOVER_SELLERS"
  | "COMPARE_SELLERS"
  | "CONTACT_PREPARATION"
  | "CONTACT_RESULT"
  | "VISIT_PLAN";

export interface ShoppingMission {
  id: string;
  state: MissionState;
  intent: string | null;
  useCase: string | null;
  budget: { min: Toman | null; max: Toman | null };
  priorities: string[];
  candidates: ProductId[];
  chosenVariant: VariantIdentity | null;
  region: string | null; // neighbourhood label; precise coordinates are NOT persisted
  radiusMeters: number | null;
  visitTime: IsoDateTime | null;
  selectedSellers: ShopId[];
  responses: RecordedSellerResponse[];
  unresolved: QuestionIntent[];
}
