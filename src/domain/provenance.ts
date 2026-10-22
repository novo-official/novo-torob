/**
 * Evidence-source contract (Phase 5 — DEFINITION ONLY; no external retrieval exists yet, Phase 7 may add adapters).
 * The categories are kept apart on purpose:
 *   - a customer review is an OPINION          - a manufacturer spec is a CLAIM
 *   - a Torob/dataset offer is a REGISTERED OFFER, never stock confirmation
 *   - a retailer's online listing is NOT local in-person inventory
 *   - a shopping-area note is a LOCATION lead, never an offer
 */
export type EvidenceSourceType = "torob_dataset" | "manufacturer" | "retailer" | "customer_review" | "expert_review" | "shopping_area";
export type EvidenceClaimType = "specification" | "opinion" | "registered_offer" | "location";
export type EvidenceConfidence = "high" | "medium" | "low";

export interface EvidenceSource {
  sourceType: EvidenceSourceType;
  sourceName: string;
  /** http(s) URL when the source is on the web and the URL was actually checked */
  sourceUrl?: string;
  /** when WE retrieved/checked it (ISO date or datetime) */
  retrievedAt: string;
  /** when the source says it was published, if known */
  publishedAt?: string;
  /** which catalog product/model this evidence was matched to, and how */
  match?: { productId?: string; modelKey?: string; method: "product_id" | "exact_model_key" | "title_similarity" | "manual"; note?: string };
  /** licence / attribution text the display must carry (e.g. ODbL, review site terms) */
  attribution?: string;
  evidenceConfidence: EvidenceConfidence;
  claimType: EvidenceClaimType;
  /** what this evidence does NOT establish (shown next to the claim) */
  scopeLimits: string[];
}

/** Which claim types each source type may legitimately carry. */
export const ALLOWED_CLAIMS: Record<EvidenceSourceType, readonly EvidenceClaimType[]> = {
  torob_dataset: ["registered_offer", "location", "specification"],
  manufacturer: ["specification"],
  retailer: ["registered_offer", "specification"],
  customer_review: ["opinion"],
  expert_review: ["opinion", "specification"],
  shopping_area: ["location"],
};

/** Scope limits every source of that type MUST declare (so the UI can never over-claim). */
export const REQUIRED_SCOPE_NOTES: Record<EvidenceSourceType, string> = {
  torob_dataset: "موجودی لحظه‌ای را تأیید نمی‌کند؛ زمان قیمت لحظه‌ی ثبت داده است.",
  manufacturer: "ادعای سازنده است، نه آزمون مستقل.",
  retailer: "فهرست آنلاین، موجودی حضوری فروشگاه را تأیید نمی‌کند.",
  customer_review: "نظر شخصی است، نه حقیقت اندازه‌گیری‌شده.",
  expert_review: "نظر کارشناس است و به نمونه‌ی آزموده‌شده محدود است.",
  shopping_area: "سرنخ مکانی است، نه پیشنهاد فروش یا موجودی.",
};

export interface EvidenceValidation { ok: boolean; errors: string[] }

/** ISO date(-time); years before 1990 are rejected (typically a Solar-Hijri date typed as Gregorian, e.g. 1405-07-30). */
const ISO = /^(19[9]\d|20\d{2})-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

/** Pure validation; `today` is injectable for tests. A source failing validation must never be displayed as evidence. */
export function validateEvidenceSource(s: EvidenceSource, today: string = new Date().toISOString().slice(0, 10)): EvidenceValidation {
  const errors: string[] = [];
  if (!(s.sourceType in ALLOWED_CLAIMS)) errors.push("invalid sourceType");
  else if (!ALLOWED_CLAIMS[s.sourceType].includes(s.claimType)) errors.push(`sourceType ${s.sourceType} cannot carry claimType ${s.claimType}`);
  if (!s.sourceName?.trim()) errors.push("missing sourceName");
  if (s.sourceType !== "torob_dataset" && !s.sourceUrl) errors.push("external evidence requires a verifiable sourceUrl");
  if (s.sourceUrl) {
    try {
      const u = new URL(s.sourceUrl);
      if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) errors.push("sourceUrl must be a plain https URL");
    } catch { errors.push("sourceUrl is not a URL"); }
  }
  if (!ISO.test(s.retrievedAt ?? "") || Number.isNaN(Date.parse(s.retrievedAt))) errors.push("invalid retrievedAt");
  else if (s.retrievedAt.slice(0, 10) > today) errors.push("retrievedAt is in the future");
  if (s.publishedAt !== undefined) {
    if (!ISO.test(s.publishedAt) || Number.isNaN(Date.parse(s.publishedAt))) errors.push("invalid publishedAt");
    else if (s.publishedAt.slice(0, 10) > today) errors.push("publishedAt is in the future");
  }
  if (!["high", "medium", "low"].includes(s.evidenceConfidence)) errors.push("invalid evidenceConfidence");
  if (!Array.isArray(s.scopeLimits) || s.scopeLimits.length === 0) errors.push("scopeLimits required");
  else if (s.sourceType in REQUIRED_SCOPE_NOTES && !s.scopeLimits.some((x) => x.trim().length > 3)) errors.push("scopeLimits must be meaningful");
  if ((s.claimType === "specification" || s.claimType === "opinion") && s.sourceType !== "torob_dataset" && !s.match) errors.push("product-level evidence needs a match (productId/modelKey + method)");
  if (s.match && !s.match.productId && !s.match.modelKey) errors.push("match needs productId or modelKey");
  if (s.match?.method === "title_similarity" && s.evidenceConfidence === "high") errors.push("title-similarity matches can never be 'high' confidence");
  return { ok: errors.length === 0, errors };
}

/** Semantic guard used by any future display code: may this evidence be phrased as stock availability? Never. */
export function canClaimStock(source: Pick<EvidenceSource, "sourceType">): false {
  void source;
  return false;
}

/** The ONLY evidence this dataset provides today (what Phase 5 attaches to every compared offer). */
export const DATASET_OFFER_SOURCE_NOTE = REQUIRED_SCOPE_NOTES.torob_dataset;
