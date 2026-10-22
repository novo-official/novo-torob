import { snapOrigin, type LatLon } from "@/lib/geo";

/**
 * Optional, USER-TRIGGERED geolocation. Never called at page load. The raw reading is snapped to a ~100 m grid
 * immediately, so even the in-memory value (and anything sent to our server) is coarse.
 */
export type GpsStatus = "idle" | "requesting" | "granted" | "denied" | "unavailable" | "timeout" | "unsupported";

export type GpsResult = { status: "granted"; point: LatLon } | { status: Exclude<GpsStatus, "idle" | "requesting" | "granted"> };

type GeoLike = Pick<Geolocation, "getCurrentPosition">;

export function statusFromErrorCode(code: number): Exclude<GpsStatus, "idle" | "requesting" | "granted" | "unsupported"> {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

export function requestPosition(geo: GeoLike | undefined | null, timeoutMs = 10_000): Promise<GpsResult> {
  if (!geo || typeof geo.getCurrentPosition !== "function") return Promise.resolve({ status: "unsupported" });
  return new Promise((resolve) => {
    try {
      geo.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return resolve({ status: "unavailable" });
          resolve({ status: "granted", point: snapOrigin({ lat: latitude, lon: longitude }) });
        },
        (err) => resolve({ status: statusFromErrorCode(err.code) }),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
      );
    } catch {
      resolve({ status: "unavailable" });
    }
  });
}

export const GPS_MESSAGE: Record<GpsStatus, string | null> = {
  idle: null,
  requesting: "در حال دریافت موقعیت… (مرورگر ممکن است اجازه بخواهد)",
  granted: "از موقعیت تقریبی شما استفاده شد (گردشده به حدود ۱۰۰ متر؛ در نشانی صفحه ذخیره نمی‌شود).",
  denied: "اجازه‌ی موقعیت داده نشد. اشکالی ندارد — محله را دستی انتخاب کنید یا روی نقشه نقطه بگذارید. هر زمان خواستید دوباره امتحان کنید.",
  unavailable: "موقعیت در دسترس نیست. محله را دستی انتخاب کنید یا دوباره تلاش کنید.",
  timeout: "دریافت موقعیت طولانی شد. دوباره تلاش کنید یا محله را دستی انتخاب کنید.",
  unsupported: "این مرورگر موقعیت‌یابی را پشتیبانی نمی‌کند. محله را دستی انتخاب کنید.",
};
