import type { DatabaseSync } from "node:sqlite";
import type { CategoryChoice } from "@/domain/advisor";
import { analyzeQuery, toFtsExpr } from "@/server/search/analyze";
import { getCategoryFacets } from "@/server/search/search";
import { getVocabulary } from "@/server/search/vocab";
import { categoryProductCount } from "./category-data";
import { SCHEMAS, schemaForCategory } from "./schemas";

export interface CategoryResolution {
  /** a category was decided without asking the user */
  auto: string | null;
  choices: CategoryChoice[];
  reason: "hint" | "dominant" | "ambiguous" | "none" | "invalid";
}

const choice = (db: DatabaseSync, category: string, count?: number): CategoryChoice => {
  const s = schemaForCategory(category);
  return { category, label: s?.label ?? category, productCount: count ?? categoryProductCount(db, category), supported: !!s };
};

/** The list shown at the very first step: categories that have a dedicated question schema. */
export function supportedChoices(db: DatabaseSync): CategoryChoice[] {
  return SCHEMAS.map((s) => choice(db, s.category));
}

/**
 * Decide which catalog category a free-text need belongs to — from data, not guesses:
 *  1) an explicit hint phrase ("دوربین مداربسته") maps to a verified category;
 *  2) otherwise the category distribution among FTS matches: ≥ 60 % in one category (and ≥ 10 products) wins;
 *  3) otherwise the user is asked to choose among the top categories.
 */
export function resolveCategory(db: DatabaseSync, text: string): CategoryResolution {
  const q = analyzeQuery(text, getVocabulary(db));
  if (!q.valid) return { auto: null, choices: supportedChoices(db), reason: "invalid" };

  for (const h of q.categoryHints) {
    if (categoryProductCount(db, h) > 0) return { auto: h, choices: [], reason: "hint" };
  }
  let facets = getCategoryFacets(db, toFtsExpr(q.groups), 8);
  const matched = facets.reduce((n, f) => n + f.count, 0);
  if (matched < 10 && q.groups.length > 1) {
    // a descriptive need ("دوربین برای مغازه") rarely matches every word: fall back to the head noun,
    // i.e. the most frequent word of the need, and let the user pick among its categories.
    const vocab = getVocabulary(db);
    const head = [...q.groups].sort((a, b) => Math.max(...b.forms.map((f) => vocab.doc(f))) - Math.max(...a.forms.map((f) => vocab.doc(f))))[0]!;
    facets = getCategoryFacets(db, toFtsExpr([head]), 8);
  }
  if (!facets.length) return { auto: null, choices: supportedChoices(db), reason: "none" };
  const total = facets.reduce((n, f) => n + f.count, 0);
  const top = facets[0]!;
  if (top.count >= 10 && top.count / total >= 0.6) return { auto: top.category, choices: [], reason: "dominant" };
  return { auto: null, choices: facets.slice(0, 6).map((f) => choice(db, f.category, undefined)), reason: "ambiguous" };
}
