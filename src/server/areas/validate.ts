import type { ShoppingArea } from "@/domain/shopping-area";
import { isInTehran } from "@/lib/geo";
import { toTehranLocal } from "@/server/domain/hours";
import { safePublicUrl } from "@/server/domain/text";

const CONFIDENCE = new Set(["high", "medium", "low"]);
const KIND = new Set(["street", "mall", "district"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** "today" is the Asia/Tehran calendar date (the product's declared timezone), not the UTC date */
export const tehranToday = (): string => toTehranLocal(new Date()).iso.slice(0, 10);
const TODAY = tehranToday;

/**
 * Hard rules for a ShoppingArea. A curated entry that fails ANY rule is rejected (never shown):
 *  - real, mappable coordinates inside the Tehran box
 *  - ≥1 source for the specialisation claim AND ≥1 source for the coordinates, each with a valid https URL
 *  - a verification date that is a real date and not in the future
 * Dataset-density entries need a dataset source instead of URLs.
 */
export function validateArea(a: ShoppingArea, today: string = TODAY()): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(a.id)) errors.push("invalid id");
  if (!a.nameFa?.trim()) errors.push("missing nameFa");
  if (!KIND.has(a.kind)) errors.push("invalid kind");
  if (!isInTehran(a.center?.lat, a.center?.lon)) errors.push("coordinates missing or outside Tehran");
  if (!a.coordinateBasisFa?.trim()) errors.push("missing coordinate basis");
  if (!a.areaLabelFa?.trim()) errors.push("missing area label");
  if (!Array.isArray(a.categoryTags) || a.categoryTags.length === 0) errors.push("no category tags");
  if (!a.recommendationReasonFa?.trim()) errors.push("missing reason");
  if (!a.disclaimerFa?.trim()) errors.push("missing disclaimer");
  if (!CONFIDENCE.has(a.confidence)) errors.push("invalid confidence");
  if (!ISO_DATE.test(a.verifiedAt) || Number.isNaN(Date.parse(a.verifiedAt))) errors.push("invalid verifiedAt");
  else if (a.verifiedAt > today) errors.push("verifiedAt is in the future");

  if (a.sourceType === "curated_external") {
    if (!a.sources?.length) errors.push("curated area without sources");
    for (const s of a.sources ?? []) {
      if (!s.url || !safePublicUrl(s.url) || !s.url.startsWith("https://")) errors.push(`invalid source url: ${String(s.url).slice(0, 60)}`);
      if (!s.title?.trim() || !s.publisher?.trim()) errors.push("source without title/publisher");
      if (s.publishedAt && (!ISO_DATE.test(s.publishedAt) || s.publishedAt > today)) errors.push("invalid source publishedAt");
    }
    if (!a.sources?.some((s) => s.supports === "claim")) errors.push("no source supports the specialisation claim");
    if (!a.sources?.some((s) => s.supports === "coordinates")) errors.push("no source supports the coordinates");
    if (a.confidence === "high" && (a.sources ?? []).filter((s) => s.supports === "claim").length < 2) errors.push("high confidence needs ≥2 independent claim sources");
  } else if (a.sourceType === "dataset_category_density") {
    if (!a.sources?.some((s) => s.supports === "dataset" && s.dataset?.files?.length)) errors.push("density area without dataset source");
    if (a.confidence === "high") errors.push("dataset density can never be 'high' confidence");
  } else errors.push("invalid sourceType");
  return errors;
}

export interface RegistryBuild {
  valid: ShoppingArea[];
  rejected: Array<{ id: string; errors: string[] }>;
}

/** Validates a curated list; also rejects duplicate ids and near-duplicate coordinates (< 60 m: same place listed twice). */
export function buildRegistry(list: ShoppingArea[], today?: string): RegistryBuild {
  const valid: ShoppingArea[] = [];
  const rejected: RegistryBuild["rejected"] = [];
  const ids = new Set<string>();
  for (const a of list) {
    const errors = validateArea(a, today);
    if (ids.has(a.id)) errors.push("duplicate id");
    if (!errors.length) {
      const dup = valid.find((v) => Math.abs(v.center.lat - a.center.lat) < 0.0005 && Math.abs(v.center.lon - a.center.lon) < 0.0006);
      if (dup) errors.push(`duplicate coordinates with ${dup.id}`);
    }
    if (errors.length) rejected.push({ id: a.id, errors });
    else {
      valid.push(a);
      ids.add(a.id);
    }
  }
  return { valid, rejected };
}
