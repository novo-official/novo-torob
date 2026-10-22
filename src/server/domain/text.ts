/**
 * Persian-aware text helpers shared by the importer (index time) and the repositories (query time).
 * Pure functions — no I/O, no database.
 *
 * Limitation (documented in docs/phase-2-data.md): this is normalisation + tokenisation, NOT stemming
 * or typo correction. FTS5 alone does not solve Persian spelling variants; Phase 3 builds on top.
 */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toAsciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

/** Lower-case, NFKC, unify Arabic/Persian letter variants, ASCII digits, strip diacritics and punctuation. */
export function normalizeSearchText(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.normalize("NFKC");
  s = s.replace(/‌/g, " "); // ZWNJ acts as a space (نیم‌فاصله)
  s = s.replace(/[​‍‎‏؜﻿]/g, "");
  s = toAsciiDigits(s);
  s = s
    .replace(/[يىئ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[أإٱ]/g, "ا")
    .replace(/ؤ/g, "و");
  s = s.replace(/[ً-ٰٟـ]/g, ""); // harakat, dagger alef, tatweel
  s = s.toLowerCase();
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  return s.replace(/\s+/g, " ").trim();
}

// ---------- model keys ----------

// Measurements / words that merely contain a digit are NOT model identifiers.
const UNIT_SUFFIX = /^\d+(UF|MM|CM|KW|HP|V|A|W|GB|TB|MP|MAH|HZ|KG|M|CC|MA|AH|VA|KVA|RPM|BAR|MBPS|IN|INCH|PCS|ML|DPI|DBI|X\d+)$/;
const MEASURE_CHAIN = /^(?:\d+(?:\.\d+)?[A-Z]{1,4})+$/; // 25V15A1W, 12V7AH …
const WORD_NUMBER = /^[A-Z]{7,}\d{1,2}$/; // NECKLACE5, BLUETOOTH5

function isModelLike(token: string): boolean {
  return (
    token.length >= 5 && /[A-Z]/.test(token) && /[0-9]/.test(token) &&
    !UNIT_SUFFIX.test(token) && !MEASURE_CHAIN.test(token) && !WORD_NUMBER.test(token)
  );
}

/**
 * Extract comparable model identifiers ("DH-HAC-HDW1200CLQP-IL-A" → DHHACHDW1200CLQPILA, HDW1200CLQP).
 * Upper-case compact keys; separators (- _ / .) are removed. Additionally:
 *  - a letters-only token followed by ONE space and a token is also tried joined ("FTP 4E-200S" → FTP4E200S)
 *  - a short leading number is stripped ("43XH600" → also XH600; "55DU8000" → also DU8000)
 */
export function extractModelKeys(text: string | null | undefined): string[] {
  if (!text) return [];
  const t = toAsciiDigits(text.normalize("NFKC")).toUpperCase();
  const out = new Set<string>();
  const add = (compact: string) => {
    if (!isModelLike(compact)) return;
    out.add(compact);
    const stripped = compact.replace(/^\d{1,3}(?=[A-Z])/, "");
    if (stripped !== compact && isModelLike(stripped)) out.add(stripped);
  };
  const matches = [...t.matchAll(/[A-Z0-9](?:[A-Z0-9\-_/.]*[A-Z0-9])?/g)];
  matches.forEach((m, i) => {
    const parts = m[0].split(/[-_/.]+/).filter(Boolean);
    add(parts.join(""));
    for (const p of parts) add(p);
    const next = matches[i + 1];
    // join only "LETTERS" + "token with digits" (FTP + 4E-200S); never glue measurements onto a model
    if (next && /^[A-Z]{2,4}$/.test(m[0]) && next.index === m.index! + m[0].length + 1 && t[m.index! + m[0].length] === " ") {
      const joined = (m[0] + next[0]).replace(/[-_/.]+/g, "");
      if (joined.length <= 24 && /[0-9]/.test(joined) && /[A-Z]/.test(joined)) add(joined);
    }
  });
  return [...out];
}

/** Two key sets are compatible if any pair is equal or one is a (≥6 chars) prefix of the other. */
export function keysCompatible(a: readonly string[], b: readonly string[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      const short = Math.min(x.length, y.length);
      if (short >= 6 && (x.startsWith(y) || y.startsWith(x))) return true;
    }
  }
  return false;
}

/** Levenshtein distance, early-exits above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Optimal-string-alignment distance (insert/delete/substitute + adjacent transposition), early exit above `max`. */
export function osaDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m]!;
}

/** Near-identical but different identifiers (GV3P60 / GV3P65, LC1D95AM7 / LC1D50AM7): a probable different VARIANT. */
export function areSiblingKeys(x: string, y: string): boolean {
  if (x === y || Math.min(x.length, y.length) < 5) return false;
  const d = editDistance(x, y, 3);
  return d >= 1 && d <= 3 && d / Math.max(x.length, y.length) <= 0.34 && x.slice(0, 2) === y.slice(0, 2);
}

export type ModelRelation = "unknown" | "compatible" | "sibling" | "unrelated";

/**
 * How does an offer's model key set relate to the product's?
 *  unknown    – one side has no usable key
 *  compatible – same key (or prefix family)
 *  sibling    – different but near-identical key → probably a DIFFERENT variant (blocks price comparison)
 *  unrelated  – different keys with no visible kinship → can't confirm it's the same model (does not block)
 */
export function modelRelation(productKeys: readonly string[], offerKeys: readonly string[]): ModelRelation {
  if (!productKeys.length || !offerKeys.length) return "unknown";
  if (keysCompatible(productKeys, offerKeys)) return "compatible";
  for (const x of productKeys) for (const y of offerKeys) if (areSiblingKeys(x, y)) return "sibling";
  return "unrelated";
}

// ---------- price unit hints ----------

export type UnitHint = "per_metre" | "roll_or_pack" | "unknown";

const PER_METRE =
  /(?:قیمت|فروش)\s*(?:هر\s*)?متری|قیمت\s*(?:هر\s*)?متر|هر\s*متر|\(\s*(?:1|یک)\s*متر(?:ی)?\s*\)|به\s*متر(?![\p{L}])/u;
const ROLL_OR_PACK = /(?<![\p{L}])(?:حلقه|رول|کلاف|کارتن|بسته‌ی|بسته\s+\d+)(?![\p{L}])/u;

/**
 * Hint (NOT proof) about what unit the recorded price refers to, from the seller title alone.
 * "unknown" means the title says nothing; it does not mean "piece".
 */
export function detectUnitHint(sellerTitle: string | null | undefined): UnitHint {
  if (!sellerTitle) return "unknown";
  const t = toAsciiDigits(sellerTitle.normalize("NFKC")).replace(/‌/g, " ");
  if (PER_METRE.test(t)) return "per_metre";
  if (ROLL_OR_PACK.test(t)) return "roll_or_pack";
  return "unknown";
}

// ---------- FTS query ----------

const MAX_TOKENS = 8;
const MAX_TOKEN_LEN = 40;

export interface MatchQuery {
  tokens: string[];
  /** All tokens required; last token matches as a prefix. */
  and: string;
  /** Any token; used only as a clearly-labelled fallback. */
  or: string;
}

/** Build a safe FTS5 MATCH expression. Every token is quoted, so user text can never inject FTS syntax. */
export function buildMatchQuery(userText: string): MatchQuery | null {
  const tokens = normalizeSearchText(userText)
    .split(" ")
    .filter((t) => t.length > 0)
    .map((t) => t.slice(0, MAX_TOKEN_LEN))
    .slice(0, MAX_TOKENS);
  if (tokens.length === 0) return null;
  const quote = (t: string) => `"${t.replace(/"/g, '""')}"`;
  const last = tokens.length - 1;
  const parts = tokens.map((t, i) => (i === last && t.length >= 2 ? `${quote(t)}*` : quote(t)));
  return { tokens, and: parts.join(" AND "), or: parts.join(" OR ") };
}

// ---------- URLs ----------

/** Accept only well-formed http(s) URLs without credentials; returns the normalised href or null. */
export function safePublicUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}
