// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyOffer } from "./find";

const g = (unitHint: "per_metre" | "roll_or_pack" | "unknown", modelKey: string | null) => ({ id: `${unitHint}|${modelKey ?? "any"}`, unitHint, modelKey });

describe("offer ↔ selected variant classification (never 'same exact item')", () => {
  it("same group → PLAUSIBLE (heuristic), with evidence about HOW it matched", () => {
    expect(classifyOffer({ offerGroup: g("unknown", "HDW1200"), selected: g("unknown", "HDW1200"), needsConfirmation: true })).toEqual({ status: "PLAUSIBLE", evidence: "model_key_match" });
    expect(classifyOffer({ offerGroup: g("unknown", null), selected: g("unknown", null), needsConfirmation: true })).toEqual({ status: "PLAUSIBLE", evidence: "product_id_only" });
  });
  it("a different unit is CONFLICTING (metre vs roll is a different price basis)", () => {
    expect(classifyOffer({ offerGroup: g("per_metre", null), selected: g("roll_or_pack", null), needsConfirmation: true }).status).toBe("CONFLICTING");
  });
  it("sibling model codes are CONFLICTING, not silently swapped in", () => {
    expect(classifyOffer({ offerGroup: g("unknown", "GV3P65"), selected: g("unknown", "GV3P60"), needsConfirmation: true })).toEqual({ status: "CONFLICTING", evidence: "sibling_model" });
    expect(classifyOffer({ offerGroup: g("unknown", "LC1D50AM7"), selected: g("unknown", "LC1D95AM7"), needsConfirmation: true }).status).toBe("CONFLICTING");
  });
  it("a compatible model key family is PLAUSIBLE", () => {
    expect(classifyOffer({ offerGroup: g("unknown", "HDW1200CLQP-IL-A"), selected: g("unknown", "HDW1200CLQP"), needsConfirmation: true })).toEqual({ status: "PLAUSIBLE", evidence: "model_key_match" });
  });
  it("keyless offer vs keyed selection → UNCERTAIN", () => {
    expect(classifyOffer({ offerGroup: g("unknown", null), selected: g("unknown", "A2344"), needsConfirmation: true })).toEqual({ status: "UNCERTAIN", evidence: "no_model_key" });
  });
  it("unrelated model keys → UNCERTAIN", () => {
    expect(classifyOffer({ offerGroup: g("unknown", "MU7W2ZP"), selected: g("unknown", "A2344"), needsConfirmation: true })).toEqual({ status: "UNCERTAIN", evidence: "unrelated_model" });
  });
  it("no selection while confirmation is needed → UNSELECTED; single-group products are plausible by product id", () => {
    expect(classifyOffer({ offerGroup: g("unknown", "X1"), selected: null, needsConfirmation: true }).status).toBe("UNSELECTED");
    expect(classifyOffer({ offerGroup: g("unknown", null), selected: null, needsConfirmation: false })).toEqual({ status: "PLAUSIBLE", evidence: "product_id_only" });
  });
});
