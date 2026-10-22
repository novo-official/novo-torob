import { z } from "zod";
import { sanitizeText } from "@/domain/inquiry-parse";
import {
  CHECKLIST_IDS, DISTRICTS, MISSION_ID_RE, MISSION_LIMITS, MISSION_VERSION, OFFER_ID_RE, PRODUCT_ID_RE, SHOP_ID_RE, VISIT_RE,
  type ShoppingMissionV1,
} from "@/domain/mission";
import { sanitizeStoredInquiry } from "@/lib/inquiry-storage";

// zod 4 compiles object schemas with `new Function` unless told not to; the app's CSP forbids eval, so use the interpreter path (also avoids a console violation).
z.config({ jitless: true });

/**
 * Strict validation of anything read back from storage (or from a URL/clipboard). A tampered / corrupt / future-version record is
 * REJECTED, never "repaired into trust": the caller shows it as unreadable and offers to delete it.
 * There is deliberately no field that could hold a phone number, coordinates, a token or a simulated reply — `.strict()` refuses extras.
 */
const iso = z.string().max(40).refine((s) => Number.isFinite(Date.parse(s)), "bad date");
const money = z.number().int().min(1).max(1e12).nullable();
const key = z.string().max(300);
const TRIGGERS = ["UNAVAILABLE", "PRICE_CHANGED", "WRONG_MODEL", "NO_REPLY", "OUTSIDE_HOURS", "PAYMENT_WARRANTY"] as const;

const Schema = z.object({
  v: z.literal(MISSION_VERSION),
  id: z.string().regex(MISSION_ID_RE),
  rev: z.number().int().min(0).max(1e9),
  createdAt: iso, updatedAt: iso,
  status: z.enum(["ACTIVE", "VISITED", "ABANDONED"]),
  need: z.object({ text: z.string().max(MISSION_LIMITS.need).nullable(), category: z.string().max(120).nullable() }).strict(),
  candidates: z.array(z.string().regex(PRODUCT_ID_RE)).max(MISSION_LIMITS.candidates),
  budget: z.object({ min: money, max: money }).strict().refine((b) => b.min === null || b.max === null || b.min <= b.max),
  priority: z.enum(["price", "distance", "hours", "payment", "warranty"]),
  area: z.object({ district: z.enum(DISTRICTS).nullable(), radius: z.number().int().min(100).max(50_000) }).strict(),
  product: z.object({ productId: z.string().regex(PRODUCT_ID_RE), variantGroupId: z.string().max(120).nullable() }).strict().nullable(),
  shop: z.object({ shopId: z.string().regex(SHOP_ID_RE), offerId: z.string().regex(OFFER_ID_RE) }).strict().nullable(),
  shortlist: z.array(z.string().regex(SHOP_ID_RE)).max(MISSION_LIMITS.shortlist),
  visit: z.string().regex(VISIT_RE).nullable(),
  inquiries: z.array(z.object({ shopId: z.string().regex(SHOP_ID_RE), offerId: z.string().regex(OFFER_ID_RE), state: z.unknown() }).strict()).max(MISSION_LIMITS.inquiries),
  checklist: z.partialRecord(z.enum(CHECKLIST_IDS as unknown as [string, ...string[]]), z.object({ kind: z.enum(["done", "skipped"]), at: iso, key }).strict()),
  recovery: z.object({
    history: z.array(z.object({ trigger: z.enum(TRIGGERS), resolution: z.enum(["SWITCHED_SHOP", "SWITCHED_PRODUCT", "TIME_CHANGED", "DISMISSED"]), at: iso, shopId: z.string().regex(SHOP_ID_RE).nullable(), offerId: z.string().regex(OFFER_ID_RE).nullable() }).strict()).max(MISSION_LIMITS.history),
    dismissed: z.array(z.object({ trigger: z.enum(TRIGGERS), key }).strict()).max(40),
  }).strict(),
  notes: z.string().max(MISSION_LIMITS.note).nullable(),
  // DEMO_SIMULATED is not an allowed provenance: a record claiming it is invalid
  timeline: z.array(z.object({ rev: z.number().int().min(0), at: iso, kind: z.string().max(40), provenance: z.enum(["DATASET_RECORDED", "USER_REPORTED", "USER_ACTION", "SYSTEM"]), textFa: z.string().max(300), nextFa: z.string().max(200).optional() }).strict()).max(MISSION_LIMITS.timeline),
}).strict();

export type ParseResult = { ok: true; mission: ShoppingMissionV1 } | { ok: false; reason: "NOT_OBJECT" | "UNSUPPORTED_VERSION" | "INVALID" | "BAD_INQUIRY"; detail?: string };

export function parseMission(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "NOT_OBJECT" };
  const v = (raw as { v?: unknown }).v;
  if (v !== MISSION_VERSION) return { ok: false, reason: "UNSUPPORTED_VERSION", detail: String(typeof v === "number" ? v : "none") };
  const p = Schema.safeParse(raw);
  if (!p.success) return { ok: false, reason: "INVALID", detail: `${p.error.issues[0]?.path.join(".") ?? ""}: ${p.error.issues[0]?.message ?? ""}`.slice(0, 120) };
  const d = p.data;
  const inquiries: ShoppingMissionV1["inquiries"] = [];
  for (const i of d.inquiries) {
    const probe = i.state as { questionIds?: unknown; customQuestions?: unknown } | null;
    const qids = Array.isArray(probe?.questionIds) ? (probe!.questionIds as unknown[]).filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(x)) : [];
    // sanitizeStoredInquiry re-validates every reply: only USER_REPORTED survives, text is re-sanitised
    const st = sanitizeStoredInquiry(i.state, qids);
    if (!st) return { ok: false, reason: "BAD_INQUIRY" };
    inquiries.push({ shopId: i.shopId, offerId: i.offerId, state: st });
  }
  // the active shop's offer must belong to the active product only by id format here; the dataset join is re-verified on load by the server
  return {
    ok: true,
    mission: {
      ...d, need: { text: d.need.text === null ? null : sanitizeText(d.need.text, MISSION_LIMITS.need) || null, category: d.need.category },
      inquiries, checklist: d.checklist as ShoppingMissionV1["checklist"], notes: d.notes === null ? null : sanitizeText(d.notes, MISSION_LIMITS.note) || null,
    },
  };
}
