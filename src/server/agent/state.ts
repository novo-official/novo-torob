import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AGENT_STATE_VERSION, initialAgentState, type AgentControl, type AgentState } from "@/domain/agent";
import { sanitizeText } from "@/domain/inquiry-parse";
import { isInTehran, snapOrigin } from "@/lib/geo";

const ID = {
  product: /^product_[0-9a-f]{8,40}$/,
  shop: /^shop_[0-9a-f]{8,40}$/,
  offer: /^offer_[0-9a-f]{8,40}$/,
};
export const idOf = (kind: keyof typeof ID, v: unknown): v is string => typeof v === "string" && ID[kind].test(v);

const money = z.number().int().min(1).max(1e12).nullable();
const short = (n: number) => z.string().max(n);

/** Strict schema: unknown keys are rejected, so a forged client state cannot smuggle fields (GPS, phone, demo data…). */
export const AgentStateSchema = z.object({
  v: z.literal(AGENT_STATE_VERSION),
  stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  text: short(200),
  category: short(120).nullable(),
  answers: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), z.string().regex(/^[a-z0-9_]{1,30}$/)).refine((o) => Object.keys(o).length <= 12),
  skipped: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/)).max(12),
  budget: z.object({ min: money, max: money }).strict(),
  constraints: z.object({ hard: z.array(short(60)).max(6), soft: z.array(short(60)).max(6) }).strict(),
  model: short(40).nullable(),
  selection: z.object({ productId: z.string().regex(ID.product), variantGroupId: short(120).nullable() }).strict().nullable(),
  origin: z.union([
    z.object({ kind: z.literal("preset"), id: z.enum(["ferdowsi", "sheikh-hadi", "baharestan"]) }).strict(),
    z.object({ kind: z.literal("map"), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict(),
  ]).nullable(),
  radius: z.number().int().min(100).max(50_000),
  priority: z.enum(["price", "distance", "hours", "payment", "warranty"]),
  visit: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable(),
  seen: z.object({ products: z.array(z.string().regex(ID.product)).max(40), shops: z.array(z.string().regex(ID.shop)).max(60) }).strict(),
  selectedShopIds: z.array(z.string().regex(ID.shop)).max(4),
  selectedOffer: z.object({ shopId: z.string().regex(ID.shop), offerId: z.string().regex(ID.offer) }).strict().nullable(),
  externalEvidence: z.boolean(),
}).strict();

export type StateValidation = { ok: true; state: AgentState } | { ok: false; reason: string };

/** Validate + canonicalise a client-held state. Ids must exist in the DB; map points are re-snapped; text is sanitised. */
export function validateState(raw: unknown, db: DatabaseSync): StateValidation {
  const p = AgentStateSchema.safeParse(raw);
  if (!p.success) return { ok: false, reason: p.error.issues[0] ? `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` : "invalid" };
  const s = p.data as AgentState;
  const exists = (sql: string, id: string) => !!db.prepare(sql).get(id);
  if (s.selection && !exists("SELECT 1 FROM products WHERE product_id = ?", s.selection.productId)) return { ok: false, reason: "selection.productId unknown" };
  const seenProducts = s.seen.products.filter((id) => exists("SELECT 1 FROM products WHERE product_id = ?", id));
  const seenShops = s.seen.shops.filter((id) => exists("SELECT 1 FROM shops WHERE shop_id = ?", id));
  if (s.origin?.kind === "map") {
    const snapped = snapOrigin({ lat: s.origin.lat, lon: s.origin.lon });
    if (!isInTehran(snapped.lat, snapped.lon)) return { ok: false, reason: "origin outside the supported area" };
    s.origin = { kind: "map", ...snapped };
  }
  if (s.budget.min !== null && s.budget.max !== null && s.budget.min > s.budget.max) return { ok: false, reason: "budget min > max" };
  const keep = (id: string, seen: string[]) => seen.includes(id);
  const sel = s.selectedShopIds.filter((id) => keep(id, seenShops));
  const offer = s.selectedOffer && keep(s.selectedOffer.shopId, seenShops) ? s.selectedOffer : null;
  return {
    ok: true,
    state: {
      ...s, text: sanitizeText(s.text, 200), constraints: { hard: s.constraints.hard.map((c) => sanitizeText(c, 60)).filter(Boolean), soft: s.constraints.soft.map((c) => sanitizeText(c, 60)).filter(Boolean) },
      model: s.model ? sanitizeText(s.model, 40) || null : null, seen: { products: seenProducts, shops: seenShops }, selectedShopIds: sel, selectedOffer: offer,
    },
  };
}

const uniq = <T>(xs: T[], max: number): T[] => [...new Set(xs)].slice(-max);
export const remember = (s: AgentState, add: { products?: string[]; shops?: string[] }): AgentState => ({
  ...s, seen: { products: uniq([...s.seen.products, ...(add.products ?? [])], 40), shops: uniq([...s.seen.shops, ...(add.shops ?? [])], 60) },
});

/**
 * A follow-up changes ONLY the named preference. Changing the product resets seller/offer picks (they belonged to the old product),
 * changing the category resets answers and selection; nothing else is touched unless the user explicitly resets.
 */
export function applyControl(s: AgentState, c: AgentControl): AgentState {
  switch (c.type) {
    case "reset": return initialAgentState();
    case "set_budget": return { ...s, budget: { min: c.min, max: c.max } };
    case "set_radius": return { ...s, radius: Math.min(50_000, Math.max(100, Math.trunc(c.radius))) };
    case "set_origin": return { ...s, origin: { kind: "preset", id: c.id } };
    case "set_priority": return { ...s, priority: c.priority };
    case "set_visit": return { ...s, visit: c.visit };
    case "toggle_external": return { ...s, externalEvidence: c.on };
    case "answer": return c.questionId === "category" ? { ...s, category: c.optionId, answers: {}, skipped: [], selection: null, selectedShopIds: [], selectedOffer: null } : { ...s, answers: { ...s.answers, [c.questionId]: c.optionId }, skipped: s.skipped.filter((q) => q !== c.questionId) };
    case "skip_question": return { ...s, skipped: uniq([...s.skipped, c.questionId], 12), answers: Object.fromEntries(Object.entries(s.answers).filter(([k]) => k !== c.questionId)) };
    case "select_product": return { ...s, selection: { productId: c.productId, variantGroupId: c.variantGroupId }, stage: 2, selectedShopIds: [], selectedOffer: null };
    case "select_shops": return { ...s, selectedShopIds: c.shopIds.slice(0, 4), selectedOffer: null };
    case "select_offer": return { ...s, selectedOffer: { shopId: c.shopId, offerId: c.offerId }, selectedShopIds: s.selectedShopIds.includes(c.shopId) ? s.selectedShopIds : [c.shopId, ...s.selectedShopIds].slice(0, 4) };
  }
}

export const AgentControlSchema: z.ZodType<AgentControl> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_budget"), min: money, max: money }).strict(),
  z.object({ type: z.literal("set_radius"), radius: z.number().int().min(100).max(50_000) }).strict(),
  z.object({ type: z.literal("set_origin"), id: z.enum(["ferdowsi", "sheikh-hadi", "baharestan"]) }).strict(),
  z.object({ type: z.literal("set_priority"), priority: z.enum(["price", "distance", "hours", "payment", "warranty"]) }).strict(),
  z.object({ type: z.literal("set_visit"), visit: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable() }).strict(),
  z.object({ type: z.literal("answer"), questionId: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), optionId: z.string().min(1).max(120) }).strict(),
  z.object({ type: z.literal("skip_question"), questionId: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/) }).strict(),
  z.object({ type: z.literal("select_product"), productId: z.string().regex(ID.product), variantGroupId: short(120).nullable() }).strict(),
  z.object({ type: z.literal("select_shops"), shopIds: z.array(z.string().regex(ID.shop)).min(1).max(4) }).strict(),
  z.object({ type: z.literal("select_offer"), shopId: z.string().regex(ID.shop), offerId: z.string().regex(ID.offer) }).strict(),
  z.object({ type: z.literal("toggle_external"), on: z.boolean() }).strict(),
  z.object({ type: z.literal("reset") }).strict(),
]) as unknown as z.ZodType<AgentControl>;
