const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";

/** Convert ASCII digits to Persian digits. */
export function toFaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA[Number(d)]!);
}

/** Convert Persian / Arabic-Indic digits (and separators) to ASCII for parsing. */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
    .replace(/[٬،,]/g, "")
    .replace(/٫/g, ".");
}

/** "۱۲٬۵۰۰٬۰۰۰ تومان". Returns null for non-finite input so callers must decide what to show. */
export function formatToman(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Math.round(value))} تومان`;
}

/** "۱٬۲۵۰٬۰۰۰" — grouped Persian digits without a unit (for editable fields). */
export function formatNumberFa(value: number): string {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Math.round(value));
}

/**
 * Parse a user-typed budget (Persian/Arabic/ASCII digits, grouping separators allowed).
 * Returns null for empty or invalid input — never 0 as a stand-in.
 */
export function parseBudget(raw: string): number | null {
  const cleaned = toLatinDigits(raw).replace(/\s+/g, "").replace(/تومان$/u, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Normalise Persian text for comparison (Arabic ya/kaf, digits, ZWNJ, diacritics). */
export function normalizeFa(input: string): string {
  return toLatinDigits(input)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/‌/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate long user text before echoing it back in the UI. */
export function clip(input: string, max = 120): string {
  const s = input.trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** decodeURIComponent that never throws on malformed escapes (e.g. "%E0%A4%A"). */
export function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}
