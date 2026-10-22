/**
 * Phase 3 contracts: JSON-serialisable DTOs shared by server logic, route handlers and the UI.
 * Everything a client renders about a product comes from these, built server-side from the database —
 * the frontend never invents candidates, prices or reasons.
 */
import type { PriceStatus } from "./quality";

export type { PriceStatus };

// ---------- catalog cards ----------
export interface PriceSummary {
  status: PriceStatus;
  /** Persian one-liner that is always safe to show. */
  label: string;
  min: number | null;
  median: number | null;
  max: number | null;
  reliableCount: number;
  unitHint: "per_metre" | "roll_or_pack" | "unknown" | null;
  staleShare: number | null;
  spreadRatio: number | null;
  pricedOffers: number;
  totalOffers: number;
  /** Reliable-range offers that were left out, keyed by the quality flag that excluded them. */
  excluded: Record<string, number>;
}

export interface VariantSignals {
  /** offers whose model code is a near-identical but different identifier (probable other variant) */
  modelMismatch: number;
  /** offers whose model code cannot be matched to the product's */
  modelUnconfirmed: number;
  unitAmbiguous: number;
  noPrice: number;
  implausiblePrice: number;
  stale: number;
}

export interface ProductCard {
  id: string;
  title: string;
  categoryName: string;
  brandName: string | null;
  model: string | null;
  imageUrl: string | null;
  specCount: number;
  offerCount: number;
  /** distinct shops with a recorded offer — NOT a stock signal */
  distinctSellers: number;
  price: PriceSummary;
  variants: VariantSignals;
}

// ---------- intent & questions ----------
export interface BudgetRange {
  min: number | null;
  max: number | null;
}

export interface ProductIntent {
  /** free text typed by the user ("دوربین برای مغازه") */
  text: string;
  /** exact category_name, once chosen or detected */
  category: string | null;
  /** questionId → optionId */
  answers: Record<string, string>;
  /** questions the user explicitly skipped ("مطمئن نیستم") */
  skipped: string[];
  budget: BudgetRange;
  /** optional preferred brand names (normalized text match against title/brand) */
  brands: string[];
}

export interface AdvisorOption {
  id: string;
  label: string;
  hint?: string;
  /** number of catalog products in this category that satisfy this option with explicit evidence */
  evidenceCount?: number;
}

export interface AdvisorQuestion {
  id: string;
  text: string;
  help?: string;
  kind: "single" | "budget";
  /** hard: explicit contradiction removes a product; soft: only re-ranks */
  hardness: "hard" | "soft";
  stage: "initial" | "refine";
  options: AdvisorOption[];
}

export interface BudgetBand {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
  /** products in the category whose RELIABLE price range intersects this band */
  count: number;
}

// ---------- recommendation transparency ----------
export type AdvisorReasonCode =
  | "ATTR_MATCH" // verified by an explicit spec/title statement
  | "ATTR_MATCH_INFERRED" // consistent with the product type, not stated outright
  | "ATTR_MISMATCH" // soft mismatch (kept, ranked lower)
  | "ATTR_UNKNOWN" // catalog has no evidence either way (missing-evidence penalty)
  | "BUDGET_FIT"
  | "BUDGET_UNVERIFIED"
  | "TEXT_MATCH"
  | "BRAND_MATCH"
  | "SPEC_COVERAGE"
  | "PRICE_STALE"
  | "SELLER_COVERAGE";

export interface Evidence {
  kind: "spec" | "title" | "price" | "offers";
  /** e.g. the spec key */
  label: string;
  /** e.g. the spec value or title phrase, as recorded */
  text: string;
  confidence: "explicit" | "inferred";
}

export interface RecommendationReason {
  code: AdvisorReasonCode;
  effect: "match" | "mismatch" | "unknown" | "info";
  text: string;
  evidence: Evidence[];
}

export interface Candidate {
  rank: number;
  score: number;
  card: ProductCard;
  reasons: RecommendationReason[];
  /** things to double-check before relying on this recommendation */
  cautions: string[];
  budget: "in_budget" | "over_budget" | "under_budget" | "unverified" | "none";
}

// ---------- advisor response ----------
export interface CategoryChoice {
  category: string;
  label: string;
  productCount: number;
  /** a category-specific question schema exists */
  supported: boolean;
}

export interface Recovery {
  message: string;
  suggestions: Array<{ id: string; label: string; patch: Partial<Pick<ProductIntent, "budget" | "text" | "category">> & { dropAnswer?: string } }>;
}

export interface AdvisorResponse {
  stage: "need" | "clarify_category" | "question" | "results";
  intent: ProductIntent;
  progress: { current: number; total: number };
  category: { category: string; label: string; supported: boolean; productCount: number; autoSelected: boolean } | null;
  categoryChoices: CategoryChoice[];
  question: AdvisorQuestion | null;
  budgetBands: BudgetBand[];
  candidates: Candidate[];
  /** counts that explain how the list was narrowed */
  funnel: { inCategory: number; afterHardFilters: number; outOfBudget: number; budgetUnverified: number } | null;
  /** answers already given, with human labels (shown as editable chips) */
  answered: Array<{ questionId: string; questionText: string; optionLabel: string; hardness: "hard" | "soft" }>;
  /** questions the user can still answer to refine the list (shown on the results screen) */
  refinement: AdvisorQuestion[];
  recovery: Recovery | null;
  limitations: string[];
  hasMore: boolean;
}

// ---------- search ----------
export interface SearchResponse {
  query: string;
  valid: boolean;
  invalidReason?: "empty" | "only_stopwords" | "too_short";
  strategy: "columns" | "all_columns" | "partial" | "none";
  items: Array<{ card: ProductCard; score: number; match: "exact_model" | "offer_model" | "full" | "partial" }>;
  corrections: Array<{ from: string; to: string }>;
  expansions: Array<{ from: string; to: string[] }>;
  droppedStopWords: string[];
  categoryHints: string[];
  categoryFacets: Array<{ category: string; count: number }>;
  limit: number;
  offset: number;
  hasMore: boolean;
  recovery: Recovery | null;
}

// ---------- selection handed to Phase 4 ----------
export interface VariantGroup {
  /** stable id: "<unitHint>|<modelKey|any>" */
  id: string;
  label: string;
  unitHint: "per_metre" | "roll_or_pack" | "unknown";
  modelKey: string | null;
  offerCount: number;
  eligibleOffers: number;
  /** representative RAW seller title (never rewritten) */
  sampleTitle: string;
  flags: string[];
  price: PriceSummary;
}

export interface Selection {
  productId: string;
  productTitle: string;
  categoryName: string;
  /** chosen variant group, or null when the user has not narrowed it (Phase 4 must then ask) */
  variantGroupId: string | null;
  unitHint: VariantGroup["unitHint"] | null;
  priceStatus: PriceStatus;
  budget: BudgetRange;
  source: "advisor" | "search" | "compare";
}

// ---------- comparison ----------
export interface CompareRow {
  key: string;
  label: string;
  values: Array<string | null>;
  differs: boolean;
}

export interface CompareResponse {
  products: Array<{ card: ProductCard; attributes: Array<{ id: string; label: string; value: string | null; confidence: "explicit" | "inferred" | "unknown" }> }>;
  specRows: CompareRow[];
  sameCategory: boolean;
  notes: string[];
}

// ---------- typeahead ----------
export interface Suggestions {
  query: string;
  /** a typed prefix too short/general to suggest anything meaningful */
  tooShort: boolean;
  products: Array<{ id: string; title: string; categoryName: string }>;
  categories: Array<{ category: string; count: number }>;
  corrections: Array<{ from: string; to: string }>;
}
