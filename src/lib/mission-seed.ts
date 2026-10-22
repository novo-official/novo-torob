import type { MissionEvent, ShoppingMissionV1 } from "@/domain/mission";
import type { MissionSeed } from "@/lib/mission-url";

/** URL / assistant context → events for a NEW mission. Pure; every id is re-validated by the reducer and re-joined against the dataset on load. */
export function seedEvents(s: MissionSeed): MissionEvent[] {
  const ev: MissionEvent[] = [];
  if (s.need || s.category) ev.push({ type: "SET_NEED", text: s.need, category: s.category });
  if (s.bmin || s.bmax) ev.push({ type: "SET_BUDGET", min: s.bmin, max: s.bmax });
  if (s.district || s.radius) ev.push({ type: "SET_AREA", district: s.district, radius: s.radius ?? 1000 });
  if (s.priority) ev.push({ type: "SET_PRIORITY", priority: s.priority });
  if (s.product) {
    ev.push({ type: "SELECT_PRODUCT", productId: s.product, variantGroupId: s.variant });
    if (s.shop && s.offer) ev.push({ type: "SELECT_SHOP", shopId: s.shop, offerId: s.offer, via: "USER" });
    else if (s.shop) ev.push({ type: "SHORTLIST", shopIds: [s.shop] });
  }
  if (s.visit) ev.push({ type: "SET_VISIT", visit: s.visit });
  return ev;
}
export const hasSeed = (s: MissionSeed): boolean => seedEvents(s).length > 0;

/** the non-sensitive context of a mission, for URLs when browser storage is blocked (ids, budget, named district — nothing else) */
export function seedOfMission(m: ShoppingMissionV1): MissionSeed {
  return {
    product: m.product?.productId ?? null, variant: m.product?.variantGroupId ?? null, shop: m.shop?.shopId ?? m.shortlist[0] ?? null, offer: m.shop?.offerId ?? null, visit: m.visit,
    need: m.need.text, category: m.need.category, bmin: m.budget.min, bmax: m.budget.max, district: m.area.district, radius: m.area.radius, priority: m.priority,
  };
}
