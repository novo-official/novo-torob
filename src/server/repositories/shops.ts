import type { DatabaseSync } from "node:sqlite";
import type { ContactChannel, DeclaredHours, PaymentInfo, Shop } from "@/domain/types";
import { boundingBox, haversineMeters } from "@/server/domain/geo";
import { evaluateHours, NO_SCHEDULE, type HoursEvaluation } from "@/server/domain/hours";
import { clamp, getFlags, LIMITS, type FlagView } from "./shared";

type ShopRow = {
  shop_id: string; name: string; address: string | null; location_label: string | null; lat: number | null; lon: number | null;
  category_names_json: string | null; instagram_url: string | null; website_url: string | null; payment_json: string | null;
  supports_fast_delivery: number | null; hours_json: string; offer_count: number;
};
const SHOP_COLS = "shop_id, name, address, location_label, lat, lon, category_names_json, instagram_url, website_url, payment_json, supports_fast_delivery, hours_json, offer_count";

function toShop(r: ShopRow): Shop {
  // The dataset's phone numbers are synthetic: `contacts_raw` is never selected, so no phone can leak.
  const channels: ContactChannel[] = [];
  if (r.website_url) channels.push({ kind: "website", value: r.website_url, trust: "unverified_public" });
  if (r.instagram_url) channels.push({ kind: "instagram", value: r.instagram_url, trust: "unverified_public" });
  const payment: PaymentInfo = r.payment_json
    ? { declared: true, providers: JSON.parse(r.payment_json) as Array<{ providerName: string; channel: "in_person" | "online" | "unknown" }> }
    : { declared: false };
  let hours: DeclaredHours = NO_SCHEDULE;
  try {
    hours = JSON.parse(r.hours_json) as DeclaredHours;
  } catch {
    /* stays NO_SCHEDULE → unknown */
  }
  return {
    id: r.shop_id, name: r.name, address: r.address, locationLabel: r.location_label,
    location: { lat: r.lat ?? Number.NaN, lon: r.lon ?? Number.NaN },
    categoryNames: r.category_names_json ? (JSON.parse(r.category_names_json) as string[]) : [],
    hours, payment, contactChannels: channels,
    supportsFastDelivery: r.supports_fast_delivery === null ? null : r.supports_fast_delivery === 1,
    hasAnyOffer: Number(r.offer_count) > 0,
  };
}

export function getShop(db: DatabaseSync, id: string): { shop: Shop; flags: FlagView[] } | null {
  const r = db.prepare(`SELECT ${SHOP_COLS} FROM shops WHERE shop_id = ?`).get(id) as ShopRow | undefined;
  return r ? { shop: toShop(r), flags: getFlags(db, "shop", id) } : null;
}

export interface NearbyShop {
  shop: Shop;
  distanceMeters: number;
}

/**
 * Shops within `radiusMeters` (≤ 10 km), nearest first. R-Tree bounding-box prefilter, then exact
 * haversine. `withOffersOnly` excludes the 41% of shops that hold no offers (category ≠ stock).
 */
export function shopsNear(db: DatabaseSync, lat: number, lon: number, opts: { radiusMeters?: number; limit?: number; withOffersOnly?: boolean } = {}): NearbyShop[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
  const radius = clamp(opts.radiusMeters, 1000, LIMITS.radiusMaxMeters);
  const limit = clamp(opts.limit, 20, LIMITS.shopsNearMax);
  const bb = boundingBox(lat, lon, radius);
  // 1) cheap pass: coordinates only (R-Tree box → exact haversine → nearest N)
  const light = db
    .prepare(
      `SELECT s.shop_id AS id, s.lat AS lat, s.lon AS lon FROM shop_geo g JOIN shops s ON s.rowid = g.id
       WHERE g.min_lat >= ? AND g.max_lat <= ? AND g.min_lon >= ? AND g.max_lon <= ?${opts.withOffersOnly ? " AND s.offer_count > 0" : ""}`,
    )
    .all(bb.minLat, bb.maxLat, bb.minLon, bb.maxLon) as Array<{ id: string; lat: number; lon: number }>;
  const nearest = light
    .map((r) => ({ id: r.id, distanceMeters: haversineMeters(lat, lon, r.lat, r.lon) }))
    .filter((x) => x.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id))
    .slice(0, limit);
  if (nearest.length === 0) return [];
  // 2) full rows (JSON parsing) only for the shops actually returned
  const rows = db.prepare(`SELECT ${SHOP_COLS} FROM shops WHERE shop_id IN (${nearest.map(() => "?").join(",")})`).all(...nearest.map((n) => n.id)) as ShopRow[];
  const byId = new Map(rows.map((r) => [r.shop_id, r]));
  return nearest.map((n) => ({ shop: toShop(byId.get(n.id)!), distanceMeters: n.distanceMeters }));
}

/**
 * evaluateDeclaredHours(shopId, targetTimeAsiaTehran): open / closed / unknown *as declared by the shop*.
 * `unknown` (no schedule, unsupported day, placeholder-only day) is never reported as closed.
 */
export function evaluateDeclaredHours(db: DatabaseSync, shopId: string, target: Date | string): (HoursEvaluation & { shopId: string }) | null {
  const r = db.prepare("SELECT hours_json FROM shops WHERE shop_id = ?").get(shopId) as { hours_json: string } | undefined;
  if (!r) return null;
  const instant = target instanceof Date ? target : new Date(target);
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid target time");
  return { shopId, ...evaluateHours(JSON.parse(r.hours_json) as DeclaredHours, instant) };
}
