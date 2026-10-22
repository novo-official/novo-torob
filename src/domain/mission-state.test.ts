import { describe, expect, it } from "vitest";
import { createMission, missingRequirements, MISSION_STATES, reachableStates, transition } from "./mission-state";
import type { ShoppingMission, VariantIdentity } from "./types";

const variant: VariantIdentity = { productId: "product_x", modelKey: "ABC-1", unit: "piece", matchConfidence: "exact" };

const full = (): ShoppingMission => ({
  ...createMission("m1"),
  intent: "دوربین",
  candidates: ["product_x"],
  chosenVariant: variant,
  selectedSellers: ["shop_a"],
});

describe("mission state machine", () => {
  it("starts at UNDERSTAND_NEED with empty context", () => {
    const m = createMission("m1");
    expect(m.state).toBe("UNDERSTAND_NEED");
    expect(m.responses).toEqual([]);
  });

  it("lists the eight states in the documented order", () => {
    expect(MISSION_STATES).toEqual([
      "UNDERSTAND_NEED", "EXPLORE_PRODUCTS", "SELECT_PRODUCT", "DISCOVER_SELLERS",
      "COMPARE_SELLERS", "CONTACT_PREPARATION", "CONTACT_RESULT", "VISIT_PLAN",
    ]);
  });

  it("blocks forward moves when required context is missing, and says what is missing", () => {
    const r = transition(createMission("m1"), "EXPLORE_PRODUCTS");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("INVALID_INPUT");
      expect(r.error.detail?.missing).toBe("intent");
    }
  });

  it("allows the known-product fast path (skip ahead) when context supports it", () => {
    const m = { ...createMission("m1"), intent: "x", candidates: ["product_x"], chosenVariant: variant };
    const r = transition(m, "DISCOVER_SELLERS");
    expect(r.ok && r.value.state).toBe("DISCOVER_SELLERS");
  });

  it("cannot reach DISCOVER_SELLERS without a chosen variant", () => {
    const m = { ...createMission("m1"), intent: "x", candidates: ["product_x"] };
    expect(missingRequirements(m, "DISCOVER_SELLERS")).toEqual(["chosenVariant"]);
  });

  it("allows backward moves and preserves every user constraint", () => {
    const m: ShoppingMission = { ...full(), state: "COMPARE_SELLERS", budget: { min: 1, max: 9 }, priorities: ["price"], region: "فردوسی" };
    const r = transition(m, "SELECT_PRODUCT");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.state).toBe("SELECT_PRODUCT");
      expect(r.value.budget).toEqual({ min: 1, max: 9 });
      expect(r.value.priorities).toEqual(["price"]);
      expect(r.value.region).toBe("فردوسی");
      expect(r.value.chosenVariant).toEqual(variant);
      expect(r.value.selectedSellers).toEqual(["shop_a"]);
    }
  });

  it("allows VISIT_PLAN → COMPARE_SELLERS / CONTACT_PREPARATION", () => {
    const m = { ...full(), state: "VISIT_PLAN" as const };
    expect(transition(m, "COMPARE_SELLERS").ok).toBe(true);
    expect(transition(m, "CONTACT_PREPARATION").ok).toBe(true);
  });

  it("is a no-op for the same state", () => {
    const m = full();
    const r = transition(m, m.state);
    expect(r.ok && r.value).toBe(m);
  });

  it("reachableStates only offers earlier states from a fresh mission", () => {
    expect(reachableStates(createMission("m"))).toEqual(["UNDERSTAND_NEED"]);
  });

  it("reaches every state when all context exists", () => {
    expect(reachableStates(full())).toHaveLength(MISSION_STATES.length);
  });
});
