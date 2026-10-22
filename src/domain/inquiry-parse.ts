import { toLatinDigits } from "@/lib/format";

/**
 * Untrusted-text helpers for the inquiry workspace. User/seller text is DATA: it is never rendered as HTML/Markdown
 * and never interpreted as an instruction. These helpers only bound and clean it.
 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** bidi overrides / isolates / zero-width joiners used for text spoofing (ZWNJ U+200C is legitimate Persian and is kept) */
const SPOOF = /[‪-‮⁦-⁩​‍⁠﻿]/g;

export function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input.replace(CONTROL, "").replace(SPOOF, "").replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").slice(0, max).trim();
}

export const LIMITS = { draft: 2500, reply: 1200, custom: 160, visitNote: 160, maxCustomQuestions: 4, maxReplies: 10, maxEvents: 60 } as const;

// ---------- amounts ----------
export type AmountInterpretation =
  | { kind: "ok"; toman: number; basis: "explicit_toman" | "explicit_rial" | "multiplier_assumed_toman" | "user_chose_toman" | "user_chose_rial"; assumed: boolean }
  | { kind: "ambiguous"; value: number; hintFa: string | null }
  | { kind: "invalid"; reason: "empty" | "not_a_number" | "nonpositive" | "unsafe" | "too_large" };

const MAX_TOMAN = 1e13; // same bound as quality flag PRICE_ABSURD_MAGNITUDE
const MULT: Record<string, number> = { "هزار": 1e3, "میلیون": 1e6, "ملیون": 1e6, "میلیارد": 1e9 };
const AMOUNT = /^([0-9]+(?:\.[0-9]+)?)\s*(هزار|میلیون|ملیون|میلیارد)?\s*(تومان|تومن|ت|ریال|ریالی)?$/u;

/**
 * Interpret a typed amount. Rules (Persian commerce: toman vs rial must never be guessed):
 *  - explicit «تومان/تومن» → toman;  explicit «ریال» → rial ÷ 10;
 *  - multiplier word without unit («۴ میلیون») is accepted as toman ONLY when a recorded price exists and the result is within 0.1×–10× of it;
 *  - a bare number is AMBIGUOUS unless the user explicitly chose the unit (`unit`), with a hint when the value looks like the recorded price in rial/toman.
 */
export function interpretAmount(raw: string, recordedToman: number | null, unit: "toman" | "rial" | null = null): AmountInterpretation {
  const cleaned = toLatinDigits(sanitizeText(raw, 60)).replace(/٫/g, ".").replace(/[٬,،\s]+(?=\d{3}(\D|$))/g, "");
  if (!cleaned.trim()) return { kind: "invalid", reason: "empty" };
  const m = AMOUNT.exec(cleaned.trim().replace(/\s+/g, " "));
  if (!m) return { kind: "invalid", reason: "not_a_number" };
  const num = Number(m[1]);
  const mult = m[2] ? MULT[m[2]]! : 1;
  const unitWord = m[3];
  if (!Number.isFinite(num) || num <= 0) return { kind: "invalid", reason: "nonpositive" };
  const value = num * mult;
  const check = (toman: number): AmountInterpretation | null => {
    if (!Number.isFinite(toman) || !Number.isSafeInteger(Math.round(toman))) return { kind: "invalid", reason: "unsafe" };
    if (toman < 1) return { kind: "invalid", reason: "nonpositive" };
    if (toman > MAX_TOMAN) return { kind: "invalid", reason: "too_large" };
    return null;
  };
  if (unitWord) {
    const rial = unitWord.startsWith("ریال");
    const toman = Math.round(rial ? value / 10 : value);
    return check(toman) ?? { kind: "ok", toman, basis: rial ? "explicit_rial" : "explicit_toman", assumed: false };
  }
  if (unit) {
    const toman = Math.round(unit === "rial" ? value / 10 : value);
    return check(toman) ?? { kind: "ok", toman, basis: unit === "rial" ? "user_chose_rial" : "user_chose_toman", assumed: false };
  }
  if (m[2] && recordedToman) {
    const ratio = value / recordedToman;
    if (ratio >= 0.1 && ratio <= 10) {
      const toman = Math.round(value);
      return check(toman) ?? { kind: "ok", toman, basis: "multiplier_assumed_toman", assumed: true };
    }
  }
  let hintFa: string | null = null;
  if (recordedToman) {
    if (value / 10 >= recordedToman * 0.5 && value / 10 <= recordedToman * 2) hintFa = "عدد به قیمت ثبت‌شده شبیه است اگر «ریال» باشد.";
    else if (value >= recordedToman * 0.5 && value <= recordedToman * 2) hintFa = "عدد به قیمت ثبت‌شده شبیه است اگر «تومان» باشد.";
  }
  return { kind: "ambiguous", value, hintFa };
}

export interface PriceDelta { recordedToman: number; reportedToman: number; deltaToman: number; pct: number; direction: "same" | "higher" | "lower" }

/** Reported vs recorded. `pct` is only meaningful with a positive recorded price; null recorded → no comparison (never invented). */
export function comparePrices(recordedToman: number | null, reportedToman: number | null): PriceDelta | null {
  if (!recordedToman || recordedToman <= 0 || !reportedToman || reportedToman <= 0) return null;
  const deltaToman = reportedToman - recordedToman;
  const pct = Math.round((deltaToman / recordedToman) * 1000) / 10;
  return { recordedToman, reportedToman, deltaToman, pct, direction: deltaToman === 0 ? "same" : deltaToman > 0 ? "higher" : "lower" };
}

// ---------- suggestions from pasted text (NEVER auto-applied) ----------
export interface ReplySuggestion { stock: "yes" | "no" | null; modelDifferent: boolean; amountText: string | null }

const NEG_STOCK = /(موجود\s*نیست|ناموجود|تموم\s*شده|تمام\s*شده|نداریم|نداره|موجودی\s*نداریم)/u;
const POS_STOCK = /(موجود\s*(هست|است|می‌?باشد|داریم)|داریم(?!\s*نه)|هست)(?!\s*نه)/u;
const DIFF_MODEL = /(مدل\s*(دیگر|دیگه|متفاوت)|نسخه\s*(دیگر|دیگه)|جایگزین|مشابه|اینو\s*نداریم|همین\s*مدل\s*نیست)/u;

/** Keyword hints to PRE-FILL the structured form; the user must confirm. Conservative: ambiguity → null. */
export function suggestFromText(text: string): ReplySuggestion {
  const t = sanitizeText(text, 1200);
  const neg = NEG_STOCK.test(t);
  const pos = POS_STOCK.test(t);
  const stock = neg && !pos ? "no" : pos && !neg ? "yes" : null;
  const amount = /([0-9۰-۹٠-٩][0-9۰-۹٠-٩.,٬،٫\s]*\s*(?:هزار|میلیون|ملیون|میلیارد)?\s*(?:تومان|تومن|ریال))/u.exec(t);
  return { stock, modelDifferent: DIFF_MODEL.test(t), amountText: amount ? amount[1]!.trim() : null };
}
