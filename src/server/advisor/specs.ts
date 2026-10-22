import type { Evidence } from "@/domain/advisor";

/**
 * Evidence-based attribute extraction over messy Persian spec text.
 * Every attribute is tri-state: a value with evidence, or "unknown". Missing data is NEVER read as "no".
 */
export interface SpecEntry {
  key: string;
  value: string;
  /** lowercase / unified letters / ASCII digits; punctuation kept */
  nkey: string;
  nvalue: string;
}

export interface ProductText {
  title: string;
  ntitle: string;
  specs: SpecEntry[];
}

export type Confidence = "explicit" | "inferred" | "unknown";

export interface Attr<T> {
  value: T | null;
  confidence: Confidence;
  evidence: Evidence[];
  /** the title and the spec table disagree: no claim is made (treated as unknown) */
  conflict?: string;
}

export const unknownAttr = <T>(): Attr<T> => ({ value: null, confidence: "unknown", evidence: [] });

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Light normalisation for matching: unify Persian/Arabic letters, ASCII digits, decimal separators, ZWNJ → space. */
export function lite(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[٫،]/g, ".")
    .replace(/[يىئ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[أإٱ]/g, "ا")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[‌‍‎‏]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildProductText(title: string, specsJson: string | null): ProductText {
  let specs: SpecEntry[] = [];
  if (specsJson) {
    try {
      const arr = JSON.parse(specsJson) as Array<{ key: string; value: string }>;
      specs = arr.map((s) => ({ key: s.key, value: String(s.value), nkey: lite(s.key), nvalue: lite(String(s.value)) }));
    } catch {
      specs = [];
    }
  }
  return { title, ntitle: lite(title), specs };
}

/** tidy raw list separators that leak from the source ("a, |, b") and shorten long values */
const clip = (s: string, n = 70) => {
  const t = s.replace(/\s*[,،]\s*\|\s*[,،]?\s*/g, " ، ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export const specEvidence = (e: SpecEntry, confidence: Evidence["confidence"] = "explicit"): Evidence => ({ kind: "spec", label: e.key, text: clip(e.value), confidence });
export const titleEvidence = (text: string, confidence: Evidence["confidence"] = "explicit"): Evidence => ({ kind: "title", label: "عنوان", text: clip(text, 80), confidence });

export const specsWhere = (p: ProductText, keyRe: RegExp): SpecEntry[] => p.specs.filter((s) => keyRe.test(s.nkey));

/** First spec whose key matches and whose value matches `valueRe`. */
export function findSpec(p: ProductText, keyRe: RegExp, valueRe: RegExp): SpecEntry | undefined {
  return p.specs.find((s) => keyRe.test(s.nkey) && valueRe.test(s.nvalue));
}

/** Persian-aware "negation near the start of a value" ("ندارد", "فاقد …", "بدون …", "خیر"). */
export const NEGATIVE = /^(ندارد|فاقد|بدون|خیر|نیست|no|none|-|0|بدون قابلیت)(\b|\s|$)|\b(ندارد|فاقد)\b/;
export const POSITIVE = /^(دارد|بله|دار|yes|true|پشتیبانی|قابلیت|فعال|\d+\s*(عدد|میکروفون))|\bدارد\b/;

/** Parse "8/5", "8.5", "۸٫۵" (and "1/2" as a fraction) into a number; used for kW / HP style figures. */
export function parseDecimal(raw: string): number | null {
  const s = lite(raw);
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 1 && b >= 2 && b <= 4) return a / b; // "1/2" = half, "1/4" = quarter
    return Number(`${a}.${b}`); // "8/5" = 8.5 (slash used as decimal separator in these titles)
  }
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && s.length > 0 ? n : null;
}

/**
 * Combine a number read from the spec table with one read from the title. If both exist and differ
 * by more than 10 %, the product contradicts itself → unknown + conflict note (never silently pick one).
 */
export function reconcileNumeric(spec: Attr<number> | null, title: Attr<number> | null, label: string): Attr<number> {
  if (spec && title && spec.value !== null && title.value !== null) {
    const hi = Math.max(spec.value, title.value);
    const lo = Math.min(spec.value, title.value);
    if (lo > 0 && (hi - lo) / hi > 0.1) {
      return { value: null, confidence: "unknown", evidence: [...spec.evidence, ...title.evidence], conflict: `${label} در عنوان (${title.value}) و مشخصات (${spec.value}) یکسان نیست` };
    }
  }
  return spec ?? title ?? unknownAttr();
}
