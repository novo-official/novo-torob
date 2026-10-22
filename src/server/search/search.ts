import type { DatabaseSync } from "node:sqlite";
import type { Recovery, SearchResponse } from "@/domain/advisor";
import { fetchProductRows, toCard, variantSignals, type ProductRow } from "@/server/catalog/rows";
import { analyzeQuery, toFtsExpr, withoutGroup, type AnalyzedQuery } from "./analyze";
import { computeFeatures, score } from "./rank";
import { getVocabulary } from "./vocab";

const CANDIDATE_POOL = 120;
const GOOD_ENOUGH = 5;
export const SEARCH_LIMITS = { max: 50, offsetMax: 500 } as const;
const COLUMNS = ["title", "brand", "category", "model_keys"] as const;

export interface SearchOptions {
  q: string;
  category?: string | null;
  limit?: number;
  offset?: number;
  /** compute category distribution of the matches (used for disambiguation chips) */
  facets?: boolean;
  /** typo tolerance (default on); the evaluation harness switches it off to measure its effect */
  typo?: boolean;
}

interface Hit {
  rowid: number;
  rank: number; // 0-based position in bm25 order within its stage
  partial: boolean;
}

function runFts(db: DatabaseSync, expr: string, category: string | null, partial: boolean): Hit[] {
  const sql = `SELECT product_fts.rowid AS rowid FROM product_fts JOIN products p ON p.rowid = product_fts.rowid
    WHERE product_fts MATCH ?${category ? " AND p.category_name = ?" : ""}
    ORDER BY bm25(product_fts, 6.0, 2.0, 1.0, 8.0, 1.0), p.product_id LIMIT ${CANDIDATE_POOL}`;
  try {
    const rows = (category ? db.prepare(sql).all(expr, category) : db.prepare(sql).all(expr)) as Array<{ rowid: number }>;
    return rows.map((r, i) => ({ rowid: Number(r.rowid), rank: i, partial }));
  } catch {
    return []; // an FTS syntax problem must never turn into a 500; queries are built from quoted tokens only
  }
}

export function getCategoryFacets(db: DatabaseSync, expr: string, limit = 8): Array<{ category: string; count: number }> {
  try {
    const rows = db
      .prepare(`SELECT p.category_name AS c, count(*) AS n FROM product_fts JOIN products p ON p.rowid = product_fts.rowid WHERE product_fts MATCH ? GROUP BY p.category_name ORDER BY n DESC, c LIMIT ${limit}`)
      .all(expr) as Array<{ c: string; n: number }>;
    return rows.map((r) => ({ category: r.c, count: Number(r.n) }));
  } catch {
    return [];
  }
}

const rowsByRowid = (db: DatabaseSync, rowids: number[]): ProductRow[] => {
  if (!rowids.length) return [];
  const ids = db.prepare(`SELECT product_id AS id FROM products WHERE rowid IN (${rowids.map(() => "?").join(",")})`).all(...rowids) as Array<{ id: string }>;
  return [...fetchProductRows(db, ids.map((r) => r.id)).values()];
};

export function searchCatalog(db: DatabaseSync, opts: SearchOptions): SearchResponse {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20), 1), SEARCH_LIMITS.max);
  const offset = Math.min(Math.max(Math.trunc(opts.offset ?? 0), 0), SEARCH_LIMITS.offsetMax);
  const category = opts.category ?? null;
  const vocab = getVocabulary(db);
  const q: AnalyzedQuery = analyzeQuery(opts.q ?? "", opts.typo === false ? { ...vocab, fuzzy: () => [] } : vocab);

  const empty = (strategy: SearchResponse["strategy"], recovery: Recovery | null): SearchResponse => ({
    query: opts.q ?? "", valid: q.valid, invalidReason: q.invalidReason, strategy, items: [], corrections: q.corrections, expansions: q.expansions,
    droppedStopWords: q.droppedStopWords, categoryHints: q.categoryHints, categoryFacets: [], limit, offset, hasMore: false, recovery,
  });
  if (!q.valid) return empty("none", invalidRecovery(q));

  // Stage 1: precise — title/brand/category/model columns only. Stage 2: widen to seller titles.
  let hits: Hit[] = runFts(db, toFtsExpr(q.groups, COLUMNS), category, false);
  let strategy: SearchResponse["strategy"] = "columns";
  if (hits.length < GOOD_ENOUGH) {
    const wide = runFts(db, toFtsExpr(q.groups), category, false);
    const seen = new Set(hits.map((h) => h.rowid));
    hits = [...hits, ...wide.filter((h) => !seen.has(h.rowid)).map((h) => ({ ...h, rank: h.rank + hits.length }))];
    if (wide.length) strategy = hits.length > wide.length ? "columns" : "all_columns";
  }
  // Stage 3 (clearly labelled): drop exactly one word. Only when nothing matched all words.
  if (hits.length === 0 && q.groups.length >= 2) {
    const seen = new Set<number>();
    for (let i = 0; i < q.groups.length; i++) {
      for (const h of runFts(db, toFtsExpr(withoutGroup(q.groups, i)), category, true)) {
        if (!seen.has(h.rowid)) {
          seen.add(h.rowid);
          hits.push({ ...h, rank: hits.length });
        }
      }
    }
    if (hits.length) strategy = "partial";
  }
  if (hits.length === 0) return { ...empty("none", noResultRecovery(db, q, category)), categoryFacets: [] };

  const rows = rowsByRowid(db, hits.map((h) => h.rowid));
  const byRowid = new Map(rows.map((r) => [r.rowid, r]));
  const total = hits.length;
  const ranked = hits
    .map((h) => {
      const row = byRowid.get(h.rowid)!;
      const feats = computeFeatures(
        q, { titleNorm: row.titleNorm, brandNorm: row.brandNorm, categoryNorm: row.categoryNorm, modelKeys: row.modelKeys, distinctSellers: row.ev.distinctSellers, hasReliablePrice: row.ev.status === "reliable" },
        1 - h.rank / Math.max(total, 1), h.partial,
      );
      const match = (feats.exactModel || feats.compatibleModel ? "exact_model" : feats.offerOnlyModel ? "offer_model" : h.partial ? "partial" : "full") as SearchResponse["items"][number]["match"];
      return { row, s: score(feats), match, rank: h.rank };
    })
    .sort((a, b) => b.s - a.s || a.rank - b.rank || a.row.id.localeCompare(b.row.id));

  const page = ranked.slice(offset, offset + limit);
  return {
    query: opts.q, valid: true, strategy,
    items: page.map((r) => ({ card: toCard(r.row, variantSignals(db, r.row.id)), score: r.s, match: r.match })),
    corrections: q.corrections, expansions: q.expansions, droppedStopWords: q.droppedStopWords, categoryHints: q.categoryHints,
    categoryFacets: opts.facets ? getCategoryFacets(db, toFtsExpr(q.groups)) : [],
    limit, offset, hasMore: ranked.length > offset + limit, recovery: null,
  };
}

function invalidRecovery(q: AnalyzedQuery): Recovery {
  const msg =
    q.invalidReason === "only_stopwords"
      ? "عبارت خیلی کلی است. نام کالا، کاربرد یا مدل را بنویسید (مثلاً «هدفون بی‌سیم» یا «دوربین مداربسته»)."
      : q.invalidReason === "too_short"
        ? "عبارت خیلی کوتاه است. دست‌کم یک کلمه‌ی کامل بنویسید."
        : "نام کالا یا مدل را وارد کنید.";
  return { message: msg, suggestions: [] };
}

function noResultRecovery(db: DatabaseSync, q: AnalyzedQuery, category: string | null): Recovery {
  const suggestions: Recovery["suggestions"] = [];
  if (category) suggestions.push({ id: "drop-category", label: "جست‌وجو در همه‌ی دسته‌ها", patch: { category: null } });
  const unknown = q.groups.filter((g) => g.unknown).map((g) => g.source);
  const message = unknown.length
    ? `برای «${unknown.join("، ")}» چیزی در کاتالوگ پیدا نشد. املا را بررسی کنید یا کلمه‌ی کلی‌تری بنویسید.`
    : "محصولی که همه‌ی کلمه‌ها را داشته باشد پیدا نشد. یک کلمه را کم کنید یا از مشاور استفاده کنید.";
  void db;
  return { message, suggestions };
}
