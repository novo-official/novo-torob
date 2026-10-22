/**
 * Map tile configuration seam (Phase 5). The ONLY place that names a tile provider.
 * Default = OpenStreetMap standard raster tiles, which are acceptable solely for modest, interactive, user-driven viewing and
 * come with NO uptime guarantee (see docs/phase-5-compare.md §tile policy). A production provider decision is OPEN (Phase 10).
 *
 * Switching provider later = set the two env vars below at BUILD time (they are public by nature; never put API keys with
 * write/secret scope here — a provider that needs a key must be fronted by our own proxy instead).
 */
export interface TileConfig {
  id: string;
  /** Leaflet URL template */
  urlTemplate: string;
  /** attribution text required by the provider's terms (shown on the map and next to it) */
  attribution: string;
  /** the same attribution as safe HTML for Leaflet: OSM gets the link its tile policy asks for; custom text is HTML-escaped */
  attributionHtml: string;
  maxZoom: number;
  /** whether tiles may be requested at all (kill-switch for deployments without an approved provider) */
  enabled: boolean;
  /** true while this is the community OSM server (informational; drives the documented policy note) */
  isOsmCommunityServer: boolean;
}

const OSM: TileConfig = {
  id: "osm-standard",
  urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors (ODbL)",
  attributionHtml: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors (ODbL)',
  maxZoom: 19,
  enabled: true,
  isOsmCommunityServer: true,
};

const isHttpsTemplate = (t: string) => /^https:\/\/(?:\{s\}\.)?[^\s{}\/]+(\/\{z\}\/\{x\}\/\{y\}(\.\w+)?(\?[^\s]*)?)$/.test(t) && !/\/\/[^/]*@/.test(t);

/** Pure & testable: builds the config from (possibly absent) env-style inputs; invalid overrides fall back to OSM. */
export function resolveTileConfig(env: { url?: string | null; attribution?: string | null; disabled?: string | null } = {}): TileConfig {
  if (env.disabled === "1") return { ...OSM, enabled: false };
  const url = env.url?.trim();
  if (url && isHttpsTemplate(url) && env.attribution?.trim()) {
    const text = env.attribution.trim().slice(0, 200);
    return { id: "custom", urlTemplate: url, attribution: text, attributionHtml: text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!), maxZoom: 19, enabled: true, isOsmCommunityServer: /(^|\.)tile\.openstreetmap\.org\//.test(url.replace("https://", "")) };
  }
  return OSM;
}

export const TILE_CONFIG: TileConfig = resolveTileConfig({
  url: process.env.NEXT_PUBLIC_MAP_TILE_URL,
  attribution: process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION,
  disabled: process.env.NEXT_PUBLIC_MAP_TILES_DISABLED,
});

/**
 * `img-src` origins the CSP must allow for map tiles — derived from the SAME config, so an approved provider is added in ONE place and nothing else is opened.
 * `{s}` subdomain templates become a single wildcard origin; a disabled map adds nothing.
 */
export function tileImgSources(cfg: TileConfig): string[] {
  if (!cfg.enabled) return [];
  try {
    const u = new URL(cfg.urlTemplate.replace("{s}", "s").replace(/\{[xyz]\}/g, "0"));
    return [cfg.urlTemplate.includes("{s}") ? `https://*.${u.hostname.replace(/^s\./, "")}` : `https://${u.hostname}`];
  } catch { return []; }
}
