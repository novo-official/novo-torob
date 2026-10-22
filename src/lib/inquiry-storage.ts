import { STATUS_FA, initialInquiryState, type InquiryState, type ReplyEvidence } from "@/domain/inquiry";
import { LIMITS, sanitizeText } from "@/domain/inquiry-parse";

/**
 * Manual inquiries live in sessionStorage ONLY (this tab; gone when it closes or the user presses «پاک کردن»).
 * Never stored: phone numbers, coordinates, DEMO content. Demo mode is memory-only and is not even readable from here.
 * Everything read back is re-validated and re-sanitised (a tampered storage value can never become trusted evidence).
 */
export const STORAGE_VERSION = 1;
export const storageKey = (c: { product: string; shop: string; offer: string }) => `hamghadam.inquiry.v${STORAGE_VERSION}:${c.product}|${c.shop}|${c.offer}`;

const isoOrNull = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const oneOf = <T extends string>(v: unknown, set: readonly T[], d: T): T => (typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : d);

function sanitizeReply(r: unknown): ReplyEvidence | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (o.provenance !== "USER_REPORTED") return null; // demo (or anything else) is dropped
  if (typeof o.id !== "string" || !ID.test(o.id)) return null;
  const price = typeof o.reportedPriceToman === "number" && Number.isSafeInteger(o.reportedPriceToman) && o.reportedPriceToman > 0 && o.reportedPriceToman <= 1e13 ? o.reportedPriceToman : null;
  const w = (o.warranty ?? {}) as Record<string, unknown>;
  const months = typeof w.months === "number" && Number.isInteger(w.months) && w.months > 0 && w.months <= 240 ? w.months : null;
  return {
    id: o.id, provenance: "USER_REPORTED", rawText: sanitizeText(o.rawText, LIMITS.reply),
    stock: oneOf(o.stock, ["yes", "no", "unknown"], "unknown"), reportedPriceToman: price, reportedUnit: oneOf(o.reportedUnit, ["same", "per_metre", "roll_or_pack", "unknown"], "same"),
    model: oneOf(o.model, ["same", "different", "unsure", "not_asked"], "not_asked"), warranty: { report: oneOf(w.report, ["declared", "none", "not_asked"], "not_asked"), months },
    payment: oneOf(o.payment, ["in_person_ok", "not_available", "not_asked"], "not_asked"), visitNote: sanitizeText(o.visitNote, LIMITS.visitNote),
    receivedLabel: o.receivedLabel === null ? null : sanitizeText(o.receivedLabel, 60) || null, scenarioId: null,
  };
}

/** Pure + testable: returns a trusted InquiryState or null. */
export function sanitizeStoredInquiry(raw: unknown, validQuestionIds: readonly string[]): InquiryState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== STORAGE_VERSION) return null;
  const status = oneOf(o.status, Object.keys(STATUS_FA) as Array<keyof typeof STATUS_FA>, "DRAFT");
  const custom = (Array.isArray(o.customQuestions) ? o.customQuestions : [])
    .filter((c): c is { id: string; textFa: string } => !!c && typeof (c as { id?: unknown }).id === "string" && ID.test((c as { id: string }).id) && typeof (c as { textFa?: unknown }).textFa === "string")
    .slice(0, LIMITS.maxCustomQuestions).map((c) => ({ id: c.id, textFa: sanitizeText(c.textFa, LIMITS.custom) })).filter((c) => c.textFa);
  const allowed = new Set([...validQuestionIds, ...custom.map((c) => c.id)]);
  const ids = (Array.isArray(o.questionIds) ? o.questionIds : []).filter((i): i is string => typeof i === "string" && allowed.has(i));
  const replies = (Array.isArray(o.replies) ? o.replies : []).map(sanitizeReply).filter((r): r is ReplyEvidence => !!r).slice(-LIMITS.maxReplies);
  const base = initialInquiryState([...new Set(ids)]);
  return {
    ...base, status, questionIds: [...new Set(ids)], customQuestions: custom,
    previous: oneOf(o.previous, Object.keys(STATUS_FA) as Array<keyof typeof STATUS_FA>, "DRAFT") === o.previous ? (o.previous as InquiryState["previous"]) : null,
    draftOverride: typeof o.draftOverride === "string" ? sanitizeText(o.draftOverride, LIMITS.draft) || null : null,
    copiedAt: isoOrNull(o.copiedAt), contactedAt: isoOrNull(o.contactedAt), replies,
    nextAction: oneOf(o.nextAction, ["RECONFIRM_BEFORE_VISIT", "FIND_OTHER_SELLER", "COMPARE_AGAIN", "CLARIFY_VARIANT", "FOLLOW_UP", "ALTERNATIVE_PRODUCT", "CHECK_VISIT_HOURS", "AWAIT_REPLY"], "AWAIT_REPLY") === o.nextAction ? (o.nextAction as InquiryState["nextAction"]) : null,
    events: [],
  };
}

export function loadInquiry(key: string, validQuestionIds: readonly string[]): InquiryState | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? sanitizeStoredInquiry(JSON.parse(raw), validQuestionIds) : null;
  } catch { return null; }
}
export function saveInquiry(key: string, s: InquiryState): boolean {
  try { window.sessionStorage.setItem(key, JSON.stringify(s)); return true; } catch { return false; }
}
export function clearInquiry(key: string): void {
  try { window.sessionStorage.removeItem(key); } catch { /* storage unavailable: nothing to clear */ }
}
