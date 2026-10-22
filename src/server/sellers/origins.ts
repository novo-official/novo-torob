import type { DatabaseSync } from "node:sqlite";
import { isValidCoordinate, medianCenter, snapOrigin } from "@/lib/geo";

export interface OriginPreset {
  id: "ferdowsi" | "sheikh-hadi" | "baharestan";
  label: string;
  lat: number;
  lon: number;
}

const PRESETS: Array<{ id: OriginPreset["id"]; label: string }> = [
  { id: "ferdowsi", label: "فردوسی" },
  { id: "sheikh-hadi", label: "شیخ هادی" },
  { id: "baharestan", label: "بهارستان" },
];

const cache = new WeakMap<DatabaseSync, OriginPreset[]>();

/**
 * The three districts where the dataset is concentrated. Each preset's coordinate is the MEDIAN of the shops
 * recorded with that location_label (rounded to ~10 m) — a convenient starting point, not a landmark address.
 */
export function getOriginPresets(db: DatabaseSync): OriginPreset[] {
  const hit = cache.get(db);
  if (hit) return hit;
  const out: OriginPreset[] = [];
  for (const p of PRESETS) {
    const pts = db.prepare("SELECT lat, lon FROM shops WHERE location_label = ? AND lat IS NOT NULL AND lon IS NOT NULL").all(p.label) as Array<{ lat: number; lon: number }>;
    if (!pts.length) continue;
    const c = medianCenter(pts);
    out.push({ ...p, lat: Math.round(c.lat * 1e4) / 1e4, lon: Math.round(c.lon * 1e4) / 1e4 });
  }
  cache.set(db, out);
  return out;
}

export interface ResolvedOrigin {
  lat: number;
  lon: number;
  source: "manual" | "gps";
  label: string;
  defaulted: boolean;
}

/**
 * Turn user input into the origin the service uses. EVERYTHING is snapped to the ~100 m grid on the server, so even a
 * client that sends precise coordinates never has them used, logged or echoed back at full precision.
 */
export function resolveOrigin(
  db: DatabaseSync,
  input: { preset?: string | null; point?: { lat: number; lon: number } | null; gps?: boolean },
): ResolvedOrigin {
  const presets = getOriginPresets(db);
  if (input.point && isValidCoordinate(input.point.lat, input.point.lon)) {
    const s = snapOrigin(input.point);
    return { ...s, source: input.gps ? "gps" : "manual", label: input.gps ? "موقعیت شما" : "نقطه‌ی انتخابی روی نقشه", defaulted: false };
  }
  const hit = presets.find((p) => p.id === input.preset);
  if (hit) return { lat: hit.lat, lon: hit.lon, source: "manual", label: hit.label, defaulted: false };
  const def = presets[0] ?? { id: "ferdowsi", label: "فردوسی", lat: 35.6921, lon: 51.4225 };
  return { lat: def.lat, lon: def.lon, source: "manual", label: def.label, defaulted: true };
}
