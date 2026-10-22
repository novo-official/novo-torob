"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const NearbyMap = dynamic(() => import("@/components/sellers/nearby-map").then((m) => m.NearbyMap), {
  ssr: false,
  loading: () => <div role="status" className="grid h-full min-h-60 place-items-center rounded-2xl border border-line bg-surface-2 text-sm text-ink-2">در حال آماده‌سازی نقشه…</div>,
});

export function ShopMiniMap({ shop }: { shop: { id: string; name: string; lat: number; lon: number } }) {
  const [tiles, setTiles] = useState(true);
  return (
    <div className="space-y-2">
      <div className="h-64">
        <NearbyMap origin={null} radiusMeters={300} shops={[{ ...shop, distanceMeters: null }]} areas={[]} selectedShopId={shop.id} tilesEnabled={tiles} pickMode={false}
          onSelectShops={() => {}} onPickOrigin={() => {}} onTilesFailed={() => setTiles(false)} />
      </div>
      <p className="text-xs leading-6 text-ink-2">{tiles ? "نقشه‌ی خیابانی از OpenStreetMap بارگذاری می‌شود. " : "نقشه‌ی خیابانی در دسترس نیست؛ فقط نشانگر دیده می‌شود. "}<span dir="ltr">© OpenStreetMap contributors (ODbL)</span></p>
    </div>
  );
}
