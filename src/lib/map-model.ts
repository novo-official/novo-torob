import { isValidCoordinate } from "@/lib/geo";

/**
 * Pure model for the map layer (kept separate from Leaflet so it is unit-testable):
 *  - shop pins and shopping-area pins are DIFFERENT kinds with different shape, label and a11y text
 *  - shops recorded at the exact same coordinate (mall-level approximations) collapse into ONE group pin
 *  - invalid coordinates never become a pin
 */
export type PinKind = "shop" | "shop-group" | "area" | "origin";

export interface ShopPinInput { id: string; name: string; lat: number; lon: number; distanceMeters: number | null }
export interface AreaPinInput { id: string; name: string; lat: number; lon: number; sourceType: "curated_external" | "dataset_category_density" }

export interface MapPin {
  key: string;
  kind: PinKind;
  lat: number;
  lon: number;
  /** shop ids for shop / shop-group pins; area id for area pins */
  ids: string[];
  /** accessible name (Persian), unique semantics per kind */
  label: string;
}

const coordKey = (lat: number, lon: number) => `${lat.toFixed(5)},${lon.toFixed(5)}`;
const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

export function buildShopPins(shops: ShopPinInput[]): MapPin[] {
  const groups = new Map<string, ShopPinInput[]>();
  for (const s of shops) {
    if (!isValidCoordinate(s.lat, s.lon)) continue;
    const k = coordKey(s.lat, s.lon);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  return [...groups.entries()].map(([k, list]) => {
    const first = list[0]!;
    if (list.length === 1) return { key: `shop:${first.id}`, kind: "shop" as const, lat: first.lat, lon: first.lon, ids: [first.id], label: `فروشگاه: ${first.name}` };
    return {
      key: `group:${k}`, kind: "shop-group" as const, lat: first.lat, lon: first.lon, ids: list.map((s) => s.id),
      label: `${fa(list.length)} فروشگاه با مختصات یکسان (سطح پاساژ یا ساختمان، نه موقعیت دقیق واحد): ${list.map((s) => s.name).slice(0, 3).join("، ")}${list.length > 3 ? "…" : ""}`,
    };
  });
}

export function buildAreaPins(areas: AreaPinInput[]): MapPin[] {
  return areas
    .filter((a) => isValidCoordinate(a.lat, a.lon))
    .map((a) => ({
      key: `area:${a.id}`, kind: "area" as const, lat: a.lat, lon: a.lon, ids: [a.id],
      label: `منطقه‌ی خرید پیشنهادی (${a.sourceType === "curated_external" ? "منبع بیرونی" : "برآورد از تراکم داده"}): ${a.name}. این یک فروشنده نیست.`,
    }));
}

export const originPin = (lat: number, lon: number, label: string): MapPin | null =>
  isValidCoordinate(lat, lon) ? { key: "origin", kind: "origin", lat, lon, ids: [], label: `نقطه‌ی شروع شما: ${label}` } : null;
