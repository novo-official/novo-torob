import type { Result } from "./errors";
import type {
  Evidence,
  Confidence,
  GeoPoint,
  NormalizedPrice,
  OpenStatus,
  Offer,
  PaymentInfo,
  Product,
  ProductId,
  QuestionIntent,
  RecordedSellerResponse,
  SellerQuestionDraft,
  Shop,
  ShopId,
  ShoppingMission,
  Toman,
  VariantIdentity,
} from "./types";

/**
 * Future tool interfaces (DESIGN ONLY in Phase 1 — there are no implementations).
 *
 * Division of labour:
 *  - The AI layer interprets intent and chooses which tools to call.
 *  - THESE tools (deterministic code) do all price comparison, distance maths,
 *    schedule checks and source validation. An LLM never computes them.
 *  - Every claim returned carries `Evidence` with provenance; no evidence, no claim.
 */

export interface UserLocation {
  /** Either a manually chosen neighbourhood label, or session-only coordinates. */
  region?: string;
  point?: GeoPoint; // session memory only; never persisted or put in URLs
}

// ---- searchProducts -------------------------------------------------------
export interface SearchProductsInput {
  query: string;
  category?: string;
  limit?: number;
}
export interface SearchProductsOutput {
  products: Array<{ product: Product; matchedBy: "model" | "title" | "brand" | "fuzzy" }>;
  needsVariantChoice: boolean;
}

// ---- adviseProducts -------------------------------------------------------
export interface AdviseProductsInput {
  useCase: string;
  budget?: { min?: Toman; max?: Toman };
  priorities?: string[];
  hardConstraints?: string[];
}
export interface AdviseProductsOutput {
  /** At most 1–3 questions when information is insufficient. */
  clarifyingQuestions: string[];
  candidates: Array<{
    product: Product;
    why: Evidence[]; // why it fits
    tradeOffs: Evidence[];
    unknowns: string[];
    confidence: Confidence;
  }>;
}

// ---- getProduct -----------------------------------------------------------
export interface GetProductOutput {
  product: Product;
  variants: VariantIdentity[];
}

// ---- findSellers ----------------------------------------------------------
export interface FindSellersInput {
  variant: VariantIdentity;
  where: UserLocation;
  radiusMeters?: number;
  includeSimilar?: boolean; // similar products are returned in a separate list
}
export interface SellerCandidate {
  shop: Shop;
  offers: Offer[];
  distanceMeters: number | null;
  /** Always "unconfirmed" in this dataset: offers never prove stock. */
  stock: "unconfirmed";
  match: VariantIdentity["matchConfidence"];
}
export interface FindSellersOutput {
  exact: SellerCandidate[];
  similar: SellerCandidate[];
  coverage: "inside" | "edge" | "outside";
}

// ---- compareOffers --------------------------------------------------------
export interface CompareOffersInput {
  candidates: ShopId[];
  variant: VariantIdentity;
  sortBy: "price" | "distance" | "balanced";
  at: string; // ISO; evaluated in Asia/Tehran
}
export interface ComparisonRow {
  shopId: ShopId;
  price: NormalizedPrice;
  distanceMeters: number | null;
  open: OpenStatus;
  warrantyText: string | null;
  payment: PaymentInfo;
  rank: number;
  why: Evidence[];
  tradeOffs: Evidence[];
}
export interface CompareOffersOutput {
  rows: ComparisonRow[];
  excluded: Array<{ shopId: ShopId; reason: NormalizedPrice["flags"][number] }>;
}

// ---- hours / payment ------------------------------------------------------
export interface GetShopDeclaredHoursInput {
  shopId: ShopId;
  at: string;
}
export type GetShopDeclaredHoursOutput = OpenStatus;
export type GetPaymentInfoOutput = PaymentInfo;

// ---- seller Q&A -----------------------------------------------------------
export interface PrepareSellerQuestionsInput {
  shopId: ShopId;
  productTitle: string;
  intents: QuestionIntent[];
}
export type PrepareSellerQuestionsOutput = SellerQuestionDraft;

export interface RecordSellerResponseInput {
  missionId: string;
  response: Omit<RecordedSellerResponse, "verified" | "provenance">;
}

// ---- alternatives & visit plan -------------------------------------------
export interface SuggestAlternativesInput {
  reason: "no_results" | "too_expensive" | "variant_mismatch" | "closed" | "out_of_coverage";
  mission: ShoppingMission;
}
export interface BuildVisitPlanInput {
  missionId: string;
  sellers: ShopId[];
  desiredTime: string;
  origin: UserLocation;
}
export interface VisitStop {
  shopId: ShopId;
  suggestedArrival: string;
  /** Straight-line (haversine) — not a walking-time claim. */
  distanceFromPreviousMeters: number;
  declaredClosingAt: string | null;
  checklist: string[]; // e.g. "پیش از رفتن موجودی را تأیید کنید"
}

export interface ShoppingTools {
  searchProducts(i: SearchProductsInput): Promise<Result<SearchProductsOutput>>;
  adviseProducts(i: AdviseProductsInput): Promise<Result<AdviseProductsOutput>>;
  getProduct(id: ProductId): Promise<Result<GetProductOutput>>;
  findSellers(i: FindSellersInput): Promise<Result<FindSellersOutput>>;
  compareOffers(i: CompareOffersInput): Promise<Result<CompareOffersOutput>>;
  getShopDeclaredHours(i: GetShopDeclaredHoursInput): Promise<Result<GetShopDeclaredHoursOutput>>;
  getPaymentInfo(shopId: ShopId): Promise<Result<GetPaymentInfoOutput>>;
  prepareSellerQuestions(i: PrepareSellerQuestionsInput): Promise<Result<PrepareSellerQuestionsOutput>>;
  recordSellerResponse(i: RecordSellerResponseInput): Promise<Result<ShoppingMission>>;
  suggestAlternatives(i: SuggestAlternativesInput): Promise<Result<AdviseProductsOutput>>;
  buildVisitPlan(i: BuildVisitPlanInput): Promise<Result<VisitStop[]>>;
}
