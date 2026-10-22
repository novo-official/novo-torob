import type { ShoppingMissionV1 } from "@/domain/mission";
import { buildCompareHref } from "@/lib/compare-url";
import { buildSellersHref } from "@/lib/sellers-url";

/** links back to the earlier steps carrying ONLY the mission's non-sensitive context (named district preset, radius, budget, ids) — never GPS */
export function missionLinks(m: ShoppingMissionV1): { sellers: string; compare: string } {
  const product = m.product?.productId ?? null;
  const variant = m.product?.variantGroupId ?? null;
  const origin = m.area.district;
  const shops = [...new Set([...(m.shop ? [m.shop.shopId] : []), ...m.shortlist])].slice(0, 4);
  return {
    sellers: buildSellersHref({ product, variant, origin, radius: m.area.radius, bmin: m.budget.min, bmax: m.budget.max }),
    compare: buildCompareHref({ product, variant, shops, origin, radius: m.area.radius, bmin: m.budget.min, bmax: m.budget.max, prio: m.priority, visit: m.visit }),
  };
}
