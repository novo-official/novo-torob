import { looksLikeInjection } from "@/domain/evidence";
import { toLatinDigits } from "@/lib/format";
import type { Ledger } from "./ledger";

export interface GroundingResult { ok: boolean; violations: string[] }

const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:com|ir|org|net|io|co|app|dev)\b/i;
const PHONE_RE = /(?<!\d)(?:\+?98|0)?9\d{9}(?!\d)|(?<!\d)0\d{2}[-\s]?\d{8}(?!\d)/;
const COORD_RE = /(?<!\d)(?:3[5-6]|5[01])[.٫]\d{3,}(?!\d)/;
const SENT_RE = /(ارسال\s*شد|فرستاده\s*شد|پیام\s*(?:را\s*)?(?:ارسال|فرستاد)(?:م|یم)|تماس\s*گرفت(?:م|یم)|پیام\s*دادم|به\s*فروشنده\s*(?:گفتم|اطلاع\s*دادم)|رزرو\s*(?:شد|کردم)|سفارش\s*(?:ثبت|داده)\s*شد)/u;
const STOCK_RE = /(?<!گزارش شما: |طبق گزارش شما |گفت |می‌گوید |ادعای فروشنده |گفته |بگوید )(?:موجود\s*(?:است|هست|می‌باشد)|در\s*انبار\s*(?:است|هست|دارند)|موجودی\s*تأیید\s*شد)(?![^«»]*»)(?!\s*؟)/u;
const RATING_RE = /(?:امتیاز|ستاره|رتبه‌ی?\s*کاربران)\s*[:؟]?\s*[0-9۰-۹]+(?:[.٫][0-9۰-۹]+)?|[0-9۰-۹]+\s*(?:نظر|دیدگاه|ریویو|رأی|رای)(?![\p{L}])/u;
const ABSOLUTE_RE = /(پرفروش|محبوب‌?ترین|پرطرفدار|بهترین\s*(?:کیفیت|گزینه|انتخاب)|تضمین(?:ی)?\s*(?:کیفیت|قیمت|موجودی))/u;
const LEAK_RE = /(system\s*prompt|api[_\s-]?key|AGENT_API|Bearer\s|دستورالعمل\s*سیستم)/i;
// a quoted mention («ارزان‌ترین» needs two reliable prices) is a caveat, not a claim
const CHEAPEST_RE = /(?<!«)ارزان‌?ترین(?!»)/u;
const NUM_RE = /[0-9۰-۹][0-9۰-۹٬,،.٫]*/g;
const UNIT_AFTER = /^\s*(?:فروشگاه|فروشنده|پیشنهاد|محصول|گزینه|مورد|کیلومتر|کیلو|متر|درصد|٪|%|تومان|ریال|روز)/u;

const parseNum = (tok: string): number | null => {
  const t = toLatinDigits(tok).replace(/[٬,،]/g, "").replace(/٫/g, ".").replace(/\.$/, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const isYear = (n: number) => (n >= 1300 && n <= 1500) || (n >= 2000 && n <= 2100);

/**
 * Deterministic claim check for assistant text. Anything that could mislead a purchase must trace to the turn's ledger:
 * numbers ≥ 1000 and any number attached to a counting/price/distance word must have been RETURNED by a tool; links, phones,
 * coordinates, send/contact claims, unattributed stock claims, ratings, review counts, absolutes and secret-leaks are rejected.
 */
export function validateAssistantText(text: string, ledger: Ledger, maxChars = 1400): GroundingResult {
  const v: string[] = [];
  if (text.length > maxChars) v.push("TOO_LONG");
  if (!text.trim()) v.push("EMPTY");
  if (URL_RE.test(text)) v.push("URL_IN_TEXT");
  if (PHONE_RE.test(toLatinDigits(text))) v.push("PHONE_IN_TEXT");
  if (COORD_RE.test(toLatinDigits(text))) v.push("COORDINATES_IN_TEXT");
  if (SENT_RE.test(text)) v.push("CLAIMS_MESSAGE_SENT");
  if (STOCK_RE.test(text)) v.push("UNATTRIBUTED_STOCK_CLAIM");
  if (RATING_RE.test(text)) v.push("RATING_OR_REVIEW_COUNT");
  if (ABSOLUTE_RE.test(text)) v.push("ABSOLUTE_CLAIM");
  if (LEAK_RE.test(text)) v.push("SECRET_OR_PROMPT_LEAK");
  if (CHEAPEST_RE.test(text) && !ledger.flags.has("VERDICT_CONFIRMED")) v.push("UNCONDITIONAL_CHEAPEST");
  for (const u of ledger.untrustedTexts) if (u.length >= 24 && looksLikeInjection(u) && text.includes(u.slice(0, 24))) v.push("ECHOES_INJECTED_TEXT");
  for (const m of text.matchAll(NUM_RE)) {
    const n = parseNum(m[0]);
    if (n === null) continue;
    // digits glued to Latin letters are part of a model code / identifier (HDW1200CLQP, JD8500THEB), not a numeric claim — the live model quoting a product code must not be rejected
    const idx = m.index ?? 0;
    if (/[A-Za-z]/.test(text[idx - 1] ?? "") || /[A-Za-z]/.test(text[idx + m[0].length] ?? "")) continue;
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 14);
    const needs = n >= 1000 ? !isYear(n) : UNIT_AFTER.test(after);
    if (needs && !ledger.numbers.has(n) && !ledger.numbers.has(Math.round(n))) v.push(`UNGROUNDED_NUMBER:${m[0]}`);
  }
  return { ok: v.length === 0, violations: [...new Set(v)] };
}
