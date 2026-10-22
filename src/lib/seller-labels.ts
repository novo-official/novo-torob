import type { VariantMatchStatus } from "@/domain/sellers";
import type { OpenStatus } from "@/domain/types";
import { toFaDigits } from "@/lib/format";

const TEHRAN_CLOCK = new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const FA_DATE = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", year: "numeric", month: "long", day: "numeric" });

/** Declared hours only — the app never claims a shop is open "right now". Unknown is never "closed". */
export function hoursLabel(s: OpenStatus): { text: string; tone: "ok" | "neutral" | "warn" } {
  const at = s.nextChange?.at ? TEHRAN_CLOCK.format(new Date(s.nextChange.at)) : null;
  if (s.state === "open") return { text: `باز (طبق اعلام فروشگاه)${at ? ` · تا ${at}` : ""}`, tone: "ok" };
  if (s.state === "closed") return { text: `بسته (طبق اعلام فروشگاه)${at ? ` · بازگشایی ${at}` : ""}`, tone: "neutral" };
  return { text: "ساعت کاری اعلام نشده", tone: "warn" };
}

export function priceAgeLabel(newestAt: string | null, ageDays: number | null): string {
  if (!newestAt) return "زمان ثبت قیمت نامشخص";
  const d = Date.parse(newestAt);
  const when = Number.isFinite(d) ? FA_DATE.format(new Date(d)) : null;
  if (ageDays === null) return when ? `آخرین تغییر قیمت: ${when}` : "زمان ثبت قیمت نامشخص";
  const ago = ageDays === 0 ? "امروز" : `${toFaDigits(ageDays)} روز پیش`;
  return `آخرین تغییر قیمت: ${when ?? "—"} (${ago})`;
}

export const VARIANT_LABEL: Record<VariantMatchStatus, { text: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  PLAUSIBLE: { text: "احتمالاً همین نسخه (برداشت از عنوان فروشنده)", tone: "ok" },
  UNCERTAIN: { text: "نسخه‌ی نامطمئن — پیش از خرید تأیید شود", tone: "warn" },
  CONFLICTING: { text: "نسخه‌ی متفاوت با انتخاب شما", tone: "danger" },
  UNSELECTED: { text: "نسخه هنوز انتخاب نشده", tone: "warn" },
};

export const EVIDENCE_LABEL: Record<string, string> = {
  model_key_match: "کد مدل عنوان با نسخه‌ی انتخابی سازگار است",
  product_id_only: "فقط شناسه‌ی محصول یکی است؛ عنوان کد مدل متفاوتی ندارد",
  unit_mismatch: "واحد قیمت (متر/حلقه) با انتخاب شما فرق دارد",
  sibling_model: "کد مدل همخانواده ولی متفاوت است",
  unrelated_model: "کد مدل عنوان با نسخه‌ی انتخابی ارتباطی ندارد",
  no_model_key: "عنوان کد مدلی ندارد که بتوان با آن مقایسه کرد",
  variant_not_selected: "نسخه انتخاب نشده است",
};

/** Straight-line distance wording — never walking/driving time. */
export const DISTANCE_NOTE = "فاصله‌ی خط مستقیم است، نه مسیر پیاده یا خودرو.";

const FA_DATE_TIME = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const FA_DATE_ONLY = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", year: "numeric", month: "long", day: "numeric" });

/** Persian (Solar Hijri) date-time in Asia/Tehran for any ISO instant; null when unparsable. */
export function formatTehranDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? FA_DATE_TIME.format(new Date(t)) : null;
}
export function formatTehranDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? FA_DATE_ONLY.format(new Date(t)) : null;
}

/** Evidence-kind labels used side by side so categories are never conflated. */
export const EVIDENCE_KIND_FA = {
  datasetOffer: "پیشنهاد ثبت‌شده در داده",
  declaredHours: "ساعت اعلام‌شده‌ی فروشگاه",
  unverifiedStock: "موجودی تأییدنشده",
  manualReply: "پاسخ دستی (ثبت توسط شما)",
} as const;
