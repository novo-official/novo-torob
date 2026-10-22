import type { SellersSort } from "@/domain/sellers";
import { isValidCoordinate, snapOrigin } from "@/lib/geo";
import { safeBackHref } from "@/lib/advisor-url";

/**
 * The nearby-sellers view lives in the URL EXCEPT for GPS coordinates. A GPS origin is represented by the flag
 * `o=gps` only; the precise point stays in browser memory and travels in a POST body (see docs/phase-4-sellers.md §privacy).
 * Map-picked points are snapped to a ~100 m grid before they may appear in the URL (`ll=`).
 */
export type OriginKey = "ferdowsi" | "sheikh-hadi" | "baharestan" | "map" | "gps";
export const ORIGIN_KEYS: readonly OriginKey[] = ["ferdowsi", "sheikh-hadi", "baharestan", "map", "gps"];

export interface SellersParams {
  product: string | null;
  variant: string | null;
  bmin: number | null;
  bmax: number | null;
  origin: OriginKey | null;
  /** snapped map point (never a GPS point) */
  ll: { lat: number; lon: number } | null;
  radius: number;
  uncertain: boolean;
  sort: SellersSort;
  open: boolean;
  reliable: boolean;
  pay: string | null;
  page: number;
  /** selected shop (shared between list and map) */
  shop: string | null;
  view: "list" | "map";
  tiles: boolean | null;
  back: string | null;
  /** category for area-only recovery (no product) */
  category: string | null;
  /** shops ticked for the Phase 5 seller comparison (≤ 4) */
  cmp: string[];
}

type Get = { get(name: string): string | null };
const PRODUCT = /^product_[0-9a-f]{8,40}$/;
const SHOP = /^shop_[0-9a-f]{8,40}$/;
const num = (v: string | null) => (v && /^\d{1,13}$/.test(v) && Number(v) > 0 ? Number(v) : null);

export function parseSellersParams(p: Get): SellersParams {
  const rawLl = (p.get("ll") ?? "").split(",");
  const lat = Number(rawLl[0]);
  const lon = Number(rawLl[1]);
  const ll = rawLl.length === 2 && isValidCoordinate(lat, lon) ? snapOrigin({ lat, lon }) : null;
  const o = p.get("o");
  const origin: OriginKey | null = o && (ORIGIN_KEYS as readonly string[]).includes(o) ? (o as OriginKey) : ll ? "map" : null;
  const sort = p.get("sort");
  const radius = Number(p.get("r"));
  const pay = (p.get("pay") ?? "").trim().slice(0, 30);
  return {
    product: PRODUCT.test(p.get("product") ?? "") ? p.get("product") : null,
    variant: (p.get("variant") ?? "").slice(0, 120) || null,
    bmin: num(p.get("bmin")),
    bmax: num(p.get("bmax")),
    origin,
    ll: origin === "map" || origin === null ? ll : null,
    radius: Number.isFinite(radius) && radius >= 100 && radius <= 50_000 ? Math.trunc(radius) : 1000,
    uncertain: p.get("uncertain") === "1",
    sort: sort === "price" || sort === "recent" ? sort : "distance",
    open: p.get("open") === "1",
    reliable: p.get("reliable") === "1",
    pay: pay || null,
    page: Math.min(50, Math.max(1, Math.trunc(Number(p.get("page"))) || 1)),
    shop: SHOP.test(p.get("shop") ?? "") ? p.get("shop") : null,
    view: p.get("view") === "map" ? "map" : "list",
    tiles: p.get("tiles") === "1" ? true : p.get("tiles") === "0" ? false : null,
    back: safeBackHref(p.get("back")),
    category: (p.get("category") ?? "").trim().slice(0, 120) || null,
    cmp: [...new Set((p.get("cmp") ?? "").split(",").filter((x) => SHOP.test(x)))].slice(0, 4),
  };
}

export function buildSellersHref(a: Partial<SellersParams>, base = "/sellers"): string {
  const sp = new URLSearchParams();
  if (a.product) sp.set("product", a.product);
  if (a.variant) sp.set("variant", a.variant);
  if (a.bmin) sp.set("bmin", String(a.bmin));
  if (a.bmax) sp.set("bmax", String(a.bmax));
  if (a.origin) sp.set("o", a.origin);
  if (a.ll && a.origin !== "gps") {
    const s = snapOrigin(a.ll);
    sp.set("ll", `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`);
  }
  if (a.radius && a.radius !== 1000) sp.set("r", String(a.radius));
  if (a.uncertain) sp.set("uncertain", "1");
  if (a.sort && a.sort !== "distance") sp.set("sort", a.sort);
  if (a.open) sp.set("open", "1");
  if (a.reliable) sp.set("reliable", "1");
  if (a.pay) sp.set("pay", a.pay);
  if (a.page && a.page > 1) sp.set("page", String(a.page));
  if (a.shop) sp.set("shop", a.shop);
  if (a.view === "map") sp.set("view", "map");
  if (a.tiles === true) sp.set("tiles", "1");
  if (a.tiles === false) sp.set("tiles", "0");
  if (a.back) sp.set("back", a.back);
  if (a.category) sp.set("category", a.category);
  if (a.cmp?.length) sp.set("cmp", a.cmp.slice(0, 4).join(","));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Shop detail link that carries the product context (so the shop page can show THIS product's recorded offers). */
export function buildShopHref(shopId: string, ctx: { product?: string | null; variant?: string | null; back?: string | null } = {}): string {
  const sp = new URLSearchParams();
  if (ctx.product) sp.set("product", ctx.product);
  if (ctx.variant) sp.set("variant", ctx.variant);
  if (ctx.back) sp.set("back", ctx.back);
  const qs = sp.toString();
  return `/shops/${shopId}${qs ? `?${qs}` : ""}`;
}

/** Same-origin whitelist for returning from the shop page (nearby sellers or the seller comparison). */
export function safeSellersBack(v: string | null | undefined): string | null {
  if (!v || v.length > 700) return null;
  return /^\/(sellers|compare)(\?[^\s#]*)?$/.test(v) ? v : null;
}
