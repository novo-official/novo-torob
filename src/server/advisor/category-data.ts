import type { DatabaseSync } from "node:sqlite";
import type { BudgetBand } from "@/domain/advisor";
import { fetchCategoryRows, type ProductRow } from "@/server/catalog/rows";
import { schemaForCategory, type CategorySchema } from "./schemas";
import { buildProductText, type Attr } from "./specs";

export const REDACTED_TITLE = "عنوان حذف‌شده برای انتشار";

export interface Prepared {
  row: ProductRow;
  attrs: Record<string, Attr<unknown>>;
  /** lowercase text used for free-text relevance: title + brand + a few spec values */
  haystack: string;
}

export interface CategoryData {
  category: string;
  schema: CategorySchema | undefined;
  items: Prepared[];
  /** products dropped because they are spare parts/accessories or have a redacted title */
  excluded: number;
  bands: BudgetBand[];
  /**
   * Category-aware plausibility floor (NOT a global bound): one tenth of the 5th percentile of the category's reliable median prices.
   * A product priced below it is treated as "price unverifiable" for budget purposes (e.g. a CCTV camera listed at 8,900 toman).
   */
  lowCut: number | null;
  /** option id → number of products with a (explicit or inferred) match, per question */
  optionCounts: Record<string, Record<string, number>>;
}

const cache = new WeakMap<DatabaseSync, Map<string, CategoryData>>();
const MAX_CACHED = 8;

/** Round to 2 significant digits: 1,234,567 → 1,200,000 (pleasant budget band edges). */
export function niceRound(n: number): number {
  if (n <= 0) return 0;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

const q = (xs: number[], f: number) => xs[Math.min(xs.length - 1, Math.floor(f * (xs.length - 1)))]!;

export function computeBands(items: Prepared[]): BudgetBand[] {
  const reliable = items.filter((i) => i.row.ev.status === "reliable" && i.row.ev.median !== null);
  if (reliable.length < 8) return [];
  const medians = reliable.map((i) => i.row.ev.median as number).sort((a, b) => a - b);
  const p25 = niceRound(q(medians, 0.25));
  const p50 = niceRound(q(medians, 0.5));
  const p75 = niceRound(q(medians, 0.75));
  const edges = [...new Set([p25, p50, p75])].filter((x) => x > 0).sort((a, b) => a - b);
  if (edges.length < 2) return [];
  const bounds: Array<[number | null, number | null]> = [];
  let lo: number | null = null;
  for (const e of edges) { bounds.push([lo, e]); lo = e; }
  bounds.push([lo, null]);
  const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
  return bounds.map(([min, max], i) => ({
    id: `b${i}`,
    label: min === null ? `تا ${fa(max!)} تومان` : max === null ? `بیش از ${fa(min)} تومان` : `${fa(min)} تا ${fa(max)} تومان`,
    min, max,
    count: reliable.filter((it) => (max === null || it.row.ev.min! <= max) && (min === null || it.row.ev.max! >= min)).length,
  }));
}

export function computeLowCut(items: Prepared[]): number | null {
  const meds = items.filter((i) => i.row.ev.status === "reliable" && i.row.ev.median !== null).map((i) => i.row.ev.median as number).sort((a, b) => a - b);
  return meds.length >= 30 ? Math.floor(q(meds, 0.05) / 10) : null;
}

export function getCategoryData(db: DatabaseSync, category: string): CategoryData {
  let per = cache.get(db);
  if (!per) cache.set(db, (per = new Map()));
  const hit = per.get(category);
  if (hit) return hit;

  const schema = schemaForCategory(category);
  const all = fetchCategoryRows(db, category);
  const items: Prepared[] = [];
  let excluded = 0;
  for (const row of all) {
    const text = buildProductText(row.title, row.specsJson);
    if (row.title === REDACTED_TITLE || (schema && !schema.primary(text))) { excluded++; continue; }
    items.push({
      row,
      attrs: schema ? schema.extract(text) : {},
      haystack: `${text.ntitle} ${row.brandNorm} ${text.specs.slice(0, 12).map((s) => s.nvalue).join(" ")}`,
    });
  }
  const optionCounts: CategoryData["optionCounts"] = {};
  if (schema) {
    for (const qd of schema.questions) {
      optionCounts[qd.id] = {};
      for (const o of qd.options) optionCounts[qd.id]![o.id] = items.filter((it) => o.test(it.attrs).effect === "match").length;
    }
  }
  const data: CategoryData = { category, schema, items, excluded, bands: computeBands(items), lowCut: computeLowCut(items), optionCounts };
  if (per.size >= MAX_CACHED) per.delete(per.keys().next().value as string);
  per.set(category, data);
  return data;
}

export function categoryProductCount(db: DatabaseSync, category: string): number {
  return Number((db.prepare("SELECT count(*) AS n FROM products WHERE category_name = ?").get(category) as { n: number }).n);
}
