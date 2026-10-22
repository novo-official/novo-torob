import type { DatabaseSync } from "node:sqlite";
import { looksLikeInjection, validateEvidenceItem, type EnrichmentResult, type ExternalEvidenceItem } from "@/domain/evidence";
import { REQUIRED_SCOPE_NOTES, type EvidenceSource } from "@/domain/provenance";
import { areSiblingKeys, extractModelKeys } from "@/server/domain/text";
import { FIXTURES, FIXTURE_VERSION } from "./fixtures";
import { createReviewedSourcesAdapter } from "./reviewed-sources";
import { htmlToText, safeFetchText, SafeFetchError, type SafeFetchOptions } from "./safe-fetch";

export interface ProductRef { productId: string; title: string; categoryName: string; modelKeys: string[] }
export interface AdapterOutput { items: ExternalEvidenceItem[]; outcome: "ok" | "no_match" | "error" | "skipped"; detail?: string }
export interface AdapterCtx { now: Date; fetchOpts?: Partial<SafeFetchOptions> }
export interface ExternalSourceAdapter {
  id: string;
  version: string;
  mode: "fixture" | "live";
  /** hosts this adapter may ever contact — fixed in code; never derived from model output or page content */
  allowedHosts: readonly string[];
  collect(ref: ProductRef, ctx: AdapterCtx): Promise<AdapterOutput>;
}

export function productRefOf(db: DatabaseSync, productId: string): ProductRef | null {
  const r = db.prepare("SELECT product_id, persian_title, category_name, model_keys FROM products WHERE product_id = ?").get(productId) as { product_id: string; persian_title: string; category_name: string; model_keys: string | null } | undefined;
  if (!r) return null;
  const keys = new Set<string>([...(r.model_keys ? r.model_keys.split(/\s+/) : []), ...extractModelKeys(r.persian_title)].map((k) => k.toUpperCase()).filter(Boolean));
  return { productId: r.product_id, title: r.persian_title, categoryName: r.category_name, modelKeys: [...keys] };
}

// ---------- adapters ----------
export const fixtureAdapter: ExternalSourceAdapter = {
  id: "fixture", version: FIXTURE_VERSION, mode: "fixture", allowedHosts: [],
  async collect(ref) {
    const e = FIXTURES.find((f) => f.productId === ref.productId && ref.modelKeys.includes(f.modelKey));
    return e ? { items: e.items, outcome: "ok" } : { items: [], outcome: "no_match" };
  },
};

/** Reviewed registry: exact model key → the manufacturer product page URL a human verified. The model can never add to it. */
export interface ManufacturerPage { modelKey: string; url: string; publisher: string }
export const MANUFACTURER_PAGES: readonly ManufacturerPage[] = [];

const SPEC_WORDS = /\b(?:resolution|megapixel|MP|lens|IR|infrared|waterproof|IP\d{2}|battery|mAh|bluetooth|Bluetooth|codec|latency|impedance|frequency|power|voltage|kW|kVA|capacity|warranty)\b/;

export function createManufacturerAdapter(pages: readonly ManufacturerPage[] = MANUFACTURER_PAGES, fetchOpts: Partial<SafeFetchOptions> = {}): ExternalSourceAdapter {
  const hosts = [...new Set(pages.map((p) => new URL(p.url).hostname.toLowerCase()))];
  return {
    id: "manufacturer-pages", version: "mp-1", mode: "live", allowedHosts: hosts,
    async collect(ref, ctx) {
      const page = pages.find((p) => ref.modelKeys.includes(p.modelKey.toUpperCase()));
      if (!page) return { items: [], outcome: "no_match" };
      try {
        const r = await safeFetchText(page.url, { allowedHosts: hosts, ...fetchOpts, ...ctx.fetchOpts });
        const text = r.contentType.includes("html") ? htmlToText(r.text) : r.text.slice(0, 100_000);
        const upper = text.toUpperCase();
        if (!upper.includes(page.modelKey.toUpperCase())) return { items: [], outcome: "no_match", detail: "page does not name the exact model" };
        const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 20 && s.length <= 220 && SPEC_WORDS.test(s) && !looksLikeInjection(s)).slice(0, 3);
        if (!sentences.length) return { items: [], outcome: "no_match", detail: "no spec sentences found" };
        const source: EvidenceSource = {
          sourceType: "manufacturer", sourceName: page.publisher, sourceUrl: r.url, retrievedAt: ctx.now.toISOString().slice(0, 10), evidenceConfidence: "medium", claimType: "specification",
          match: { productId: ref.productId, modelKey: page.modelKey.toUpperCase(), method: "exact_model_key" }, scopeLimits: [REQUIRED_SCOPE_NOTES.manufacturer],
        };
        const item: ExternalEvidenceItem = {
          id: `mp-${ref.productId.slice(8, 16)}`, kind: "SPEC_CLAIM", source, productMatch: { productId: ref.productId, modelKey: page.modelKey.toUpperCase(), method: "exact_model_key", confidence: "medium" }, modelClaimed: page.modelKey.toUpperCase(),
          passages: sentences.map((s, i) => ({ id: `p${i + 1}`, text: s })), summary: "گزیده‌ی مشخصات از صفحه‌ی سازنده (ادعای سازنده، نه آزمون مستقل).", strengths: [], weaknesses: [], limitations: ["ادعای سازنده است.", "ممکن است با نسخه‌ی فروخته‌شده در بازار ایران فرق کند."], fixture: false,
        };
        return { items: [item], outcome: "ok" };
      } catch (e) {
        return { items: [], outcome: "error", detail: e instanceof SafeFetchError ? e.code : "unexpected" };
      }
    },
  };
}

// ---------- service ----------
const CACHE = new Map<string, { at: number; result: EnrichmentResult }>();
export const CACHE_TTL_MS = 6 * 3600_000;
/** live pages are read at most once per day per product (politeness); a failure is cached for the same time so a broken source is not hammered */
export const LIVE_TTL_MS = 24 * 3600_000;
const CACHE_MAX = 200;
export const clearEvidenceCache = () => CACHE.clear();

export interface EnrichOptions { mode: "off" | "fixture" | "live"; /** owner-enabled reproduction of short third-party spans (default false = link-only) */ reproduce?: boolean; now?: Date; adapters?: ExternalSourceAdapter[]; fetchOpts?: Partial<SafeFetchOptions> }

/**
 * Bounded evidence retrieval for ONE dataset product. It only ENRICHES that product; it never searches the web for other products,
 * never edits the dataset, and every item must pass `validateEvidenceItem` (provenance, exact-model match, no injection).
 */
export async function getExternalEvidence(db: DatabaseSync, productId: string, opt: EnrichOptions): Promise<EnrichmentResult> {
  const now = opt.now ?? new Date();
  const base: EnrichmentResult = { productId, status: "DISABLED", mode: opt.mode, items: [], conflicts: [], notes: [], retrievedAt: now.toISOString(), adapters: [], cached: false, rejected: 0 };
  if (opt.mode === "off") return { ...base, notes: ["بازیابی شواهد بیرونی در این محیط غیرفعال است؛ فقط داده‌ی رسمی ترب نمایش داده می‌شود."] };
  const ref = productRefOf(db, productId);
  if (!ref) return { ...base, status: "NO_EVIDENCE", notes: ["محصول پیدا نشد."] };
  const adapters = (opt.adapters ?? (opt.mode === "fixture" ? [fixtureAdapter] : [createReviewedSourcesAdapter(undefined, {}, { reproduce: opt.reproduce === true }), createManufacturerAdapter()])).filter((a) => a.mode === opt.mode || opt.adapters);
  const ck = `${opt.mode}|${opt.reproduce ? "rep" : "link"}|${productId}|${adapters.map((a) => `${a.id}@${a.version}`).join(",")}`;
  const hit = CACHE.get(ck);
  if (hit && now.getTime() - hit.at < (opt.mode === "live" ? LIVE_TTL_MS : CACHE_TTL_MS) && !opt.adapters) return { ...hit.result, cached: true };

  const items: ExternalEvidenceItem[] = [];
  const log: EnrichmentResult["adapters"] = [];
  let rejected = 0;
  // disagreement with the dataset is REPORTED, never resolved in the source's favour and never merged into the product
  const conflicts: string[] = [];
  for (const a of adapters) {
    let out: AdapterOutput;
    try { out = await a.collect(ref, { now, fetchOpts: opt.fetchOpts }); } catch { out = { items: [], outcome: "error", detail: "adapter threw" }; }
    let ok = 0;
    for (const it of out.items.slice(0, 6)) {
      const v = validateEvidenceItem(it, { productId, modelKeys: ref.modelKeys }, now.toISOString().slice(0, 10));
      if (v.ok) { items.push(it); ok++; continue; }
      rejected++;
      const claimed = it.modelClaimed?.toUpperCase();
      if (claimed && v.errors.some((e) => /different model/.test(e)) && !ref.modelKeys.includes(claimed)) {
        const sibling = ref.modelKeys.some((k) => areSiblingKeys(k, claimed) || claimed.startsWith(k) || k.startsWith(claimed));
        conflicts.push(`منبع «${it.source.sourceName}» نام مدل را «${claimed}» می‌آورد ولی محصول داده‌ی رسمی «${[...ref.modelKeys].sort((a, b) => a.length - b.length)[0] ?? "—"}» است${sibling ? " (نسخه‌ی همخانواده)" : ""}؛ شاهد این منبع به این محصول وصل نشد، پیشنهادهای رسمی دیتاست تغییر نکرد و باید نسخه‌ی دقیق تأیید شود.`);
      }
    }
    log.push({ id: a.id, version: a.version, outcome: out.items.length && !ok ? "rejected" : out.outcome, detail: out.detail });
  }
  const kinds = new Set(items.map((i) => i.kind));
  const status: EnrichmentResult["status"] = !items.length ? "NO_EVIDENCE" : kinds.has("SPEC_CLAIM") && (kinds.has("EXPERT_REVIEW") || kinds.has("USER_REVIEW_SUMMARY")) ? "OK" : "PARTIAL";
  const notes = !items.length
    ? ["هیچ شاهد بیرونیِ قابل‌راستی‌آزمایی بازیابی نشد؛ داده‌ی رسمی ترب همچنان در دسترس است."]
    : opt.mode === "fixture" ? ["این شواهد نمونه‌ی آزمایشی (fixture) هستند، نه منبع واقعی."] : [];
  const result: EnrichmentResult = { ...base, status, items, conflicts, notes, adapters: log, rejected };
  if (!opt.adapters) { if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string); CACHE.set(ck, { at: now.getTime(), result }); }
  return result;
}
