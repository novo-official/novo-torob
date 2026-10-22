import type { RankingPriority } from "@/domain/comparison";
import { COMPARE_LIMITS } from "@/domain/comparison";
import { safeSellersBack, type OriginKey, ORIGIN_KEYS } from "@/lib/sellers-url";
import { isValidCoordinate, snapOrigin } from "@/lib/geo";

/**
 * Seller-comparison state lives in the URL (shareable; survives refresh/Back) — EXCEPT GPS coordinates (flag `o=gps` only).
 * `shop=` is the Phase 4 hand-off (one pre-selected seller); `shops=` is the 2–4 seller list. Both are accepted.
 */
export interface CompareParams {
  product: string | null;
  variant: string | null;
  shops: string[];
  origin: OriginKey | null;
  ll: { lat: number; lon: number } | null;
  radius: number;
  /** Tehran wall-clock «YYYY-MM-DDTHH:mm»; null = now */
  visit: string | null;
  bmin: number | null;
  bmax: number | null;
  strict: boolean;
  prio: RankingPriority;
  back: string | null;
}

type Get = { get(name: string): string | null };
const PRODUCT = /^product_[0-9a-f]{8,40}$/;
const SHOP = /^shop_[0-9a-f]{8,40}$/;
const VISIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const PRIOS: readonly RankingPriority[] = ["price", "distance", "hours", "payment", "warranty"];
const num = (v: string | null) => (v && /^\d{1,13}$/.test(v) && Number(v) > 0 ? Number(v) : null);

export function parseCompareParams(p: Get): CompareParams {
  const list = [p.get("shop") ?? "", ...(p.get("shops") ?? "").split(",")].map((s) => s.trim()).filter((s) => SHOP.test(s));
  const shops = [...new Set(list)].slice(0, COMPARE_LIMITS.maxSellers);
  const rawLl = (p.get("ll") ?? "").split(",");
  const lat = Number(rawLl[0]);
  const lon = Number(rawLl[1]);
  const ll = rawLl.length === 2 && isValidCoordinate(lat, lon) ? snapOrigin({ lat, lon }) : null;
  const o = p.get("o");
  const origin: OriginKey | null = o && (ORIGIN_KEYS as readonly string[]).includes(o) ? (o as OriginKey) : ll ? "map" : null;
  const r = Number(p.get("r"));
  const prio = p.get("prio") as RankingPriority | null;
  const visit = p.get("visit");
  return {
    product: PRODUCT.test(p.get("product") ?? "") ? p.get("product") : null,
    variant: (p.get("variant") ?? "").slice(0, 120) || null,
    shops, origin, ll: origin === "gps" ? null : ll,
    radius: Number.isFinite(r) && r >= 100 && r <= 50_000 ? Math.trunc(r) : 1000,
    visit: visit && VISIT.test(visit) ? visit : null,
    bmin: num(p.get("bmin")), bmax: num(p.get("bmax")), strict: p.get("strict") === "1",
    prio: prio && PRIOS.includes(prio) ? prio : "price",
    back: safeSellersBack(p.get("back")),
  };
}

export function buildCompareHref(a: Partial<CompareParams>, base = "/compare"): string {
  const sp = new URLSearchParams();
  if (a.product) sp.set("product", a.product);
  if (a.variant) sp.set("variant", a.variant);
  if (a.shops?.length) sp.set("shops", a.shops.slice(0, COMPARE_LIMITS.maxSellers).join(","));
  if (a.origin) sp.set("o", a.origin);
  if (a.ll && a.origin !== "gps") { const s = snapOrigin(a.ll); sp.set("ll", `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`); }
  if (a.radius && a.radius !== 1000) sp.set("r", String(a.radius));
  if (a.visit) sp.set("visit", a.visit);
  if (a.bmin) sp.set("bmin", String(a.bmin));
  if (a.bmax) sp.set("bmax", String(a.bmax));
  if (a.strict) sp.set("strict", "1");
  if (a.prio && a.prio !== "price") sp.set("prio", a.prio);
  if (a.back) sp.set("back", a.back);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
