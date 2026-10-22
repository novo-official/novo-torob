import type { EnrichmentResult } from "@/domain/evidence";
import type { EvidenceCardView } from "@/domain/agent";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Shared by the agent tool and the product-page panel: the ONLY shape external evidence reaches the UI in. */
export function buildEvidenceCard(productId: string, r: EnrichmentResult, mode: "off" | "fixture" | "live"): EvidenceCardView {
  const items = r.items.map((it) => ({
    id: it.id, kind: it.kind, badge: (it.kind === "SPEC_CLAIM" ? "EXTERNAL_FACT" : "EXTERNAL_OPINION") as "EXTERNAL_FACT" | "EXTERNAL_OPINION", sourceName: clip(it.source.sourceName, 100),
    sourceHost: it.source.sourceUrl ? new URL(it.source.sourceUrl).hostname : "—", url: it.fixture ? null : it.source.sourceUrl ?? null, retrievedAt: it.source.retrievedAt, publishedAt: it.source.publishedAt ?? null,
    matchText: `تطبیق ${it.productMatch.method === "exact_model_key" ? "دقیق کد مدل" : it.productMatch.method === "manual" ? "نام تجاری بازبینی‌شده" : "تقریبی"} (${it.productMatch.confidence === "high" ? "اطمینان بالا" : it.productMatch.confidence === "medium" ? "اطمینان متوسط" : "اطمینان کم"})`,
    summary: clip(it.summary, 320), strengths: it.strengths.map((x) => clip(x.text, 120)), weaknesses: it.weaknesses.map((x) => clip(x.text, 120)), limitations: it.limitations.slice(0, 4).map((x) => clip(x, 200)), fixture: it.fixture,
    quotes: it.linkOnly ? [] : it.passages.slice(0, 6).map((p) => ({ text: clip(p.text, 280), field: p.field ?? null })), attribution: it.source.attribution ? clip(it.source.attribution, 260) : null, linkOnly: it.linkOnly === true,
  }));
  return { type: "evidence", id: `ev:${productId}`, badges: items.length ? [...new Set(items.map((i) => i.badge))] : ["UNKNOWN"], productId, status: r.status, mode, items, conflicts: r.conflicts, notes: r.notes };
}
