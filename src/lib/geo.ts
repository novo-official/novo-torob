/**
 * Pure geography helpers shared by server code AND client components (no I/O, no server imports).
 * Distances are STRAIGHT-LINE (haversine). They are never presented as walking/driving time.
 */
const R = 6371008.8; // mean Earth radius, metres (same constant used by the independent test fixture)

export interface LatLon {
  lat: number;
  lon: number;
}

/** Greater Tehran sanity box. Anything outside is rejected as an origin/area coordinate (not as a "no shops" claim). */
export const TEHRAN_BOUNDS = { minLat: 35.5, maxLat: 35.9, minLon: 51.0, maxLon: 51.75 } as const;

export function isValidCoordinate(lat: unknown, lon: unknown): lat is number {
  return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

export function isInTehran(lat: number, lon: number): boolean {
  return isValidCoordinate(lat, lon) && lat >= TEHRAN_BOUNDS.minLat && lat <= TEHRAN_BOUNDS.maxLat && lon >= TEHRAN_BOUNDS.minLon && lon <= TEHRAN_BOUNDS.maxLon;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Bounding box that fully contains a circle of `radiusMeters` (prefilter for the R-Tree). */
export function boundingBox(lat: number, lon: number, radiusMeters: number) {
  const dLat = (radiusMeters / R) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

/**
 * Privacy: a user-supplied origin is snapped to a ~100 m grid (0.001°) before it is used by the server
 * or placed in a URL. Exact device coordinates never leave the browser.
 */
export const ORIGIN_GRID_DEG = 0.001;
export const snapToGrid = (v: number, step = ORIGIN_GRID_DEG): number => Math.round(Math.round(v / step) * step * 1e6) / 1e6;
export const snapOrigin = (p: LatLon): LatLon => ({ lat: snapToGrid(p.lat), lon: snapToGrid(p.lon) });

/** Human distance text. Never adds a travel-time claim. */
export function formatDistance(meters: number): string {
  const fa = (n: number, d = 0) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: d }).format(n);
  if (meters < 1000) return `${fa(Math.round(meters / 10) * 10)} متر`;
  return `${fa(meters / 1000, 1)} کیلومتر`;
}

export const RADIUS_OPTIONS = [500, 1000, 3000, 5000, 10000] as const;
export type RadiusOption = (typeof RADIUS_OPTIONS)[number];
export const radiusLabel = (m: number) => (m < 1000 ? `${new Intl.NumberFormat("fa-IR").format(m)} متر` : `${new Intl.NumberFormat("fa-IR").format(m / 1000)} کیلومتر`);

/** Median-based centre of a point set (robust to a few far-away shops). */
export function medianCenter(points: LatLon[]): LatLon {
  const m = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const i = s.length >> 1; return s.length % 2 ? s[i]! : (s[i - 1]! + s[i]!) / 2; };
  return { lat: m(points.map((p) => p.lat)), lon: m(points.map((p) => p.lon)) };
}

/**
 * "Show this place on OpenStreetMap" link. Built ONLY from a validated DESTINATION coordinate (a shop or area centre
 * from our data) — the user's own position is never put in it. Opened by an explicit user click, in a new tab.
 */
export function externalMapLink(lat: number, lon: number): string | null {
  if (!isValidCoordinate(lat, lon)) return null;
  const la = lat.toFixed(6);
  const lo = lon.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=18/${la}/${lo}`;
}
