import type { DatabaseSync } from "node:sqlite";
import { sanitizeText } from "@/domain/inquiry-parse";
import { toLatinDigits } from "@/lib/format";
import { resolveCategory } from "@/server/advisor/resolve-category";

/**
 * Deterministic Persian understanding of ONE user message. Its output is a HINT for planning and a source of explicit,
 * user-stated preferences (budget, radius, district, model). It is never a source of product/seller facts.
 */
export type IntentFlag = "sellers" | "compare" | "review" | "inquiry" | "alternatives" | "areas" | "reset" | "showResults" | "reply" | "send" | "hours" | "phone" | "stock";

export interface Understanding {
  text: string;
  category: string | null;
  categoryChoices: string[];
  budget: { min: number | null; max: number | null } | null;
  model: string | null;
  radius: number | null;
  district: "ferdowsi" | "sheikh-hadi" | "baharestan" | null;
  intents: IntentFlag[];
  constraints: { hard: string[]; soft: string[] };
  /** need text without model/numbers, for the advisor */
  needText: string;
  /** the message names a product need (not just a budget/radius/district/command) */
  hasNeed: boolean;
  empty: boolean;
}

const MULT: Record<string, number> = { "هزار": 1e3, "میلیون": 1e6, "ملیون": 1e6, "میلیارد": 1e9 };
const NUM = "([0-9]+(?:\\.[0-9]+)?)";
const AMT = `${NUM}\\s*(هزار|میلیون|ملیون|میلیارد)?\\s*(?:تومان|تومن|ت)?`;
const toToman = (n: string, m: string | undefined): number | null => { const v = Number(n) * (m ? MULT[m]! : 1); return Number.isFinite(v) && v >= 1000 && v <= 1e12 ? Math.round(v) : null; };

export function normalizeMessage(raw: string, max = 600): string {
  return sanitizeText(raw, max).normalize("NFKC").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[٬،,](?=\d{3})/g, "");
}

/** «تا ۳ میلیون»، «۲ تا ۴ میلیون»، «زیر ۵۰۰ هزار»، «بودجه‌ام ۳ میلیونه»، «حداقل ۲ میلیون». Bare numbers without a unit word are NOT read as a budget. */
export function parseBudgetPhrase(textIn: string): { min: number | null; max: number | null } | null {
  const t = toLatinDigits(normalizeMessage(textIn)).replace(/‌/g, " ");
  const range = new RegExp(`${AMT}\\s*(?:تا|الی|-)\\s*${AMT}`, "u").exec(t);
  if (range && (range[2] || range[4] || /تومان|تومن|بودجه/.test(t))) {
    const mult = range[4] ?? range[2];
    const lo = toToman(range[1]!, range[2] ?? mult);
    const hi = toToman(range[3]!, range[4] ?? mult);
    if (lo !== null && hi !== null && lo <= hi) return { min: lo, max: hi };
  }
  const mx = new RegExp(`(?:تا|حداکثر|زیر|کمتر از|نهایتاً|نهایتا|سقف|بودجه(?:\\s*ام|‌?ام)?(?:\\s*حدود)?|بودجه)\\s*${AMT}`, "u").exec(t);
  if (mx && (mx[2] || /تومان|تومن|بودجه/.test(mx[0]))) { const v = toToman(mx[1]!, mx[2]); if (v !== null) return { min: null, max: v }; }
  const mn = new RegExp(`(?:از|حداقل|بالای|بیشتر از|بیش از)\\s*${AMT}`, "u").exec(t);
  if (mn && (mn[2] || /تومان|تومن/.test(mn[0]))) { const v = toToman(mn[1]!, mn[2]); if (v !== null) return { min: v, max: null }; }
  const plain = new RegExp(`${AMT}\\s*(?:بودجه|تومان|تومن)`, "u").exec(t);
  if (plain && (plain[2] || /تومان|تومن/.test(plain[0]))) { const v = toToman(plain[1]!, plain[2]); if (v !== null) return { min: null, max: v }; }
  return null;
}

export function parseRadius(textIn: string): number | null {
  const t = toLatinDigits(normalizeMessage(textIn));
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(کیلومتر|کیلو|کم|متر)/u.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] === "متر" ? 1 : 1000);
  return Number.isFinite(v) && v >= 100 && v <= 50_000 ? Math.round(v) : null;
}

export function parseDistrict(textIn: string): Understanding["district"] {
  const t = normalizeMessage(textIn).replace(/‌/g, " ");
  if (/شیخ\s*هادی/u.test(t)) return "sheikh-hadi";
  if (/بهارستان/u.test(t)) return "baharestan";
  if (/فردوسی/u.test(t)) return "ferdowsi";
  return null;
}

/** An exact model code: letters+digits, ≥ 4 chars, e.g. HDW1200CLQP, DH-HAC-HDW1200CLQP-IL-A, T13, JD8500. */
export function parseModel(textIn: string): string | null {
  const t = toLatinDigits(normalizeMessage(textIn)).toUpperCase();
  const c = [...t.matchAll(/[A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)*/g)].map((m) => m[0]).filter((x) => /[A-Z]/.test(x) && /\d/.test(x) && x.replace(/[-/]/g, "").length >= 3 && !/^\d+$/.test(x));
  c.sort((a, b) => b.length - a.length);
  return c[0]?.slice(0, 40) ?? null;
}

const RULES: Array<[IntentFlag, RegExp]> = [
  ["reset", /(از\s*اول|از\s*نو|پاک\s*کن|ریست|شروع\s*مجدد)/u],
  ["sellers", /(فروشنده|فروشگاه|کجا\s*(?:می‌?تونم\s*)?(?:بخرم|پیدا)|نزدیک|اطراف)/u],
  ["compare", /(مقایسه|ارزان‌?ترین|ارزون‌?ترین|بهترین\s*فروشنده|کدام\s*فروشنده|کدوم\s*فروشنده)/u],
  ["hours", /(ساعت\s*کار|باز(?:ه|\s*(?:است|هست|میشه|می‌?شه))\s*[؟?]?|بسته\s*(?:است|هست|س|ست)|ساعت\s*[0-9۰-۹]+\s*(?:شب|صبح|ظهر|عصر)?|تا\s*کی\s*باز)/u],
  ["phone", /(شماره(?:‌?ی)?\s*(?:تلفن|موبایل|فروشنده|تماس)|تلفن\s*(?:فروشنده|مغازه)|واتس‌?اپ\s*فروشنده)/u],
  ["stock", /(مطمئن(?:ی|ید)?\s*(?:که\s*)?موجود|موجود(?:ه|\s*(?:هست|است))\s*[؟?]|موجودی\s*(?:دارن|داره|هست))/u],
  ["review", /(نظر|ریویو|بازبینی|مشخصات|نقد|امتیاز|کیفیتش|چطوره|چطور\s*است|نقاط\s*(?:قوت|ضعف)|مزایا|معایب)/u],
  ["inquiry", /(بپرسم|سؤال|سوال|پیش‌?نویس|پرس‌?وجو|پیام\s*بنویس|متن\s*پیام|استعلام)/u],
  // a request for an ACTION the assistant cannot take (contact / order / pay): answered with a draft + an explicit refusal
  ["send", /(پیامک\s*بزن|پیام\s*(?:بده|بفرست|بزن)|زنگ\s*بزن|تماس\s*بگیر|ارسال\s*کن|بفرست\s*برا|واتس‌?اپ|(?:سفارش|خرید)\s*(?:بده|کن|ثبت)|پرداخت\s*کن|بگو\s*بخرم|\b(?:sms|whatsapp|call them|text them|order it|buy it)\b)/iu],
  ["alternatives", /(جایگزین|مشابه|بدیل|یه\s*چیز\s*دیگه|گزینه‌?ی\s*دیگر)/u],
  ["areas", /(پاساژ|بازار|منطقه|محله|خیابان|بورس)/u],
  ["showResults", /(نتایج\s*(?:را|رو)?\s*نشان|همین\s*حالا|پیشنهاد(?:ها)?\s*(?:را|رو)?\s*نشان|نشانم\s*بده)/u],
  ["reply", /(فروشنده\s*(?:گفت|می‌?گه|جواب)|گفت(?:ن|ند)?\s*(?:که\s*)?(?:موجود|نیست|داریم)|پاسخ\s*داد)/u],
];

const FILLER = new Set(["تا", "از", "رو", "را", "می‌خوام", "میخوام", "می‌خواهم", "بودجه", "بودجه‌ام", "بودجه‌م", "تومان", "تومن", "حدود", "برای", "یه", "یک", "من", "لطفا", "لطفاً", "خوب", "فروشنده", "فروشنده‌ها", "فروشنده‌های", "فروشگاه", "فروشگاه‌ها", "نزدیک", "اطراف", "فردوسی", "بهارستان", "شیخ", "هادی", "مقایسه", "کن", "کنید", "بده", "بدید", "نشان", "نشانم", "همین", "این", "آن", "را", "و", "در", "با", "به", "هم", "نظر", "کاربران", "درباره‌ی", "چیه", "چطوره", "پیام", "بنویس", "سؤال", "سوال", "حالا", "نتایج", "کیلومتر", "متر", "دنبال", "ام", "می‌شه", "میشه", "ممکنه", "پیدا", "کنم", "بخرم", "کجا"]);

export function understand(db: DatabaseSync, raw: string): Understanding {
  const text = normalizeMessage(raw);
  const intents = RULES.filter(([, re]) => re.test(text)).map(([f]) => f);
  const model = parseModel(text);
  const district = parseDistrict(text);
  const radius = parseRadius(text);
  const budget = parseBudgetPhrase(text);
  const hard: string[] = [];
  const soft: string[] = [];
  for (const m of text.matchAll(/(?:حتماً|حتما|باید|الزاماً)\s+([^،.؟!\n]{3,50})/gu)) hard.push(m[1]!.trim());
  for (const m of text.matchAll(/(?:ترجیحاً|ترجیحا|اگر\s*شد|دوست\s*دارم)\s+([^،.؟!\n]{3,50})/gu)) soft.push(m[1]!.trim());
  const needText = toLatinDigits(text).replace(/[A-Za-z][A-Za-z0-9\-/]*\d[A-Za-z0-9\-/]*/g, " ").replace(/[0-9]+(?:\.[0-9]+)?\s*(?:هزار|میلیون|ملیون|میلیارد|تومان|تومن|کیلومتر|کیلو|کم|متر)?/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  const hasNeed = needText.split(/\s+/).filter((w) => w.length >= 2 && !FILLER.has(w)).length > 0;
  let category: string | null = null;
  let categoryChoices: string[] = [];
  if (hasNeed && !(intents.length === 1 && intents[0] === "reset")) {
    const r = resolveCategory(db, needText);
    category = r.auto;
    categoryChoices = r.choices.slice(0, 5).map((c) => c.category);
  }
  return { text, category, categoryChoices, budget, model, radius, district, intents, constraints: { hard: hard.slice(0, 3), soft: soft.slice(0, 3) }, needText, hasNeed, empty: text.length === 0 };
}
