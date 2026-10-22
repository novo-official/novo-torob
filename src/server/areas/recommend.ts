import type { DatabaseSync } from "node:sqlite";
import type { AreaRecommendation, AreaRecommendationResult, ShoppingArea } from "@/domain/shopping-area";
import { haversineMeters, isValidCoordinate } from "@/lib/geo";
import { normalizeSearchText } from "@/server/domain/text";
import { resolveCategory } from "@/server/advisor/resolve-category";
import { CURATED_REGISTRY, CURATED_REJECTED } from "./curated";
import { getDensityIndex } from "./density";

export interface RecommendInput {
  /** a dataset category name, or free text from which a category is resolved */
  categoryHint?: string | null;
  /** extra wording from the user (e.g. "پاساژ", "خیابان"); only nudges ranking */
  needs?: string[];
  origin?: { lat: number; lon: number } | null;
  limit?: number;
  /** test hook: a different curated list */
  curated?: ShoppingArea[];
}

const MAX_LIMIT = 8;
const DEFAULT_LIMIT = 3;
const MIN_OFFER_SHOPS = 5;

const categorySet = new WeakMap<DatabaseSync, Set<string>>();
const knownCategories = (db: DatabaseSync): Set<string> => {
  let s = categorySet.get(db);
  if (!s) categorySet.set(db, (s = new Set((db.prepare("SELECT DISTINCT category_name AS c FROM products").all() as Array<{ c: string }>).map((r) => r.c))));
  return s;
};

export function resolveAreaCategory(db: DatabaseSync, hint: string | null | undefined): string | null {
  const t = hint?.trim();
  if (!t) return null;
  if (knownCategories(db).has(t)) return t;
  const r = resolveCategory(db, t);
  return r.auto;
}

/**
 * Deterministic shopping-area recommender (called by the no-result UI now, and by AI tools in Phase 7).
 * Evidence (what a source/dataset says) and inference (what the system concluded) are returned separately.
 * Never needs a product id. Returns an explicit reason when it has nothing it can stand behind.
 */
export function recommendShoppingAreas(db: DatabaseSync, input: RecommendInput): AreaRecommendationResult {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const category = resolveAreaCategory(db, input.categoryHint);
  const registry = input.curated ?? CURATED_REGISTRY;
  const rejectedCurated = input.curated ? 0 : CURATED_REJECTED.length;
  if (!category) return { areas: [], category: null, reason: "NO_CATEGORY", rejectedCurated };

  const origin = input.origin && isValidCoordinate(input.origin.lat, input.origin.lon) ? input.origin : null;
  const needWords = (input.needs ?? []).map((w) => normalizeSearchText(w)).filter(Boolean);
  const dist = (a: ShoppingArea) => (origin ? haversineMeters(origin.lat, origin.lon, a.center.lat, a.center.lon) : null);
  const nudge = (a: ShoppingArea) => (needWords.some((w) => normalizeSearchText(`${a.nameFa} ${a.areaLabelFa} ${a.kind === "mall" ? "پاساژ" : a.kind === "street" ? "خیابان" : "محدوده"}`).includes(w)) ? 1 : 0);

  const out: Array<AreaRecommendation & { rank: number }> = [];

  for (const a of registry) {
    if (!a.categoryTags.includes(category)) continue;
    out.push({
      area: a, distanceMeters: dist(a), matchedCategories: [category], density: null,
      evidence: a.sources.filter((s) => s.supports === "claim").map((s) => ({ textFa: `${s.publisher}${s.publishedAt ? ` (${s.publishedAt})` : ""}: «${s.quote ?? s.title}»`, source: "source_ref" as const })),
      inference: [{ textFa: `نگاشت ادعای منبع به دسته‌ی «${category}» برداشت سیستم است، نه جمله‌ی منبع.` }, { textFa: `سطح اطمینان ${a.confidence === "high" ? "بالا (دو منبع توصیفی مستقل + مختصات تأییدشده)" : "متوسط (منبع محدود/قدیمی)"}؛ تاریخ راستی‌آزمایی ${a.verifiedAt}.` }],
      rank: (a.confidence === "high" ? 300 : 200) + nudge(a) * 5,
    });
  }

  const density = getDensityIndex(db);
  for (const a of density.areas) {
    const c = density.counts.get(a.id)?.get(category);
    if (!c || c.offers < MIN_OFFER_SHOPS) continue;
    out.push({
      area: a, distanceMeters: dist(a), matchedCategories: [category], density: { shopsListing: c.listing, shopsWithOffers: c.offers },
      evidence: [{ textFa: `در داده‌ی هکاتون ${new Intl.NumberFormat("fa-IR").format(c.offers)} فروشگاه این محدوده برای دسته‌ی «${category}» پیشنهاد ثبت کرده‌اند و ${new Intl.NumberFormat("fa-IR").format(c.listing)} فروشگاه آن را در فعالیت خود اعلام کرده‌اند (offers.csv / shops.csv).`, source: "dataset" as const }],
      inference: [{ textFa: "این تمرکز فعالیت در نمونه‌ی داده است؛ برداشت «اینجا بازار این کالاست» استنباط سیستم است و مدرک مستقل یا موجودی فعلی نیست." }],
      rank: Math.min(100, c.offers / 3) + nudge(a) * 5,
    });
  }

  out.sort((x, y) => y.rank - x.rank || (x.distanceMeters ?? Infinity) - (y.distanceMeters ?? Infinity) || x.area.id.localeCompare(y.area.id));
  // keep both evidence tiers visible: at least one dataset-density lead if any exists, even when curated leads fill the list
  const picked = out.slice(0, limit);
  if (limit >= 2 && !picked.some((p) => p.area.sourceType === "dataset_category_density")) {
    const d = out.find((p) => p.area.sourceType === "dataset_category_density");
    if (d) picked[picked.length - 1] = d;
  }
  const areas = picked.map(({ rank: _r, ...rest }) => { void _r; return rest; });
  return { areas, category, reason: areas.length ? "OK" : "NO_EVIDENCE_BACKED_AREA", rejectedCurated };
}
