import { validateEvidenceSource, type EvidenceSource } from "./provenance";

/**
 * Phase 7 external-evidence contracts (specs and reviews). EXTENDS the Phase 5 `EvidenceSource`; never replaces dataset facts.
 * There is deliberately NO field for star ratings, review counts, popularity or sentiment scores: those would have to be invented.
 */
export type EvidenceItemKind = "SPEC_CLAIM" | "EXPERT_REVIEW" | "USER_REVIEW_SUMMARY";
export type MatchConfidence = "high" | "medium" | "low";
export const PASSAGE_MAX = 280;
export const SUMMARY_MAX = 320;

export interface Passage { id: string; /** short excerpt/paraphrase, ≤ 280 chars — never a long verbatim copy */ text: string; /** where in the source the span comes from (e.g. «JSON-LD description», «review body»); quotes are verbatim in the SOURCE language */ field?: string }
export interface ClaimLine { text: string; passageId: string }

export interface ExternalEvidenceItem {
  id: string;
  kind: EvidenceItemKind;
  source: EvidenceSource;
  productMatch: { productId: string; modelKey: string | null; method: NonNullable<EvidenceSource["match"]>["method"]; confidence: MatchConfidence };
  /** the model identifier the SOURCE names (may differ from the dataset's) — compared, never assumed equal */
  modelClaimed: string | null;
  passages: Passage[];
  summary: string;
  strengths: ClaimLine[];
  weaknesses: ClaimLine[];
  limitations: string[];
  /** true for QA/demo fixtures: synthetic text that is NOT a real independent source */
  fixture: boolean;
  /**
   * true = a human-verified REFERENCE only: no third-party text is fetched, cached or reproduced (rights unclear). `retrievedAt` is then the date of the
   * human review, not of an automated read.
   */
  linkOnly?: boolean;
}

export interface EnrichmentResult {
  productId: string;
  status: "NO_EVIDENCE" | "PARTIAL" | "OK" | "DISABLED";
  mode: "off" | "fixture" | "live";
  items: ExternalEvidenceItem[];
  /** statements where the external source disagrees with the official dataset (the dataset record is NEVER overwritten) */
  conflicts: string[];
  notes: string[];
  retrievedAt: string;
  adapters: Array<{ id: string; version: string; outcome: "ok" | "no_match" | "rejected" | "error" | "skipped"; detail?: string }>;
  cached: boolean;
  /** counts of items dropped by validation (injection, bad URL, bad match…) — for tests and transparency */
  rejected: number;
}

const INJECTION = [
  /ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|prompts?)/i,
  /disregard\s+(?:the\s+)?(?:system|previous|above)/i,
  /(?:reveal|show|print|leak)\s+(?:your\s+|the\s+)?(?:system\s+prompt|instructions?|api[\s_-]?key|secret)/i,
  /you\s+are\s+now\s+(?:a|an|in)\b/i,
  /\b(?:system|assistant)\s*:\s/i,
  /<\s*\/?\s*(?:script|iframe|object|embed|style)\b/i,
  /(?:دستورات|دستور)\s*(?:قبلی|بالا)\s*(?:را|رو)?\s*(?:نادیده|فراموش)/u,
  /(?:کلید|رمز)\s*(?:api|محرمانه|سیستم)\s*(?:را|رو)?\s*(?:بگو|نشان|فاش)/iu,
  /(?:پرامپت|دستورالعمل)\s*(?:سیستم|سیستمی)\s*(?:را|رو)?\s*(?:بگو|نشان|فاش)/u,
  /از\s*این\s*پس\s*(?:تو|شما)\s*/u,
];
/** Text that tries to instruct the assistant is quarantined (dropped from evidence), never obeyed and never summarised. */
export const looksLikeInjection = (t: string): boolean => INJECTION.some((re) => re.test(t));

export interface ItemValidation { ok: boolean; errors: string[] }

/** Pure validation of an evidence item against the dataset product it claims to describe. */
export function validateEvidenceItem(item: ExternalEvidenceItem, product: { productId: string; modelKeys: readonly string[] }, today?: string): ItemValidation {
  const errors: string[] = [];
  const v = validateEvidenceSource(item.source, today);
  if (!v.ok) errors.push(...v.errors.map((e) => `source: ${e}`));
  const wantClaim = item.kind === "SPEC_CLAIM" ? "specification" : "opinion";
  if (item.source.claimType !== wantClaim && !(item.kind === "EXPERT_REVIEW" && item.source.claimType === "specification")) errors.push(`kind ${item.kind} cannot use claimType ${item.source.claimType}`);
  if (item.kind === "USER_REVIEW_SUMMARY" && item.source.sourceType !== "customer_review") errors.push("user review summaries require a customer_review source");
  if (item.kind === "SPEC_CLAIM" && !["manufacturer", "retailer", "expert_review"].includes(item.source.sourceType)) errors.push("spec claims require manufacturer/retailer/expert source");
  if (item.productMatch.productId !== product.productId) errors.push("evidence is bound to a different product");
  const m = item.productMatch;
  if (m.method === "exact_model_key") {
    if (!m.modelKey || !product.modelKeys.includes(m.modelKey)) errors.push("exact_model_key match names a key the dataset product does not have");
    if (item.modelClaimed && m.modelKey && item.modelClaimed.toUpperCase() !== m.modelKey.toUpperCase()) errors.push("source names a different model than the matched key");
  } else if (m.confidence !== "low") errors.push("only exact model-key matches may exceed low confidence");
  if (m.confidence === "high" && m.method !== "exact_model_key") errors.push("high confidence needs an exact model-key match");
  if (!item.passages.length) errors.push("no passages");
  const ids = new Set(item.passages.map((p) => p.id));
  for (const p of item.passages) { if (p.text.length > PASSAGE_MAX) errors.push(`passage ${p.id} longer than ${PASSAGE_MAX}`); if (looksLikeInjection(p.text)) errors.push(`passage ${p.id} looks like an instruction (quarantined)`); }
  if (item.summary.length > SUMMARY_MAX || looksLikeInjection(item.summary)) errors.push("unsafe or oversized summary");
  for (const l of [...item.strengths, ...item.weaknesses]) { if (!ids.has(l.passageId)) errors.push("claim without a supporting passage"); if (looksLikeInjection(l.text)) errors.push("claim looks like an instruction"); }
  if ((item.strengths.length || item.weaknesses.length) && item.kind === "SPEC_CLAIM") errors.push("a spec claim is not a review: no strengths/weaknesses");
  if (!item.fixture && item.source.sourceUrl === undefined) errors.push("a non-fixture item needs a source URL");
  return { ok: errors.length === 0, errors };
}
