"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, Circle, TileLayer } from "leaflet";
import "leaflet/dist/leaflet.css";
import { TILE_CONFIG } from "@/lib/map-config";
import { buildAreaPins, buildShopPins, originPin, type AreaPinInput, type MapPin, type ShopPinInput } from "@/lib/map-model";

const TILE_ERROR_LIMIT = 4;

export interface NearbyMapProps {
  origin: { lat: number; lon: number; label: string } | null;
  radiusMeters: number;
  shops: ShopPinInput[];
  areas: AreaPinInput[];
  selectedShopId: string | null;
  selectedAreaId?: string | null;
  tilesEnabled: boolean;
  pickMode: boolean;
  onSelectShops: (ids: string[]) => void;
  onSelectArea?: (id: string) => void;
  onPickOrigin: (lat: number, lon: number) => void;
  onTilesFailed: () => void;
  onReady?: () => void;
}

const SHAPE = {
  shop: "<span class='pin pin-shop'></span>",
  area: "<span class='pin pin-area'></span>",
  origin: "<span class='pin pin-origin'></span>",
};

function iconHtml(pin: MapPin, selected: boolean): string {
  const cls = selected ? " pin-selected" : "";
  if (pin.kind === "shop") return `<span class='pin pin-shop${cls}' aria-hidden='true'></span>`;
  if (pin.kind === "shop-group") return `<span class='pin pin-shop pin-group${cls}' aria-hidden='true'>${new Intl.NumberFormat("fa-IR").format(pin.ids.length)}</span>`;
  if (pin.kind === "area") return `<span class='pin pin-area${cls}' aria-hidden='true'><i></i></span>`;
  return SHAPE.origin;
}

/**
 * Leaflet (BSD-2) map. Loaded only in the browser; if tiles are disabled or fail, pins still render on a plain
 * background so the list remains the source of truth. Marker kinds differ by SHAPE and accessible name:
 *   round teal = shop with a recorded offer · numbered round = shops sharing one coordinate ·
 *   amber diamond = shopping-area lead (NOT a seller) · ringed dot = your starting point.
 */
export function NearbyMap(props: NearbyMapProps) {
  const { origin, radiusMeters, shops, areas, selectedShopId, selectedAreaId, tilesEnabled, pickMode } = props;
  const host = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const circleRef = useRef<Circle | null>(null);
  const tileRef = useRef<TileLayer | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const cbs = useRef(props);
  useEffect(() => {
    cbs.current = props;
  });
  const fitted = useRef<string>("");
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  const pins = useMemo<MapPin[]>(() => {
    const out = [...buildShopPins(shops), ...buildAreaPins(areas)];
    const o = origin ? originPin(origin.lat, origin.lon, origin.label) : null;
    if (o) out.push(o);
    return out;
  }, [shops, areas, origin]);

  // create the map once
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const L = await import("leaflet");
      if (disposed || !host.current) return;
      leafletRef.current = L;
      const map = L.map(host.current, { zoomControl: true, attributionControl: true, keyboard: true }).setView([35.6921, 51.4225], 15);
      map.attributionControl.setPrefix(false);
      layerRef.current = L.layerGroup().addTo(map);
      map.on("click", (e) => {
        if (cbs.current.pickMode) cbs.current.onPickOrigin(e.latlng.lat, e.latlng.lng);
      });
      mapRef.current = map;
      // the container is sized by CSS/tabs after mount: keep Leaflet in sync and refit when it first becomes visible
      let lastWidth = 0;
      ro = new ResizeObserver(() => {
        if (!mapRef.current) return;
        const w = host.current?.clientWidth ?? 0;
        map.invalidateSize();
        if (lastWidth === 0 && w > 0) { fitted.current = ""; setTick((t) => t + 1); }
        lastWidth = w;
      });
      ro.observe(host.current);
      setReady(true);
      cbs.current.onReady?.();
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      // stop in-flight pan/zoom animations first: removing a map mid-animation throws inside Leaflet's rAF callback
      mapRef.current?.stop();
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
      layerRef.current = null;
      tileRef.current = null;
      circleRef.current = null;
    };
  }, []);

  // tiles on/off (+ graceful failure)
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    if (tileRef.current) { tileRef.current.remove(); tileRef.current = null; }
    if (!tilesEnabled) return;
    let errors = 0;
    if (!TILE_CONFIG.enabled) return;
    const layer = L.tileLayer(TILE_CONFIG.urlTemplate, { maxZoom: TILE_CONFIG.maxZoom, attribution: TILE_CONFIG.attributionHtml, crossOrigin: false, keepBuffer: 1 });
    layer.on("tileerror", () => {
      errors += 1;
      if (errors === TILE_ERROR_LIMIT) cbs.current.onTilesFailed();
    });
    layer.addTo(map);
    tileRef.current = layer;
  }, [tilesEnabled, ready]);

  // draw pins, radius ring, fit bounds
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!map || !L || !layer) return;
    layer.clearLayers();
    circleRef.current?.remove();
    circleRef.current = null;
    if (origin) circleRef.current = L.circle([origin.lat, origin.lon], { radius: radiusMeters, color: "#0a5c70", weight: 1.5, fillOpacity: 0.05, interactive: false }).addTo(map);
    for (const pin of pins) {
      const selected = (pin.kind === "area" ? pin.ids[0] === selectedAreaId : pin.ids.includes(selectedShopId ?? "")) && pin.kind !== "origin";
      const size = pin.kind === "shop-group" ? 34 : pin.kind === "area" ? 30 : pin.kind === "origin" ? 26 : 28;
      const marker = L.marker([pin.lat, pin.lon], {
        icon: L.divIcon({ className: "map-pin-host", html: iconHtml(pin, selected), iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        title: pin.label, alt: pin.label, keyboard: pin.kind !== "origin", riseOnHover: true, zIndexOffset: selected ? 1000 : pin.kind === "origin" ? 500 : pin.kind === "area" ? 100 : 0,
      }).addTo(layer);
      const el = marker.getElement();
      if (el) { el.setAttribute("role", pin.kind === "origin" ? "img" : "button"); el.setAttribute("aria-label", pin.label); el.setAttribute("data-pin-kind", pin.kind); }
      if (pin.kind === "area") marker.on("click", () => cbs.current.onSelectArea?.(pin.ids[0]!));
      else if (pin.kind !== "origin") marker.on("click", () => cbs.current.onSelectShops(pin.ids));
    }
    const sig = `${origin?.lat},${origin?.lon},${radiusMeters},${pins.length}`;
    if (fitted.current !== sig) {
      fitted.current = sig;
      const pts: Array<[number, number]> = pins.map((p) => [p.lat, p.lon]);
      if (origin) {
        const b = circleRef.current!.getBounds();
        pts.push([b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]);
      }
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 17, animate: false });
    }
  }, [pins, origin, radiusMeters, selectedShopId, selectedAreaId, ready, tick]);

  useEffect(() => {
    if (host.current) host.current.style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  return (
    <div
      ref={host}
      data-testid="nearby-map"
      role="region"
      aria-label="نقشه‌ی فروشگاه‌ها و مناطق خرید"
      className="relative z-0 h-full min-h-72 w-full overflow-hidden rounded-2xl border border-line bg-surface-2"
      dir="ltr"
    />
  );
}
