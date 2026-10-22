import type { ExternalEvidenceItem } from "@/domain/evidence";
import { REQUIRED_SCOPE_NOTES } from "@/domain/provenance";

/**
 * QA / DEMO FIXTURES. These are SYNTHETIC test records bound to REAL dataset product ids so the full pipeline (matching, conflict
 * detection, balanced strengths/weaknesses, provenance, badges) can be exercised offline. They are NOT real reviews or real specs:
 * every text says so, every source is a `fixture.example` URL, and the UI marks them «نمونه‌ی آزمایشی — منبع واقعی نیست».
 * They are enabled only with AGENT_EVIDENCE_MODE=fixture.
 */
export const FIXTURE_VERSION = "fixture-2026.1";
const NOTE = "نمونه‌ی آزمایشی — منبع واقعی نیست";
const AT = "2026-10-20";

export interface FixtureEntry { productId: string; modelKey: string; items: ExternalEvidenceItem[] }

const base = (productId: string, modelKey: string) => ({ productMatch: { productId, modelKey, method: "exact_model_key" as const, confidence: "medium" as const }, fixture: true });

export const FIXTURES: FixtureEntry[] = [
  {
    productId: "product_7308febc43c2f793fd0e1cf9", modelKey: "HDW1200CLQP",
    items: [
      {
        id: "fx-dahua-spec", kind: "SPEC_CLAIM", ...base("product_7308febc43c2f793fd0e1cf9", "HDW1200CLQP"), modelClaimed: "HDW1200CLQP",
        source: { sourceType: "manufacturer", sourceName: `سازنده (${NOTE})`, sourceUrl: "https://fixture.example/dahua/hdw1200clqp", retrievedAt: AT, evidenceConfidence: "medium", claimType: "specification", match: { productId: "product_7308febc43c2f793fd0e1cf9", modelKey: "HDW1200CLQP", method: "exact_model_key" }, scopeLimits: [REQUIRED_SCOPE_NOTES.manufacturer, NOTE] },
        passages: [{ id: "p1", text: `[${NOTE}] ادعای نمونه: این مدل برای نصب ثابت در فضای بسته معرفی شده است (متن ساختگی برای آزمون).` }],
        summary: `[${NOTE}] ادعای سازنده‌ی نمونه درباره‌ی کاربرد؛ تأیید مستقل نیست.`, strengths: [], weaknesses: [], limitations: [NOTE, "این متن ساختگی است و مشخصات واقعی دوربین نیست."],
      },
      {
        id: "fx-dahua-review", kind: "EXPERT_REVIEW", ...base("product_7308febc43c2f793fd0e1cf9", "HDW1200CLQP"), modelClaimed: "HDW1200CLQP-IL-B",
        source: { sourceType: "expert_review", sourceName: `بررسی کارشناسی (${NOTE})`, sourceUrl: "https://fixture.example/review/dahua-hdw1200clqp", retrievedAt: AT, publishedAt: "2026-09-01", evidenceConfidence: "low", claimType: "opinion", match: { productId: "product_7308febc43c2f793fd0e1cf9", modelKey: "HDW1200CLQP", method: "exact_model_key" }, scopeLimits: [REQUIRED_SCOPE_NOTES.expert_review, NOTE] },
        passages: [
          { id: "p1", text: `[${NOTE}] نقطه‌ی قوت نمونه: نصب ساده را آسان توصیف می‌کند (ساختگی).` },
          { id: "p2", text: `[${NOTE}] نقطه‌ی ضعف نمونه: در نور کم جزئیات را کم می‌داند (ساختگی).` },
        ],
        summary: `[${NOTE}] ارزیابی نمونه با یک نقطه‌ی قوت و یک نقطه‌ی ضعف؛ نام مدل در این منبع «…-IL-B» است.`,
        strengths: [{ text: "نصب ساده (طبق نمونه‌ی آزمایشی)", passageId: "p1" }], weaknesses: [{ text: "جزئیات در نور کم (طبق نمونه‌ی آزمایشی)", passageId: "p2" }],
        limitations: [NOTE, "نسخه‌ی نامبرده‌شده با پیشنهادهای دیتاست یکی نیست؛ پیش از اتکا بررسی شود."],
      },
    ],
  },
];
