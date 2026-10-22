// @vitest-environment node
import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/haversine-python.json";
import { boundingBox, externalMapLink, formatDistance, haversineMeters, isInTehran, isValidCoordinate, medianCenter, snapOrigin, snapToGrid } from "./geo";

describe("haversine vs an independent implementation (Python, same sphere radius)", () => {
  it("has ≥ 20 spot-checks", () => expect(fixture.pairs.length).toBeGreaterThanOrEqual(20));
  it.each(fixture.pairs.map((p, i) => [i, p] as const))("pair %i matches within 1 m", (_i, p) => {
    const d = haversineMeters(p.origin.lat, p.origin.lon, p.shop.lat, p.shop.lon);
    expect(Math.abs(d - p.meters)).toBeLessThan(1);
  });
  it("is symmetric and zero for identical points", () => {
    expect(haversineMeters(35.69, 51.42, 35.69, 51.42)).toBe(0);
    expect(haversineMeters(35.69, 51.42, 35.7, 51.43)).toBeCloseTo(haversineMeters(35.7, 51.43, 35.69, 51.42), 6);
  });
  it("one degree of latitude ≈ 111.2 km", () => expect(haversineMeters(35, 51, 36, 51)).toBeGreaterThan(111_000));
});

describe("bounding box, validity, snapping", () => {
  it("bbox contains every point within the radius", () => {
    const o = { lat: 35.6921, lon: 51.4225 };
    const bb = boundingBox(o.lat, o.lon, 1000);
    for (const [dLat, dLon] of [[0.0089, 0], [-0.0089, 0], [0, 0.011], [0, -0.011], [0.005, 0.005]]) {
      const p = { lat: o.lat + dLat!, lon: o.lon + dLon! };
      if (haversineMeters(o.lat, o.lon, p.lat, p.lon) <= 1000) expect(p.lat >= bb.minLat && p.lat <= bb.maxLat && p.lon >= bb.minLon && p.lon <= bb.maxLon).toBe(true);
    }
  });
  it("rejects invalid / repeated-zero / NaN coordinates", () => {
    for (const [a, b] of [[NaN, 51], [35, Infinity], [91, 51], [35, 181], [0, 0], ["35", "51"]]) expect(isValidCoordinate(a, b)).toBe(false);
    expect(isValidCoordinate(35.69, 51.42)).toBe(true);
  });
  it("Tehran box", () => { expect(isInTehran(35.69, 51.42)).toBe(true); expect(isInTehran(32.6, 51.6)).toBe(false); });
  it("snaps to a ~100 m grid (privacy) and is idempotent", () => {
    const s = snapOrigin({ lat: 35.692347, lon: 51.422512 });
    expect(s).toEqual({ lat: 35.692, lon: 51.423 });
    expect(snapOrigin(s)).toEqual(s);
    expect(snapToGrid(35.6924)).toBe(35.692);
  });
  it("median center is robust to one far outlier", () => {
    const c = medianCenter([{ lat: 35.69, lon: 51.42 }, { lat: 35.6901, lon: 51.4201 }, { lat: 35.6902, lon: 51.4202 }, { lat: 36.5, lon: 52.5 }]);
    expect(c.lat).toBeLessThan(35.7);
  });
});

describe("distance wording and external links", () => {
  it("formats metres/kilometres in Persian digits, without time claims", () => {
    expect(formatDistance(754)).toMatch(/متر/);
    expect(formatDistance(2400)).toMatch(/کیلومتر/);
    for (const m of [10, 900, 5000]) expect(formatDistance(m)).not.toMatch(/دقیقه|ساعت|پیاده|رانندگی/);
  });
  it("builds the OSM link only from validated DESTINATION coordinates", () => {
    const l = externalMapLink(35.6921, 51.4225)!;
    expect(l.startsWith("https://www.openstreetmap.org/")).toBe(true);
    expect(l).toContain("mlat=35.692100");
    expect(externalMapLink(NaN, 51)).toBeNull();
    expect(externalMapLink(0, 0)).toBeNull();
  });
});
