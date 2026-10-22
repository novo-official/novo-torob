import type { FactProvenance, InquiryContext, InquiryContextError } from "./inquiry";
import type { RecoveryTrigger } from "./mission";

/** Phase 8 recovery plan: built on the SERVER from dataset facts + the user's own unverified report. Contains only ids and short Persian text. */
export interface RecoveryFact { labelFa: string; valueFa: string; provenance: FactProvenance }
export interface RecoverySeller {
  shopId: string;
  /** the single offer to attach when chosen (the best-identity offer of that shop for the SAME selected variant) */
  offerId: string;
  name: string;
  locationLabel: string | null;
  distanceMeters: number | null;
  tier: "A" | "B" | "C" | "D";
  priceToman: number | null;
  priceNoteFa: string;
  hoursState: "WITHIN_DECLARED" | "OUTSIDE_DECLARED" | "UNKNOWN";
  hoursLabelFa: string;
  budget: "NOT_SET" | "WITHIN" | "OVER" | "UNKNOWN" | "NOT_COMPARABLE";
  paymentLabelFa: string;
  warrantyLabelFa: string;
  /** trade-offs against the offer the user is leaving (all derived, each a plain sentence) */
  tradeoffsFa: string[];
  hrefs: { shop: string };
}
export interface RecoveryProduct { productId: string; title: string; priceText: string; distinctSellers: number; sameCategory: true; href: string }
export interface RecoveryVariant { groupId: string; label: string; offerCount: number; href: string }
export interface RecoveryArea { areaId: string; nameFa: string; geoType: "VERIFIED_SHOPPING_DISTRICT" | "DATASET_DENSITY_ESTIMATE"; reasonFa: string; confidenceFa: string; sourcesFa: string; verifiedAt: string; distanceMeters: number | null; mapHref: string }
export interface BudgetScenario {
  /** immutable dataset price of the offer the user is leaving */
  recordedToman: number | null;
  /** what the USER says the seller said (unverified) */
  reportedToman: number | null;
  deltaToman: number | null;
  deltaPct: number | null;
  budgetMaxToman: number | null;
  fitRecorded: "WITHIN" | "OVER" | "UNKNOWN";
  fitReported: "WITHIN" | "OVER" | "UNKNOWN";
  overByToman: number | null;
  /** how many OTHER real offers of the same variant are recorded within budget (dataset, not stock) */
  alternativesWithinBudget: number;
}
export interface NextInterval { atTehran: string; labelFa: string }
export interface RecoveryPlan {
  trigger: RecoveryTrigger;
  /** which facts are confirmed-by-dataset vs user-reported vs unknown */
  facts: RecoveryFact[];
  sellers: RecoverySeller[];
  variants: RecoveryVariant[];
  products: RecoveryProduct[];
  areas: RecoveryArea[];
  nextInterval: NextInterval | null;
  budgetScenario: BudgetScenario | null;
  /** coverage honesty: why a list might be short */
  coverageFa: string[];
  notesFa: string[];
  hrefs: { sellers: string; compare: string; product: string; discover: string };
}
export type RecoveryError = "INVALID_ID" | "PRODUCT_NOT_FOUND" | "SHOP_NOT_FOUND" | "OFFER_NOT_FOUND" | "OFFER_MISMATCH" | "VARIANT_UNKNOWN" | "OFFER_REQUIRED";
export type RecoveryResult = { ok: true; plan: RecoveryPlan } | { ok: false; error: RecoveryError };

export interface MissionFacts {
  product: { id: string; title: string; categoryName: string; productHref: string } | null;
  /** present only when a shop (and its offer) is selected: every fact re-derived from the dataset */
  context: InquiryContext | null;
  /** the mission's ids did not join in the dataset (forged / stale): nothing is shown as a fact */
  error: InquiryContextError | "PRODUCT_NOT_FOUND" | null;
  candidates?: Array<{ offerId: string; sellerTitle: string; tier: "A" | "B" | "C" | "D" }>;
  /** user-triggered external map link to the dataset's own (building-level) shop coordinates; never the user's position, never an ETA */
  shopMapHref: string | null;
  hrefs: { sellers: string; compare: string; discover: string };
}

