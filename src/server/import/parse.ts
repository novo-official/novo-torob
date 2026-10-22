import type { DeclaredHours } from "@/domain/types";
import { parseWeeklyHours } from "@/server/domain/hours";
import { detectUnitHint, extractModelKeys, normalizeSearchText, safePublicUrl } from "@/server/domain/text";
import type { CsvRow } from "./csv";

/** The source encodes missing values as "" or the literal string "null". */
export const nullable = (v: string | undefined): string | null => (v === undefined || v === "" || v === "null" ? null : v);

type Json = unknown;
function tryJson(raw: string | null): { ok: true; value: Json } | { ok: false } | { ok: "absent" } {
  if (raw === null) return { ok: "absent" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

// ---------------- products ----------------
export interface ParsedProduct {
  product_id: string;
  brand_name: string | null;
  category_name: string;
  model: string | null;
  persian_title: string | null;
  image_urls_raw: string | null;
  specs_raw: string | null;
  images_json: string | null;
  specs_json: string | null;
  spec_count: number;
  parse_issues: string[];
  title_norm: string;
  brand_norm: string;
  category_norm: string;
  model_keys: string;
}

export function parseProduct(row: CsvRow): ParsedProduct {
  const issues: string[] = [];
  const specsRaw = nullable(row.specs);
  const imgRaw = nullable(row.image_urls);

  let specs: Array<{ section: string; key: string; value: string }> = [];
  const sj = tryJson(specsRaw);
  if (sj.ok === true && Array.isArray(sj.value)) {
    for (const it of sj.value as Array<Record<string, unknown>>) {
      if (it && typeof it.key === "string" && it.value !== undefined && it.value !== null) {
        specs.push({ section: typeof it.section === "string" ? it.section : "", key: it.key, value: String(it.value) });
      } else issues.push("PARSE_SPECS_INVALID");
    }
  } else if (sj.ok === false || (sj.ok === true && !Array.isArray(sj.value))) {
    issues.push("PARSE_SPECS_INVALID");
    specs = [];
  }

  let images: string[] = [];
  const ij = tryJson(imgRaw);
  if (ij.ok === true && Array.isArray(ij.value)) {
    for (const u of ij.value) {
      const safe = typeof u === "string" ? safePublicUrl(u) : null;
      if (safe) images.push(safe);
      else issues.push("PARSE_IMAGES_INVALID");
    }
  } else if (ij.ok === false || (ij.ok === true && !Array.isArray(ij.value))) {
    issues.push("PARSE_IMAGES_INVALID");
    images = [];
  }

  const title = nullable(row.persian_title);
  const model = nullable(row.model);
  const keys = new Set([...extractModelKeys(title), ...extractModelKeys(model)]);

  return {
    product_id: row.product_id!,
    brand_name: nullable(row.brand_name),
    category_name: row.category_name ?? "",
    model,
    persian_title: title,
    image_urls_raw: row.image_urls ?? null,
    specs_raw: row.specs ?? null,
    images_json: ij.ok === "absent" ? null : JSON.stringify(images),
    specs_json: sj.ok === "absent" ? null : JSON.stringify(specs),
    spec_count: specs.length,
    parse_issues: [...new Set(issues)],
    title_norm: normalizeSearchText(title),
    brand_norm: normalizeSearchText(nullable(row.brand_name)),
    category_norm: normalizeSearchText(row.category_name),
    model_keys: [...keys].join(" "),
  };
}

// ---------------- shops ----------------
export interface ParsedShop {
  shop_id: string;
  name: string;
  address: string | null;
  location_label: string | null;
  lat: number | null;
  lon: number | null;
  category_names_raw: string | null;
  category_names_json: string | null;
  contacts_raw: string | null;
  instagram_raw: string | null;
  instagram_url: string | null;
  website_url_raw: string | null;
  website_url: string | null;
  payment_options_raw: string | null;
  payment_json: string | null;
  supports_fast_delivery_raw: string | null;
  supports_fast_delivery: number | null;
  weekly_hours_raw: string | null;
  hours_json: string;
  has_schedule: number;
  placeholder_shifts: number;
  unsupported_days: number;
  parse_issues: string[];
  name_norm: string;
  label_norm: string;
}

const coord = (v: string | undefined, lo: number, hi: number): number | null => {
  const n = Number(v);
  return v !== undefined && v !== "" && v !== "null" && Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

export function parseShop(row: CsvRow): ParsedShop {
  const issues: string[] = [];
  const catRaw = nullable(row.category_names);
  const cj = tryJson(catRaw);
  let cats: string[] = [];
  if (cj.ok === true && Array.isArray(cj.value)) cats = (cj.value as unknown[]).filter((c): c is string => typeof c === "string");
  else if (cj.ok === false) issues.push("PARSE_SHOP_JSON_INVALID");

  const payRaw = nullable(row.payment_options);
  const pj = tryJson(payRaw);
  let payment: Array<{ providerName: string; channel: "in_person" | "online" | "unknown" }> = [];
  if (pj.ok === true && Array.isArray(pj.value)) {
    for (const p of pj.value as Array<Record<string, unknown>>) {
      if (p && typeof p.provider_name === "string") {
        const ch = p.channel === "in_person" || p.channel === "online" ? p.channel : "unknown";
        payment.push({ providerName: p.provider_name, channel: ch });
      }
    }
  } else if (pj.ok === false) {
    issues.push("PARSE_SHOP_JSON_INVALID");
    payment = [];
  }

  const igRaw = nullable(row.instagram);
  let igUrl: string | null = null;
  const ij = tryJson(igRaw);
  if (ij.ok === true && ij.value && typeof ij.value === "object") {
    const url = safePublicUrl((ij.value as { profile_url?: string }).profile_url);
    if (url && /(^|\.)instagram\.com$/.test(new URL(url).hostname)) igUrl = url;
  } else if (ij.ok === false) issues.push("PARSE_SHOP_JSON_INVALID");

  const contacts = nullable(row.contacts);
  if (tryJson(contacts).ok === false) issues.push("PARSE_SHOP_JSON_INVALID");

  const hoursRaw = nullable(row.weekly_hours);
  const hours = parseWeeklyHours(hoursRaw);
  if (hours.invalid) issues.push("HOURS_INVALID");

  const fast = nullable(row.supports_fast_delivery);
  return {
    shop_id: row.shop_id!,
    name: row.name ?? "",
    address: nullable(row.address),
    location_label: nullable(row.location_label),
    lat: coord(row.lat, -90, 90),
    lon: coord(row.lon, -180, 180),
    category_names_raw: row.category_names ?? null,
    category_names_json: cj.ok === true ? JSON.stringify(cats) : null,
    contacts_raw: row.contacts ?? null,
    instagram_raw: row.instagram ?? null,
    instagram_url: igUrl,
    website_url_raw: row.website_url ?? null,
    website_url: safePublicUrl(nullable(row.website_url)),
    payment_options_raw: row.payment_options ?? null,
    payment_json: payment.length > 0 ? JSON.stringify(payment) : null,
    supports_fast_delivery_raw: row.supports_fast_delivery ?? null,
    supports_fast_delivery: fast === "true" ? 1 : fast === "false" ? 0 : null,
    weekly_hours_raw: row.weekly_hours ?? null,
    hours_json: JSON.stringify(hours.hours satisfies DeclaredHours),
    has_schedule: hours.hours.hasSchedule ? 1 : 0,
    placeholder_shifts: hours.placeholderShifts,
    unsupported_days: hours.unsupportedDays,
    parse_issues: [...new Set(issues)],
    name_norm: normalizeSearchText(row.name),
    label_norm: normalizeSearchText(row.location_label),
  };
}

// ---------------- offers ----------------
export interface ParsedOffer {
  offer_id: string;
  product_id: string;
  shop_id: string;
  seller_title: string;
  description: string | null;
  price_toman_raw: string | null;
  price_toman: number | null;
  price_out_of_range: number;
  last_price_changed_at_raw: string | null;
  price_changed_at: string | null;
  warranty_raw: string | null;
  warranty_months: number | null;
  warranty_provider: string | null;
  warranty_description: string | null;
  seller_title_norm: string;
  model_keys: string;
  unit_hint: string;
  parse_issues: string[];
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseOffer(row: CsvRow): ParsedOffer {
  const issues: string[] = [];
  const priceRaw = nullable(row.price_toman);
  let price: number | null = null;
  let outOfRange = 0;
  if (priceRaw !== null && /^\d+$/.test(priceRaw)) {
    // Integers beyond 2^53-1 cannot round-trip through JS numbers. The exact digits stay in
    // price_toman_raw; the typed column is NULL and the row is flagged PRICE_ABSURD_MAGNITUDE.
    if (BigInt(priceRaw) <= BigInt(Number.MAX_SAFE_INTEGER)) price = Number(priceRaw);
    else outOfRange = 1;
  }

  const tsRaw = nullable(row.last_price_changed_at);
  let ts: string | null = null;
  if (tsRaw !== null && ISO_RE.test(tsRaw)) {
    const ms = Date.parse(tsRaw);
    if (Number.isFinite(ms)) ts = new Date(ms).toISOString();
  }

  const wRaw = nullable(row.warranty);
  let months: number | null = null;
  let provider: string | null = null;
  let wdesc: string | null = null;
  const wj = tryJson(wRaw);
  if (wj.ok === true && wj.value && typeof wj.value === "object") {
    const w = wj.value as { period_months?: unknown; provider?: unknown; description?: unknown };
    months = typeof w.period_months === "number" && Number.isFinite(w.period_months) ? w.period_months : null;
    provider = typeof w.provider === "string" ? w.provider : null;
    wdesc = typeof w.description === "string" ? w.description : null;
  } else if (wj.ok === false) issues.push("PARSE_WARRANTY_INVALID");

  return {
    offer_id: row.offer_id!,
    product_id: row.product_id!,
    shop_id: row.shop_id!,
    seller_title: row.seller_title ?? "",
    description: nullable(row.description),
    price_toman_raw: row.price_toman ?? null,
    price_toman: price,
    price_out_of_range: outOfRange,
    last_price_changed_at_raw: row.last_price_changed_at ?? null,
    price_changed_at: ts,
    warranty_raw: row.warranty ?? null,
    warranty_months: months,
    warranty_provider: provider,
    warranty_description: wdesc,
    seller_title_norm: normalizeSearchText(row.seller_title),
    model_keys: extractModelKeys(row.seller_title).join(" "),
    unit_hint: detectUnitHint(row.seller_title),
    parse_issues: issues,
  };
}
