// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { GPS_MESSAGE, requestPosition, statusFromErrorCode } from "./gps";

const geo = (impl: (ok: PositionCallback, err: PositionErrorCallback, opts?: PositionOptions) => void) => ({ getCurrentPosition: vi.fn(impl) });
const pos = (latitude: number, longitude: number) => ({ coords: { latitude, longitude } }) as unknown as GeolocationPosition;

describe("optional GPS (user-triggered only)", () => {
  it("unsupported browsers resolve to 'unsupported' without throwing", async () => {
    expect(await requestPosition(undefined)).toEqual({ status: "unsupported" });
    expect(await requestPosition({} as never)).toEqual({ status: "unsupported" });
  });
  it("permission denied → 'denied' with a manual-fallback message", async () => {
    const r = await requestPosition(geo((_o, e) => e({ code: 1 } as GeolocationPositionError)));
    expect(r).toEqual({ status: "denied" });
    expect(GPS_MESSAGE.denied).toMatch(/دستی/);
  });
  it("timeout and unavailable are distinguished", async () => {
    expect(await requestPosition(geo((_o, e) => e({ code: 3 } as GeolocationPositionError)))).toEqual({ status: "timeout" });
    expect(await requestPosition(geo((_o, e) => e({ code: 2 } as GeolocationPositionError)))).toEqual({ status: "unavailable" });
    expect(statusFromErrorCode(99)).toBe("unavailable");
  });
  it("a successful reading is SNAPPED to ~100 m immediately", async () => {
    const r = await requestPosition(geo((ok) => ok(pos(35.692347, 51.422512))));
    expect(r).toEqual({ status: "granted", point: { lat: 35.692, lon: 51.423 } });
  });
  it("NaN readings are rejected, thrown errors are swallowed", async () => {
    expect(await requestPosition(geo((ok) => ok(pos(NaN, 51))))).toEqual({ status: "unavailable" });
    expect(await requestPosition({ getCurrentPosition: () => { throw new Error("x"); } })).toEqual({ status: "unavailable" });
  });
  it("asks for LOW accuracy with a bounded timeout and requests only once per call", async () => {
    const g = geo((ok) => ok(pos(35.69, 51.42)));
    await requestPosition(g, 5000);
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(g.getCurrentPosition.mock.calls[0]![2]).toMatchObject({ enableHighAccuracy: false, timeout: 5000 });
  });
});
