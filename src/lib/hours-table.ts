import type { DayStatus, DeclaredHours, Weekday } from "@/domain/types";
import { toFaDigits } from "@/lib/format";

export const WEEKDAY_FA: Record<Weekday, string> = { sat: "شنبه", sun: "یکشنبه", mon: "دوشنبه", tue: "سه‌شنبه", wed: "چهارشنبه", thu: "پنجشنبه", fri: "جمعه" };
export const WEEK_ORDER: readonly Weekday[] = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];

export function dayText(d: DayStatus): { text: string; known: boolean } {
  switch (d.kind) {
    case "declared": return { text: d.windows.map((w) => `${toFaDigits(w.start)} تا ${toFaDigits(w.end === "24:00" ? "00:00" : w.end)}`).join(" و "), known: true };
    case "closed": return { text: "تعطیل (طبق اعلام)", known: true };
    case "unsupported": return { text: "قالب ساعت پشتیبانی نمی‌شود — نامشخص", known: false };
    default: return { text: "اعلام نشده", known: false };
  }
}

export function hoursTable(h: DeclaredHours): Array<{ day: Weekday; label: string; text: string; known: boolean }> {
  return WEEK_ORDER.map((day) => ({ day, label: WEEKDAY_FA[day], ...dayText(h.days[day]) }));
}

/** Only well-formed public links; Instagram must really be instagram.com. Never tel:/mailto:. */
export function safeShopLink(kind: "website" | "instagram", raw: string | null | undefined): { href: string; label: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !u.hostname.includes(".")) return null;
    const host = u.hostname.toLowerCase();
    if (kind === "instagram" && !(host === "instagram.com" || host.endsWith(".instagram.com"))) return null;
    return { href: u.href, label: kind === "instagram" ? `@${u.pathname.split("/").filter(Boolean)[0] ?? "instagram"}` : host.replace(/^www\./, "") };
  } catch {
    return null;
  }
}
