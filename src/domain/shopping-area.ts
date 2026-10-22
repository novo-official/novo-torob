/**
 * Shopping-area leads (Phase 4). An area is a GEOGRAPHIC LEAD: where to look. It is never a product offer,
 * never real-time inventory and never a store confirmation.
 */
export type AreaSourceType = "curated_external" | "dataset_category_density";
export type AreaKind = "street" | "mall" | "district";
export type AreaConfidence = "high" | "medium" | "low";

export interface SourceRef {
  /** what the source supports: the market's specialisation claim, or the map coordinate */
  supports: "claim" | "coordinates" | "dataset";
  title: string;
  publisher: string;
  /** https URL (validated); absent only for dataset sources */
  url?: string;
  /** publication date if the page shows one (ISO date) */
  publishedAt?: string;
  /** the exact sentence/fact taken from the source (Persian, verbatim where possible) */
  quote?: string;
  /** dataset files/fields for dataset sources */
  dataset?: { files: string[]; fields: string[] };
}

export interface ShoppingArea {
  id: string;
  nameFa: string;
  kind: AreaKind;
  center: { lat: number; lon: number };
  /** radius of the dots we know about — NOT the extent of a public market */
  extent?: { radiusMeters: number; basisFa: string };
  /** how the centre was obtained (never presented as a street address) */
  coordinateBasisFa: string;
  /** location wording copied from the sources; never an invented street address */
  areaLabelFa: string;
  /** dataset category names this area is relevant to */
  categoryTags: string[];
  recommendationReasonFa: string;
  sourceType: AreaSourceType;
  sources: SourceRef[];
  /** ISO date on which a human checked the sources (curated) / dataset snapshot reference (density) */
  verifiedAt: string;
  confidence: AreaConfidence;
  disclaimerFa: string;
}

export interface AreaRecommendation {
  area: ShoppingArea;
  /** straight-line from the user's chosen origin, if any */
  distanceMeters: number | null;
  /** facts taken from sources/dataset (traceable) */
  evidence: Array<{ textFa: string; source: "source_ref" | "dataset" }>;
  /** judgements made by the system (clearly separate from evidence) */
  inference: Array<{ textFa: string }>;
  /** why this area matched the requested category */
  matchedCategories: string[];
  /** dataset density figures when available (shops listing / shops with recorded offers in the category) */
  density: { shopsListing: number; shopsWithOffers: number } | null;
}

export interface AreaRecommendationResult {
  areas: AreaRecommendation[];
  category: string | null;
  /** NO_CATEGORY: could not tell which category; NO_EVIDENCE_BACKED_AREA: category known but nothing supports an area */
  reason: "OK" | "NO_CATEGORY" | "NO_EVIDENCE_BACKED_AREA";
  /** entries of the curated registry that were rejected during validation (diagnostics only) */
  rejectedCurated: number;
}
