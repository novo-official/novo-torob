"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { TILE_CONFIG } from "@/lib/map-config";
import type { AreaRecommendation } from "@/domain/shopping-area";
import { AreaLeadCard } from "@/components/sellers/area-lead-card";

const NearbyMap = dynamic(() => import("@/components/sellers/nearby-map").then((m) => m.NearbyMap), {
  ssr: false,
  loading: () => <div role="status" className="grid h-full min-h-72 place-items-center rounded-2xl border border-line bg-surface-2 text-sm text-ink-2">در حال آماده‌سازی نقشه…</div>,
});

/** Area-only recovery (no product id): shopping-area leads with a map. No sellers, no offers, no stock claims. */
export function AreaExplorer({ areas, origin }: { areas: AreaRecommendation[]; origin: { lat: number; lon: number; label: string } | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [tiles, setTiles] = useState(TILE_CONFIG.enabled);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <ul className="min-w-0 space-y-3" aria-label="مناطق خرید پیشنهادی" data-testid="area-leads">
        {areas.map((r) => <AreaLeadCard key={r.area.id} rec={r} selected={selected === r.area.id} onShowOnMap={setSelected} />)}
      </ul>
      <div className="min-w-0 space-y-2">
        <div className="h-[24rem] lg:h-[32rem]">
          <NearbyMap
            origin={origin} radiusMeters={1000} shops={[]} areas={areas.map((r) => ({ id: r.area.id, name: r.area.nameFa, lat: r.area.center.lat, lon: r.area.center.lon, sourceType: r.area.sourceType }))}
            selectedShopId={null} selectedAreaId={selected} tilesEnabled={tiles} pickMode={false}
            onSelectShops={() => {}} onSelectArea={setSelected} onPickOrigin={() => {}} onTilesFailed={() => setTiles(false)}
          />
        </div>
        <p className="text-xs leading-6 text-ink-2">
          <span aria-hidden className="me-1 inline-block size-3 rotate-45 bg-[#b45309] align-middle" />نشانگر لوزی = منطقه‌ی پیشنهادی (فروشنده یا موجودی نیست). {tiles ? "نقشه‌ی خیابانی از OpenStreetMap بارگذاری می‌شود. " : "نقشه‌ی خیابانی در دسترس نیست؛ نشانگرها روی زمینه‌ی ساده‌اند. "}
          <span dir="ltr">© OpenStreetMap contributors (ODbL)</span>
        </p>
      </div>
    </div>
  );
}
