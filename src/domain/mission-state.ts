import { err, ok, type Result } from "./errors";
import type { MissionState, ShoppingMission } from "./types";

/** Ordered journey states. Order defines "earlier" / "later". */
export const MISSION_STATES: readonly MissionState[] = [
  "UNDERSTAND_NEED",
  "EXPLORE_PRODUCTS",
  "SELECT_PRODUCT",
  "DISCOVER_SELLERS",
  "COMPARE_SELLERS",
  "CONTACT_PREPARATION",
  "CONTACT_RESULT",
  "VISIT_PLAN",
] as const;

export const MISSION_STATE_LABELS_FA: Record<MissionState, string> = {
  UNDERSTAND_NEED: "فهم نیاز",
  EXPLORE_PRODUCTS: "بررسی محصولات",
  SELECT_PRODUCT: "انتخاب محصول",
  DISCOVER_SELLERS: "یافتن فروشنده",
  COMPARE_SELLERS: "مقایسه‌ی فروشنده‌ها",
  CONTACT_PREPARATION: "آماده‌سازی پرسش",
  CONTACT_RESULT: "ثبت پاسخ فروشنده",
  VISIT_PLAN: "برنامه‌ی مراجعه",
};

const indexOf = (s: MissionState) => MISSION_STATES.indexOf(s);

/** Context that must exist before a state can be ENTERED going forward. */
const ENTRY_REQUIREMENTS: Record<MissionState, { ok: (m: ShoppingMission) => boolean; missing: string }> = {
  UNDERSTAND_NEED: { ok: () => true, missing: "" },
  EXPLORE_PRODUCTS: { ok: (m) => !!m.intent?.trim(), missing: "intent" },
  SELECT_PRODUCT: { ok: (m) => m.candidates.length > 0, missing: "candidates" },
  DISCOVER_SELLERS: { ok: (m) => m.chosenVariant !== null, missing: "chosenVariant" },
  COMPARE_SELLERS: { ok: (m) => m.selectedSellers.length > 0, missing: "selectedSellers" },
  CONTACT_PREPARATION: { ok: (m) => m.selectedSellers.length > 0, missing: "selectedSellers" },
  CONTACT_RESULT: { ok: (m) => m.selectedSellers.length > 0, missing: "selectedSellers" },
  VISIT_PLAN: { ok: (m) => m.selectedSellers.length > 0, missing: "selectedSellers" },
};

export function createMission(id: string): ShoppingMission {
  return {
    id,
    state: "UNDERSTAND_NEED",
    intent: null,
    useCase: null,
    budget: { min: null, max: null },
    priorities: [],
    candidates: [],
    chosenVariant: null,
    region: null,
    radiusMeters: null,
    visitTime: null,
    selectedSellers: [],
    responses: [],
    unresolved: [],
  };
}

/** Requirements missing to move forward to `to` (every state passed through must be satisfiable). */
export function missingRequirements(m: ShoppingMission, to: MissionState): string[] {
  const missing: string[] = [];
  for (let i = indexOf(m.state) + 1; i <= indexOf(to); i++) {
    const state = MISSION_STATES[i]!;
    const req = ENTRY_REQUIREMENTS[state];
    if (!req.ok(m) && !missing.includes(req.missing)) missing.push(req.missing);
  }
  return missing;
}

/**
 * Backward moves are always allowed and NEVER discard user constraints.
 * Forward moves are allowed (including the known-product fast path that skips ahead)
 * only when the required context exists.
 */
export function transition(m: ShoppingMission, to: MissionState): Result<ShoppingMission> {
  if (to === m.state) return ok(m);
  if (indexOf(to) < indexOf(m.state)) return ok({ ...m, state: to });
  const missing = missingRequirements(m, to);
  if (missing.length > 0) {
    return err("INVALID_INPUT", "برای ادامه، اطلاعات لازم هنوز کامل نیست.", { missing: missing.join(",") });
  }
  return ok({ ...m, state: to });
}

export function reachableStates(m: ShoppingMission): MissionState[] {
  return MISSION_STATES.filter((s) => s === m.state || indexOf(s) < indexOf(m.state) || missingRequirements(m, s).length === 0);
}
