// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ALLOWED_CLAIMS, canClaimStock, REQUIRED_SCOPE_NOTES, validateEvidenceSource, type EvidenceSource } from "./provenance";

const TODAY = "2026-10-22";
const base = (over: Partial<EvidenceSource> = {}): EvidenceSource => ({
  sourceType: "manufacturer", sourceName: "Dahua", sourceUrl: "https://www.dahuasecurity.com/products/x", retrievedAt: "2026-10-20", publishedAt: "2026-01-01",
  match: { productId: "product_abc12345", modelKey: "HDW1200", method: "exact_model_key" }, evidenceConfidence: "medium", claimType: "specification", scopeLimits: [REQUIRED_SCOPE_NOTES.manufacturer], ...over,
});

describe("external-evidence provenance contract (definition only — no retrieval exists)", () => {
  it("accepts a well-formed manufacturer specification claim", () => expect(validateEvidenceSource(base(), TODAY)).toEqual({ ok: true, errors: [] }));
  it("categories cannot be conflated: reviews are opinions, specs are claims, offers are not stock", () => {
    expect(ALLOWED_CLAIMS.customer_review).toEqual(["opinion"]);
    expect(ALLOWED_CLAIMS.manufacturer).toEqual(["specification"]);
    expect(ALLOWED_CLAIMS.shopping_area).toEqual(["location"]);
    expect(validateEvidenceSource(base({ sourceType: "customer_review", claimType: "specification" }), TODAY).errors.join()).toMatch(/cannot carry claimType/);
    expect(validateEvidenceSource(base({ sourceType: "manufacturer", claimType: "opinion" }), TODAY).ok).toBe(false);
    expect(validateEvidenceSource(base({ sourceType: "shopping_area", claimType: "registered_offer", match: undefined }), TODAY).ok).toBe(false);
  });
  it("no evidence type may be phrased as stock availability", () => {
    for (const t of Object.keys(ALLOWED_CLAIMS)) expect(canClaimStock({ sourceType: t as EvidenceSource["sourceType"] })).toBe(false);
  });
  it("every source type declares what it does NOT establish", () => {
    for (const note of Object.values(REQUIRED_SCOPE_NOTES)) expect(note.length).toBeGreaterThan(10);
    expect(REQUIRED_SCOPE_NOTES.torob_dataset).toContain("موجودی");
    expect(REQUIRED_SCOPE_NOTES.retailer).toContain("حضوری");
  });
  it("external sources need a verifiable plain-https URL", () => {
    for (const url of [undefined, "http://x.com/a", "javascript:alert(1)", "https://u:p@x.com/", "https://localhost/a", "nope"]) expect(validateEvidenceSource(base({ sourceUrl: url }), TODAY).ok, String(url)).toBe(false);
  });
  it("the dataset source itself needs no URL but still needs retrievedAt and scope limits", () => {
    const ds = base({ sourceType: "torob_dataset", sourceUrl: undefined, claimType: "registered_offer", match: undefined, scopeLimits: [REQUIRED_SCOPE_NOTES.torob_dataset] });
    expect(validateEvidenceSource(ds, TODAY).ok).toBe(true);
    expect(validateEvidenceSource({ ...ds, retrievedAt: "" }, TODAY).ok).toBe(false);
    expect(validateEvidenceSource({ ...ds, scopeLimits: [] }, TODAY).ok).toBe(false);
  });
  it("dates must be real, ISO and not in the future", () => {
    for (const bad of ["1405-07-30", "yesterday", "2026-13-40", "2027-01-01"]) expect(validateEvidenceSource(base({ retrievedAt: bad }), TODAY).ok, bad).toBe(false);
    expect(validateEvidenceSource(base({ publishedAt: "2027-02-01" }), TODAY).errors.join()).toMatch(/publishedAt/);
  });
  it("product-level evidence must say HOW it was matched; similarity matches are never 'high'", () => {
    expect(validateEvidenceSource(base({ match: undefined }), TODAY).errors.join()).toMatch(/needs a match/);
    expect(validateEvidenceSource(base({ match: { method: "exact_model_key" } }), TODAY).ok).toBe(false);
    expect(validateEvidenceSource(base({ match: { productId: "product_abc12345", method: "title_similarity" }, evidenceConfidence: "high" }), TODAY).errors.join()).toMatch(/never be 'high'/);
    expect(validateEvidenceSource(base({ match: { productId: "product_abc12345", method: "title_similarity" }, evidenceConfidence: "low" }), TODAY).ok).toBe(true);
  });
  it("invalid confidence / missing name are rejected", () => {
    expect(validateEvidenceSource(base({ evidenceConfidence: "certain" as never }), TODAY).ok).toBe(false);
    expect(validateEvidenceSource(base({ sourceName: " " }), TODAY).ok).toBe(false);
  });
});
