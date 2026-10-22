// @vitest-environment node
import { describe, expect, it } from "vitest";
import { openRealDb } from "../../../../tests/helpers/real-db";
import { SCENARIOS as BASE } from "./corpus";
import { SCENARIOS_2 } from "./corpus2";
const SCENARIOS = [...BASE, ...SCENARIOS_2];
import { runEval } from "./run";

const db = openRealDb();

describe("evaluation corpus shape (always runs)", () => {
  it("has ≥40 uniquely-id'd scenarios covering all 14 required categories and all four stages + failures", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (let c = 1; c <= 14; c++) expect(SCENARIOS.some((s) => s.cat === c), `category ${c}`).toBe(true);
    for (const st of ["choose", "find", "compare", "communicate", "failure"]) expect(SCENARIOS.some((s) => s.stage === st), st).toBe(true);
    for (const s of SCENARIOS) { expect(s.basis.length, s.id).toBeGreaterThan(10); expect(["hand-labelled-from-dataset", "spec-derived", "adversarial-design", "team-judgment-user-like"]).toContain(s.label); }
    // not only self-generated expectations: a real share is labelled from the dataset or from adversarial design
    expect(SCENARIOS.filter((s) => s.label !== "spec-derived").length).toBeGreaterThanOrEqual(12);
    expect(SCENARIOS.filter((s) => s.label === "team-judgment-user-like").length).toBeGreaterThanOrEqual(30);
  });
});

describe.skipIf(!db)("evaluation corpus on the mock planner over the real catalog", () => {
  it("every scenario passes; safety counters are zero; fallbacks bounded", async () => {
    const r = await runEval(db!);
    const failed = r.results.filter((x) => !x.passed).map((x) => `${x.id} ${x.titleFa}: ${x.error ?? x.checks.filter((c) => !c.ok).map((c) => `${c.metric}/${c.note}`).join("; ")}`);
    expect(failed).toEqual([]);
    expect(r.safetyScan).toMatchObject({ falseAvailabilityClaims: 0, falseContactClaims: 0, unsupportedHighImpactClaims: 0, externalLinksOutsideRoutes: 0, phoneOrCoordinateLeaks: 0 });
    expect(r.schemaValidCallRate.mockPlanner.valid).toBe(r.schemaValidCallRate.mockPlanner.total);
    expect(r.externalCalls).toBe(0);
    expect(r.liveStatus).toContain("NOT LIVE VERIFIED");
  }, 120_000);
});
