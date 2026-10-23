import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// A build with NEXT_PUBLIC_MAP_TILES_DISABLED=1 must never tell the user that street tiles are loaded from OpenStreetMap.
vi.mock("@/lib/map-config", async (orig) => {
  const m = await orig<typeof import("@/lib/map-config")>();
  return { ...m, TILE_CONFIG: { ...m.TILE_CONFIG, enabled: false } };
});
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { ShopMiniMap } from "./shop-mini-map";
import { AreaExplorer } from "./area-explorer";

describe("map tiles disabled by the deployment", () => {
  it("shop mini-map does not claim OSM tiles are loading", () => {
    render(<ShopMiniMap shop={{ id: "shop_a", name: "الف", lat: 35.69, lon: 51.41 }} />);
    expect(screen.getByText(/نقشه‌ی خیابانی در دسترس نیست/)).toBeTruthy();
    expect(screen.queryByText(/از OpenStreetMap بارگذاری می‌شود/)).toBeNull();
  });
  it("area explorer does not claim OSM tiles are loading", () => {
    const { container } = render(<AreaExplorer areas={[]} origin={null} />);
    expect(container.textContent).not.toMatch(/از OpenStreetMap بارگذاری می‌شود/);
  });
});
