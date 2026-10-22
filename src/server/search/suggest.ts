import type { DatabaseSync } from "node:sqlite";
import type { Suggestions } from "@/domain/advisor";
import { analyzeQuery, toFtsExpr } from "./analyze";
import { getVocabulary } from "./vocab";
import { getCategoryFacets, searchCatalog } from "./search";

/** Typeahead: at most 5 products and 3 categories; never invents anything — empty is a valid answer. */
export function suggest(db: DatabaseSync, q: string): Suggestions {
  const a = analyzeQuery(q, getVocabulary(db));
  if (!a.valid) return { query: q, tooShort: true, products: [], categories: [], corrections: [] };
  const r = searchCatalog(db, { q, limit: 5 });
  return {
    query: q, tooShort: false, corrections: a.corrections,
    products: r.items.filter((i) => i.match !== "partial").map((i) => ({ id: i.card.id, title: i.card.title, categoryName: i.card.categoryName })),
    categories: getCategoryFacets(db, toFtsExpr(a.groups), 3),
  };
}
