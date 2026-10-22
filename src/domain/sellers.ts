import type { PriceStatus, PriceSummary, VariantGroup } from "./advisor";
import type { AreaRecommendation } from "./shopping-area";
import type { OpenStatus } from "./types";

/**
 * Phase 4 contracts: nearby sellers for ONE chosen product/variant.
 * Three result states are kept strictly separate (never merged into one count):
 *   MATCHED_OFFER_SELLERS      shops that recorded an offer for the selected product (+ compatible variant/unit)
 *   CATEGORY_ACTIVITY_ONLY     shops that list the category but have NO matching offer — exploratory, never counted as sellers
 *   SHOPPING_DISTRICT_SUGGESTION  an area lead (curated source or dataset density) — not an offer, not stock
 */
export type GeoResultState = "MATCHED_OFFER_SELLERS" | "CATEGORY_ACTIVITY_ONLY" | "SHOPPING_DISTRICT_SUGGESTION";

export interface NearbyOrigin {
  source: "manual" | "gps";
  lat: number;
  lon: number;
  label?: string;
}

/**
 * Variant status of an OFFER relative to the user's selected variant. "PLAUSIBLE" is a heuristic read of the seller
 * title (≈60% precision measured in Phase 3); nothing here is ever "confirmed identical".
 */
export type VariantMatchStatus = "PLAUSIBLE" | "UNCERTAIN" | "CONFLICTING" | "UNSELECTED";

export interface SellerOfferLine {
  offerId: string;
  /** RAW seller title */
  sellerTitle: string;
  variantMatch: VariantMatchStatus;
  variantEvidence: "model_key_match" | "product_id_only" | "unit_mismatch" | "sibling_model" | "unrelated_model" | "no_model_key" | "variant_not_selected";
  priceRaw: string | null;
  priceToman: number | null;
  unitHint: "per_metre" | "roll_or_pack" | "unknown";
  priceChangedAt: string | null;
  flags: string[];
  comparisonEligible: boolean;
}

export interface SellerPriceEvidence {
  status: "recorded" | "no_reliable_price";
  /** only comparison-eligible, plausibly-matching offers of THIS shop */
  min: number | null;
  max: number | null;
  eligibleOffers: number;
  newestAt: string | null;
  /** whole days between the newest recorded price change and the evaluation instant (null when unknown) */
  newestAgeDays: number | null;
  stale: boolean;
  /** why no reliable price (Persian), when status = no_reliable_price */
  noteFa: string | null;
}

export interface SellerMatch {
  shopId: string;
  name: string;
  locationLabel: string | null;
  address: string | null;
  lat: number;
  lon: number;
  /** straight-line metres from the chosen origin; null if no origin */
  distanceMeters: number | null;
  /** offers of THIS product at this shop (all variants kept separate) */
  offerIds: string[];
  offerCount: number;
  plausibleOfferCount: number;
  /** offers of this product at this shop that are hidden by the variant filter (kept distinct, never merged) */
  hiddenOfferCount: number;
  /** best variant status among this shop's visible offers */
  variantMatchStatus: VariantMatchStatus;
  offers: SellerOfferLine[];
  declaredSchedule: { status: OpenStatus; atTehran: string };
  payment: { declared: boolean; providers: string[] };
  priceEvidence: SellerPriceEvidence;
  locationEvidence: {
    source: "shops.csv lat/lon";
    /** other shops recorded at exactly the same coordinate (mall-level approximation) */
    sharedWithShops: number;
    noteFa: string;
  };
  /** stock is NEVER known from this dataset */
  stock: "unconfirmed";
}

export interface SellersCounts {
  /** distinct shops with ANY offer for this product_id regardless of variant status (the pool before variant filtering) */
  shopsAnyVariant: number;
  /** distinct shops with ≥1 visible offer, anywhere in the dataset */
  shopsTotal: number;
  shopsWithinRadius: number;
  /** after the optional filters (open now / reliable price / payment) */
  shopsAfterFilters: number;
  offersTotal: number;
  offersWithinRadius: number;
  /** shops hidden because their only offers are uncertain/conflicting variants (shown with showUncertain) */
  shopsHiddenUncertain: number;
  shopsHiddenConflicting: number;
}

export type SellersSort = "distance" | "price" | "recent";

export interface SellersFilters {
  radiusMeters: number;
  showUncertain: boolean;
  sort: SellersSort;
  openNow: boolean;
  reliablePriceOnly: boolean;
  paymentProvider: string | null;
}

export interface SellersResponse {
  /** which geographic state the main list belongs to */
  state: "MATCHED_OFFER_SELLERS";
  product: { id: string; title: string; categoryName: string; price: PriceSummary } | null;
  variant: {
    needsConfirmation: boolean;
    selectedGroupId: string | null;
    groups: VariantGroup[];
    /** true when the selected group is key-less, or no group is selected although several exist */
    unresolved: boolean;
  };
  origin: { source: "manual" | "gps"; lat: number; lon: number; label: string | null; defaulted: boolean } | null;
  filters: SellersFilters;
  sellers: SellerMatch[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  counts: SellersCounts;
  /** real matches beyond the radius (nearest first), populated when the radius is empty or on request */
  outsideRadius: SellerMatch[];
  /** radius options that would reveal ≥1 / ≥5 matching shops, computed from real matches */
  radiusHints: Array<{ radiusMeters: number; shops: number }>;
  /** origin is far (> 5 km) from every shop in the dataset sample → coverage warning, not a "no shops in Tehran" claim */
  outsideDatasetCoverage: boolean;
  /** distinguishes UI situations A/B (see docs/phase-4-sellers.md) */
  situation: "OK" | "NO_SHOP_IN_RADIUS" | "VARIANT_UNCONFIRMED" | "NO_RELIABLE_VARIANT_MATCH" | "NO_OFFERS";
  notices: string[];
  /** shopping-area leads, only for sparse/empty situations (never mixed into `sellers`) */
  areaLeads: AreaRecommendation[];
  /** the same Selection the Phase 3 → 4 handoff produced (echoed so Phase 5 can continue) */
  selection: { productId: string; variantGroupId: string | null; unitHint: string | null; priceStatus: PriceStatus };
}

export interface ActivityShop {
  shopId: string;
  name: string;
  locationLabel: string | null;
  lat: number;
  lon: number;
  distanceMeters: number | null;
  /** traceable dataset evidence */
  evidenceFa: string;
  /** NEVER true: activity is not possession */
  hasMatchingOffer: false;
}

export interface CategoryActivityResponse {
  state: "CATEGORY_ACTIVITY_ONLY";
  category: string;
  /** total shops listing the category with no offer for the selected product (anywhere) */
  total: number;
  withinRadius: number;
  shops: ActivityShop[];
  disclaimerFa: string;
}
