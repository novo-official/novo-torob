/**
 * Hand-off from the seller comparison to the (manual, local) inquiry workspace. Only validated dataset ids travel;
 * the page resolves names/titles on the server. No message is sent anywhere.
 */
const PRODUCT = /^product_[0-9a-f]{8,40}$/;
const SHOP = /^shop_[0-9a-f]{8,40}$/;
const OFFER = /^offer_[0-9a-f]{8,40}$/;

export interface MissionContext { product: string | null; variant: string | null; shop: string | null; offer: string | null; back: string | null; visit: string | null }

export function buildMissionHref(c: Partial<MissionContext>): string {
  const sp = new URLSearchParams();
  if (c.product && PRODUCT.test(c.product)) sp.set("product", c.product);
  if (c.variant) sp.set("variant", c.variant.slice(0, 120));
  if (c.shop && SHOP.test(c.shop)) sp.set("shop", c.shop);
  if (c.offer && OFFER.test(c.offer)) sp.set("offer", c.offer);
  if (c.visit && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c.visit)) sp.set("visit", c.visit);
  if (c.back && /^\/(compare|sellers)(\?[^\s#]*)?$/.test(c.back) && c.back.length < 900) sp.set("back", c.back);
  const qs = sp.toString();
  return `/missions/new${qs ? `?${qs}` : ""}`;
}

export function parseMissionContext(get: (k: string) => string | null): MissionContext {
  const v = (k: string, re: RegExp) => { const x = get(k); return x && re.test(x) ? x : null; };
  const back = get("back");
  return {
    product: v("product", PRODUCT), shop: v("shop", SHOP), offer: v("offer", OFFER),
    variant: (get("variant") ?? "").slice(0, 120) || null,
    visit: v("visit", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    back: back && /^\/(compare|sellers)(\?[^\s#]*)?$/.test(back) && back.length < 900 ? back : null,
  };
}

// ---------- Phase 8: mission routes ----------
export const MISSION_TABS = ["summary", "visit", "inquiry", "recover", "device"] as const;
export type MissionTab = (typeof MISSION_TABS)[number];
const MISSION_ID = /^msn_[0-9a-f]{32}$/;
export const isMissionTab = (v: string | null | undefined): v is MissionTab => !!v && (MISSION_TABS as readonly string[]).includes(v);

export function buildMissionPageHref(id: string, tab?: MissionTab | null): string {
  if (!MISSION_ID.test(id)) return "/missions";
  return `/missions/${id}${tab && tab !== "summary" ? `?tab=${tab}` : ""}`;
}

/** what may travel from a page/agent into a NEW mission: dataset ids, the user's own budget/district/radius, a short need text. Never GPS, phones or replies. */
export interface MissionSeed {
  product: string | null; variant: string | null; shop: string | null; offer: string | null; visit: string | null;
  need: string | null; category: string | null; bmin: number | null; bmax: number | null; district: "ferdowsi" | "sheikh-hadi" | "baharestan" | null; radius: number | null;
  priority: "price" | "distance" | "hours" | "payment" | "warranty" | null;
}
const D = ["ferdowsi", "sheikh-hadi", "baharestan"] as const;
const P = ["price", "distance", "hours", "payment", "warranty"] as const;

export function buildMissionStartHref(s: Partial<MissionSeed>): string {
  const sp = new URLSearchParams();
  if (s.product && PRODUCT.test(s.product)) sp.set("product", s.product);
  if (s.variant) sp.set("variant", s.variant.slice(0, 120));
  if (s.shop && SHOP.test(s.shop)) sp.set("shop", s.shop);
  if (s.offer && OFFER.test(s.offer)) sp.set("offer", s.offer);
  if (s.visit && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.visit)) sp.set("visit", s.visit);
  if (s.need) sp.set("need", s.need.slice(0, 120));
  if (s.category) sp.set("category", s.category.slice(0, 120));
  if (s.bmin && Number.isSafeInteger(s.bmin) && s.bmin > 0) sp.set("bmin", String(s.bmin));
  if (s.bmax && Number.isSafeInteger(s.bmax) && s.bmax > 0) sp.set("bmax", String(s.bmax));
  if (s.district && (D as readonly string[]).includes(s.district)) sp.set("district", s.district);
  if (s.radius && Number.isInteger(s.radius) && s.radius >= 100 && s.radius <= 50_000) sp.set("radius", String(s.radius));
  if (s.priority && (P as readonly string[]).includes(s.priority)) sp.set("priority", s.priority);
  const qs = sp.toString();
  return `/missions/start${qs ? `?${qs}` : ""}`;
}

export function parseMissionSeed(get: (k: string) => string | null): MissionSeed {
  const re = (k: string, r: RegExp) => { const x = get(k); return x && r.test(x) ? x : null; };
  const num = (k: string, min: number, max: number) => { const x = get(k); if (!x || !/^\d{1,13}$/.test(x)) return null; const n = Number(x); return n >= min && n <= max ? n : null; };
  const pick = <T extends string>(k: string, set: readonly T[]): T | null => { const x = get(k); return x && (set as readonly string[]).includes(x) ? (x as T) : null; };
  return {
    product: re("product", PRODUCT), variant: (get("variant") ?? "").slice(0, 120) || null, shop: re("shop", SHOP), offer: re("offer", OFFER), visit: re("visit", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    need: (get("need") ?? "").slice(0, 120) || null, category: (get("category") ?? "").slice(0, 120) || null, bmin: num("bmin", 1, 1e12), bmax: num("bmax", 1, 1e12),
    district: pick("district", D), radius: num("radius", 100, 50_000), priority: pick("priority", P),
  };
}
