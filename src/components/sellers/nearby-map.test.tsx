import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NearbyMap, type NearbyMapProps } from "./nearby-map";

// jsdom has no layout: give the container a size and a ResizeObserver stub
class RO { observe() {} disconnect() {} unobserve() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });

const base = (over: Partial<NearbyMapProps> = {}): NearbyMapProps => ({
  origin: { lat: 35.6921, lon: 51.4225, label: "فردوسی" }, radiusMeters: 1000,
  shops: [{ id: "shop_a", name: "الف", lat: 35.692, lon: 51.4225, distanceMeters: 10 }, { id: "shop_b", name: "ب", lat: 35.692, lon: 51.4225, distanceMeters: 10 }, { id: "shop_c", name: "ج", lat: 35.694, lon: 51.42, distanceMeters: 300 }],
  areas: [{ id: "curated-x", name: "لاله‌زار", lat: 35.689, lon: 51.4225, sourceType: "curated_external" }],
  selectedShopId: null, tilesEnabled: false, pickMode: false, onSelectShops: vi.fn(), onPickOrigin: vi.fn(), onTilesFailed: vi.fn(), ...over,
});

const pins = (c: HTMLElement) => [...c.querySelectorAll("[data-pin-kind]")].map((e) => ({ kind: e.getAttribute("data-pin-kind"), label: e.getAttribute("aria-label") }));

describe("NearbyMap (Leaflet)", () => {
  it("renders distinct, labelled pins for shops, a shared-coordinate group, an area lead and the origin — with NO tiles when tiles are off", async () => {
    const { container } = render(<NearbyMap {...base()} />);
    await waitFor(() => expect(container.querySelectorAll("[data-pin-kind]").length).toBe(4));
    const p = pins(container);
    expect(p.map((x) => x.kind).sort()).toEqual(["area", "origin", "shop", "shop-group"]);
    expect(p.find((x) => x.kind === "area")!.label).toMatch(/فروشنده نیست/);
    expect(p.find((x) => x.kind === "shop-group")!.label).toMatch(/مختصات یکسان/);
    expect(container.querySelectorAll(".leaflet-tile").length).toBe(0);
    expect(container.querySelector('img[src*="openstreetmap"]')).toBeNull();
    expect(screen.getByRole("region", { name: /نقشه/ })).toBeTruthy();
  });
  it("with tiles on, attribution is shown; repeated tile errors trigger the no-tiles fallback callback", async () => {
    const onTilesFailed = vi.fn();
    const { container } = render(<NearbyMap {...base({ tilesEnabled: true, onTilesFailed })} />);
    await waitFor(() => expect(container.querySelector(".leaflet-control-attribution")?.textContent).toMatch(/OpenStreetMap/));
    await waitFor(() => expect(container.querySelectorAll(".leaflet-tile").length).toBeGreaterThan(0));
    act(() => { container.querySelectorAll(".leaflet-tile").forEach((t) => t.dispatchEvent(new Event("error"))); });
    await waitFor(() => expect(onTilesFailed).toHaveBeenCalled());
  });
  it("invalid coordinates produce no pin and no crash", async () => {
    const { container } = render(<NearbyMap {...base({ shops: [{ id: "x", name: "x", lat: NaN, lon: NaN, distanceMeters: null }, { id: "y", name: "y", lat: 0, lon: 0, distanceMeters: null }], areas: [] })} />);
    await waitFor(() => expect(container.querySelector("[data-pin-kind=origin]")).toBeTruthy());
    expect(pins(container).map((x) => x.kind)).toEqual(["origin"]);
  });
  it("works without an origin (area-only recovery map)", async () => {
    const { container } = render(<NearbyMap {...base({ origin: null, shops: [] })} />);
    await waitFor(() => expect(container.querySelector("[data-pin-kind=area]")).toBeTruthy());
    expect(container.querySelector("[data-pin-kind=origin]")).toBeNull();
  });
});
