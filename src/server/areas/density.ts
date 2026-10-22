import type { DatabaseSync } from "node:sqlite";
import type { ShoppingArea } from "@/domain/shopping-area";
import { haversineMeters, medianCenter } from "@/lib/geo";
import { normalizeSearchText } from "@/server/domain/text";
import { tehranToday } from "./validate";

/**
 * DATASET ACTIVITY CONCENTRATION — explicitly NOT independent evidence and NOT inventory.
 * It counts, per area, how many shops (a) list a category in `category_names` and (b) recorded ≥1 offer in it.
 * Works offline. Two granularities: location_label districts, and malls named in the recorded address text.
 */
export interface DensityShop {
  id: string;
  lat: number;
  lon: number;
  label: string | null;
  mallKey: string | null;
  mallName: string | null;
  listing: Set<string>;
  offered: Set<string>;
}

export interface DensityIndex {
  shops: DensityShop[];
  /** category → shops that LIST it in category_names (activity, not possession) */
  listingByCategory: Map<string, DensityShop[]>;
  areas: ShoppingArea[];
  /** areaId → category → counts */
  counts: Map<string, Map<string, { listing: number; offers: number }>>;
  shopCount: number;
}

const MALL_RE = /(پاساژ|مجتمع تجاری|مجتمع|مرکز خرید|پلاسکو|بازار موبایل)\s+([^\s،,٬\-–:()/\\]+)/;
const NUMBER_WORDS = new Set(["یک", "دو", "سه", "چهار", "پنج", "اول", "دوم", "سوم", "یکم"]);
const MIN_DISTRICT_SHOPS = 20;
const MIN_MALL_SHOPS = 5;
const MALL_RADIUS_M = 500;

export function mallFromAddress(address: string | null): { key: string; name: string } | null {
  if (!address) return null;
  const m = MALL_RE.exec(address.replace(/[‌‍]/g, " "));
  if (!m) return null;
  const word = m[2]!.replace(/[0-9۰-۹]+$/u, "");
  if (!word || NUMBER_WORDS.has(word) || word.length < 2) return null;
  const base = normalizeSearchText(word).replace(/ء/g, "");
  if (!base) return null;
  const kind = m[1]!.startsWith("بازار") ? "بازار" : m[1]!.startsWith("مرکز") ? "مرکز خرید" : "پاساژ";
  return { key: `${kind} ${base}`, name: `${kind} ${word}` };
}

const cache = new WeakMap<DatabaseSync, DensityIndex>();

export function getDensityIndex(db: DatabaseSync): DensityIndex {
  const hit = cache.get(db);
  if (hit) return hit;

  const offered = new Map<string, Set<string>>();
  for (const r of db.prepare("SELECT DISTINCT o.shop_id AS s, p.category_name AS c FROM offers o JOIN products p ON p.product_id = o.product_id").iterate() as Iterable<{ s: string; c: string }>) {
    (offered.get(r.s) ?? offered.set(r.s, new Set()).get(r.s)!).add(r.c);
  }
  const shops: DensityShop[] = [];
  for (const r of db.prepare("SELECT shop_id, lat, lon, location_label, address, category_names_json FROM shops WHERE lat IS NOT NULL AND lon IS NOT NULL").iterate() as Iterable<{ shop_id: string; lat: number; lon: number; location_label: string | null; address: string | null; category_names_json: string | null }>) {
    let cats: string[] = [];
    try { cats = r.category_names_json ? (JSON.parse(r.category_names_json) as string[]) : []; } catch { cats = []; }
    const mall = mallFromAddress(r.address);
    shops.push({ id: r.shop_id, lat: r.lat, lon: r.lon, label: r.location_label, mallKey: mall?.key ?? null, mallName: mall?.name ?? null, listing: new Set(cats), offered: offered.get(r.shop_id) ?? new Set() });
  }

  const groups = new Map<string, { kind: "district" | "mall"; name: string; shops: DensityShop[] }>();
  const add = (key: string, kind: "district" | "mall", name: string, s: DensityShop) => {
    const g = groups.get(key) ?? { kind, name, shops: [] };
    g.shops.push(s);
    groups.set(key, g);
  };
  for (const s of shops) {
    if (s.label) add(`district:${normalizeSearchText(s.label)}`, "district", s.label, s);
    if (s.mallKey) add(`mall:${s.mallKey}`, "mall", s.mallName!, s);
  }

  const areas: ShoppingArea[] = [];
  const counts = new Map<string, Map<string, { listing: number; offers: number }>>();
  let n = 0;
  for (const [, g] of [...groups.entries()].sort((a, b) => b[1].shops.length - a[1].shops.length || a[0].localeCompare(b[0]))) {
    let members = g.shops;
    let center = medianCenter(members);
    if (g.kind === "mall") {
      // same-named malls elsewhere must not be merged: keep only shops within 500 m of the median
      members = members.filter((s) => haversineMeters(center.lat, center.lon, s.lat, s.lon) <= MALL_RADIUS_M);
      center = medianCenter(members);
    }
    if (members.length < (g.kind === "district" ? MIN_DISTRICT_SHOPS : MIN_MALL_SHOPS)) continue;
    const dists = members.map((s) => haversineMeters(center.lat, center.lon, s.lat, s.lon)).sort((a, b) => a - b);
    const p90 = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.9))]!;
    const perCat = new Map<string, { listing: number; offers: number }>();
    for (const s of members) {
      for (const c of s.listing) (perCat.get(c) ?? perCat.set(c, { listing: 0, offers: 0 }).get(c)!).listing++;
      for (const c of s.offered) (perCat.get(c) ?? perCat.set(c, { listing: 0, offers: 0 }).get(c)!).offers++;
    }
    const id = `density-${g.kind}-${String(++n).padStart(3, "0")}`;
    const tags = [...perCat.entries()].filter(([, v]) => v.offers >= 3).sort((a, b) => b[1].offers - a[1].offers || a[0].localeCompare(b[0])).slice(0, 15).map(([c]) => c);
    counts.set(id, perCat);
    areas.push({
      id,
      nameFa: g.kind === "district" ? `محدوده‌ی «${g.name}» (تمرکز فعالیت در داده)` : `${g.name} (تمرکز فعالیت در داده)`,
      kind: g.kind,
      center,
      extent: { radiusMeters: Math.round(p90), basisFa: "۹۰٪ فروشگاه‌های ثبت‌شده با این برچسب/نام در این شعاع از مرکزشان‌اند؛ مرز واقعی بازار یا پاساژ نیست." },
      coordinateBasisFa: `میانه‌ی مختصات ${members.length} فروشگاه ثبت‌شده در داده (shops.csv)؛ نقطه‌ی میانه‌ی نقاط داده است، نه آدرس یا مرز بازار.`,
      areaLabelFa: g.kind === "district" ? `برچسب موقعیت در داده: «${g.name}»` : `نام پاساژ در نشانی ثبت‌شده‌ی فروشگاه‌ها: «${g.name}»`,
      categoryTags: tags,
      recommendationReasonFa: `${members.length} فروشگاه در داده با این ${g.kind === "district" ? "برچسب موقعیت" : "نام پاساژ"} ثبت شده‌اند و دسته‌های بالا را فعالیت یا پیشنهاد ثبت‌شده‌ی خود اعلام کرده‌اند.`,
      sourceType: "dataset_category_density",
      sources: [{ supports: "dataset", title: "تمرکز دسته‌ها و پیشنهادها در داده‌ی هکاتون", publisher: "دیتاست ارائه‌شده (shops.csv + offers.csv + products.csv)", dataset: { files: ["shops.csv", "offers.csv", "products.csv"], fields: ["category_names", "location_label", "address", "lat", "lon", "offers.shop_id", "products.category_name"] } }],
      verifiedAt: tehranToday(),
      confidence: "low",
      disclaimerFa: "این فقط تمرکز فعالیت فروشگاه‌ها در نمونه‌ی داده است، نه مدرک مستقل برای موجودی فعلی. داده‌ی هکاتون پوشش کل تهران نیست.",
    });
  }
  const listingByCategory = new Map<string, DensityShop[]>();
  for (const s of shops) for (const c of s.listing) (listingByCategory.get(c) ?? listingByCategory.set(c, []).get(c)!).push(s);
  const idx: DensityIndex = { shops, listingByCategory, areas, counts, shopCount: shops.length };
  cache.set(db, idx);
  return idx;
}
