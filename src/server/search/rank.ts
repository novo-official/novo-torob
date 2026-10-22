import { keysCompatible } from "@/server/domain/text";
import type { AnalyzedQuery } from "./analyze";

/**
 * Deterministic ranking. Relevance and exact model matching dominate; distinct seller coverage and the
 * existence of a reliable price are tie-breaker-sized signals (≤ 4 of ~170 points) and can never
 * lift an irrelevant product above a relevant one. Offer count alone is never a ranking signal.
 */
export const WEIGHTS = {
  exactModel: 100, // query model key equals a model key of the product's own title/model
  compatibleModel: 55, // prefix-family match (LC1D95 ⊂ LC1D95AM7)
  offerOnlyModel: 25, // model key only appears in seller titles of this product's offers
  titleCoverage: 25, // share of query groups present in the title
  categoryCoverage: 12, // share of groups present only in the category name ("هدفون" ⇒ headphone category)
  phrase: 10, // all content words contiguous in the title
  brand: 8,
  titleLead: 7, // the title STARTS with the query's head word ("گوشی سامسونگ …" beats "کیف … مناسب گوشی …")
  categoryLead: 7, // category name starts with the head word: main-product categories ("گوشی موبایل") vs accessory categories ("کیف و کاور گوشی")
  bm25: 12, // position in the FTS bm25 order, scaled 1..0
  sellers: 3, // log-scaled distinct seller coverage (secondary)
  reliablePrice: 1,
  partialPenalty: 18, // result came from the "one word dropped" fallback
} as const;

export interface RankFeatures {
  exactModel: boolean;
  compatibleModel: boolean;
  offerOnlyModel: boolean;
  titleCoverage: number;
  categoryCoverage: number;
  phrase: boolean;
  brand: boolean;
  titleLead: boolean;
  categoryLead: boolean;
  bm25Position: number; // 0..1, 1 = best
  distinctSellers: number;
  hasReliablePrice: boolean;
  partial: boolean;
}

export function score(f: RankFeatures): number {
  const s =
    (f.exactModel ? WEIGHTS.exactModel : f.compatibleModel ? WEIGHTS.compatibleModel : f.offerOnlyModel ? WEIGHTS.offerOnlyModel : 0) +
    WEIGHTS.titleCoverage * f.titleCoverage +
    WEIGHTS.categoryCoverage * f.categoryCoverage +
    (f.phrase ? WEIGHTS.phrase : 0) +
    (f.brand ? WEIGHTS.brand : 0) +
    (f.titleLead ? WEIGHTS.titleLead : 0) +
    (f.categoryLead ? WEIGHTS.categoryLead : 0) +
    WEIGHTS.bm25 * f.bm25Position +
    WEIGHTS.sellers * Math.min(1, Math.log2(1 + f.distinctSellers) / 4) +
    (f.hasReliablePrice ? WEIGHTS.reliablePrice : 0) -
    (f.partial ? WEIGHTS.partialPenalty : 0);
  return +s.toFixed(3);
}

export interface RankInput {
  titleNorm: string;
  brandNorm: string;
  categoryNorm: string;
  modelKeys: string;
  distinctSellers: number;
  hasReliablePrice: boolean;
}

const hasForm = (hay: string, form: string, prefix: boolean): boolean => {
  const h = ` ${hay} `;
  return h.includes(` ${form} `) || (prefix && h.includes(` ${form}`));
};

export function computeFeatures(q: AnalyzedQuery, p: RankInput, bm25Position: number, partial: boolean): RankFeatures {
  const pKeys = p.modelKeys ? p.modelKeys.split(" ") : [];
  const qKeys = q.modelKeys;
  const exactModel = qKeys.some((k) => pKeys.includes(k));
  const compatibleModel = !exactModel && qKeys.length > 0 && keysCompatible(qKeys, pKeys);
  // the product was retrieved for this model but the model is NOT in its own title/keys → it only appears in seller titles of its offers
  const modelInTitle = q.groups.filter((g) => g.kind === "model").some((g) => g.forms.some((f) => hasForm(p.titleNorm, f, false)));
  const offerOnlyModel = !exactModel && !compatibleModel && qKeys.length > 0 && !modelInTitle;

  let inTitle = 0;
  let inCategoryOnly = 0;
  let inBrand = false;
  q.groups.forEach((g, gi) => {
    const prefix = gi === q.groups.length - 1;
    const t = g.forms.some((f) => hasForm(p.titleNorm, f, prefix) || (g.kind === "model" && pKeys.includes(f.toUpperCase())));
    if (t) inTitle++;
    else if (g.forms.some((f) => hasForm(p.categoryNorm, f, prefix))) inCategoryOnly++;
    if (g.forms.some((f) => hasForm(p.brandNorm, f, false))) inBrand = true;
  });
  const n = Math.max(1, q.groups.length);
  const words = q.groups.filter((g) => g.kind !== "model").map((g) => g.source);
  const phrase = words.length > 1 && ` ${p.titleNorm} `.includes(` ${words.join(" ")} `);
  const head = q.groups[0];
  const lead = (hay: string) => !!head && head.kind !== "model" && head.forms.some((f) => hay === f || hay.startsWith(`${f} `));
  return {
    exactModel, compatibleModel, offerOnlyModel, titleLead: lead(p.titleNorm), categoryLead: lead(p.categoryNorm),
    titleCoverage: inTitle / n, categoryCoverage: inCategoryOnly / n,
    phrase, brand: inBrand, bm25Position, distinctSellers: p.distinctSellers, hasReliablePrice: p.hasReliablePrice, partial,
  };
}
