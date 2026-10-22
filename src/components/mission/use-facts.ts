"use client";

import { useEffect, useState } from "react";
import type { ShoppingMissionV1 } from "@/domain/mission";
import type { MissionFacts } from "@/domain/mission-recovery";

export type { MissionFacts };
export interface FactsState { facts: MissionFacts | null; loading: boolean; failed: boolean }

/** fetches READ-ONLY dataset facts for the ids the mission names; refetches when product/variant/shop/offer/visit change */
export function useMissionFacts(m: ShoppingMissionV1 | null): FactsState {
  const [s, setS] = useState<FactsState & { key: string }>({ key: "", facts: null, loading: false, failed: false });
  const key = m?.product ? [m.product.productId, m.product.variantGroupId ?? "", m.shop?.shopId ?? "", m.shop?.offerId ?? "", m.visit ?? ""].join("|") : "";
  useEffect(() => {
    if (!key || !m?.product) return;
    const ac = new AbortController();
    const sp = new URLSearchParams({ product: m.product.productId });
    if (m.product.variantGroupId) sp.set("variant", m.product.variantGroupId);
    if (m.shop) { sp.set("shop", m.shop.shopId); sp.set("offer", m.shop.offerId); }
    if (m.visit) sp.set("visit", m.visit);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setS((p) => ({ ...p, key, loading: true, failed: false }));
    fetch(`/api/missions/facts?${sp}`, { signal: ac.signal, cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as MissionFacts; })
      .then((facts) => setS({ key, facts, loading: false, failed: false }))
      .catch((e) => { if (!(e instanceof DOMException && e.name === "AbortError")) setS({ key, facts: null, loading: false, failed: true }); });
    return () => ac.abort();
    // the key captures every field the request depends on
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return !key ? { facts: null, loading: false, failed: false } : { facts: s.key === key ? s.facts : null, loading: s.key !== key || s.loading, failed: s.key === key && s.failed };
}
