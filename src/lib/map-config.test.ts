// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveTileConfig, TILE_CONFIG, tileImgSources } from "./map-config";

describe("tile provider seam", () => {
  it("defaults to OSM standard raster over https with attribution (no keys, no paid vendor)", () => {
    expect(TILE_CONFIG.id).toBe("osm-standard");
    expect(TILE_CONFIG.urlTemplate).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(TILE_CONFIG.attribution).toContain("OpenStreetMap");
    expect(TILE_CONFIG.isOsmCommunityServer).toBe(true);
  });
  it("accepts a well-formed https override only together with an attribution text", () => {
    const c = resolveTileConfig({ url: "https://tiles.example.com/{z}/{x}/{y}.png", attribution: "© Example Maps" });
    expect(c).toMatchObject({ id: "custom", isOsmCommunityServer: false, attribution: "© Example Maps" });
    expect(resolveTileConfig({ url: "https://tiles.example.com/{z}/{x}/{y}.png" }).id).toBe("osm-standard");
  });
  it("rejects http, credentials, missing placeholders and junk — falls back to OSM", () => {
    for (const url of ["http://t.example.com/{z}/{x}/{y}.png", "https://u:p@t.example.com/{z}/{x}/{y}.png", "https://t.example.com/tiles.png", "javascript:alert(1)", ""]) {
      expect(resolveTileConfig({ url, attribution: "x" }).id, url).toBe("osm-standard");
    }
  });
  it("has a kill-switch for deployments without an approved provider", () => expect(resolveTileConfig({ disabled: "1" }).enabled).toBe(false));
  it("OSM attribution carries the copyright link its tile policy asks for; custom attribution is HTML-escaped", () => {
    expect(TILE_CONFIG.attributionHtml).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(resolveTileConfig({ url: "https://tiles.example.com/{z}/{x}/{y}.png", attribution: '<img src=x onerror=alert(1)> © "Ex"' }).attributionHtml).not.toContain("<img");
  });
  it("the CSP img-src for tiles comes from the SAME config: default OSM host only (no wildcard), {s} templates → one wildcard origin, disabled → nothing", () => {
    expect(tileImgSources(TILE_CONFIG)).toEqual(["https://tile.openstreetmap.org"]);
    expect(tileImgSources(resolveTileConfig({ url: "https://{s}.tiles.example.com/{z}/{x}/{y}.png", attribution: "© Ex" }))).toEqual(["https://*.tiles.example.com"]);
    expect(tileImgSources(resolveTileConfig({ url: "https://tiles.example.com/{z}/{x}/{y}.png", attribution: "© Ex" }))).toEqual(["https://tiles.example.com"]);
    expect(tileImgSources(resolveTileConfig({ disabled: "1" }))).toEqual([]);
  });
});
