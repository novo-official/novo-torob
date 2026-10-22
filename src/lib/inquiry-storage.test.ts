// @vitest-environment node
import { describe, expect, it } from "vitest";
import { initialInquiryState, type InquiryState, type ReplyEvidence } from "@/domain/inquiry";
import { sanitizeStoredInquiry, storageKey, STORAGE_VERSION } from "./inquiry-storage";

const IDS = ["q_stock", "q_price"];
const reply = (over: Partial<ReplyEvidence> = {}): ReplyEvidence => ({ id: "r1", provenance: "USER_REPORTED", rawText: "ok", stock: "yes", reportedPriceToman: 4_200_000, reportedUnit: "same", model: "same", warranty: { report: "not_asked", months: null }, payment: "not_asked", visitNote: "", receivedLabel: null, scenarioId: null, ...over });
const state = (over: Partial<InquiryState> = {}): InquiryState => ({ ...initialInquiryState(IDS), ...over });

describe("sessionStorage validation (tampered storage can never become trusted evidence)", () => {
  it("round-trips a valid manual state", () => {
    const s = state({ status: "USER_REPORTED_AVAILABLE", replies: [reply()], copiedAt: "2026-10-22T09:00:00.000Z" });
    const r = sanitizeStoredInquiry(JSON.parse(JSON.stringify(s)), IDS)!;
    expect(r.status).toBe("USER_REPORTED_AVAILABLE");
    expect(r.replies[0]).toMatchObject({ provenance: "USER_REPORTED", reportedPriceToman: 4_200_000 });
    expect(r.copiedAt).toBe("2026-10-22T09:00:00.000Z");
  });
  it("DEMO replies in storage are dropped (demo is memory-only and can never be re-imported as a real report)", () => {
    const s = JSON.parse(JSON.stringify(state({ replies: [reply({ id: "d1" })] })));
    s.replies[0].provenance = "DEMO_SIMULATED";
    s.replies.push({ ...reply({ id: "d2" }), provenance: "SOMETHING_ELSE" });
    expect(sanitizeStoredInquiry(s, IDS)!.replies).toEqual([]);
  });
  it("rejects wrong versions / junk and clamps unsafe values", () => {
    expect(sanitizeStoredInquiry(null, IDS)).toBeNull();
    expect(sanitizeStoredInquiry("x", IDS)).toBeNull();
    expect(sanitizeStoredInquiry({ ...state(), v: 99 }, IDS)).toBeNull();
    const t = JSON.parse(JSON.stringify(state({ replies: [reply()] })));
    t.replies[0].reportedPriceToman = 1e20;
    t.replies[0].stock = "definitely";
    t.replies[0].id = "<script>";
    expect(sanitizeStoredInquiry(t, IDS)!.replies).toEqual([]); // bad id
    t.replies[0].id = "ok-1";
    const r = sanitizeStoredInquiry(t, IDS)!.replies[0]!;
    expect(r.reportedPriceToman).toBeNull();
    expect(r.stock).toBe("unknown");
  });
  it("unknown question ids are filtered; custom questions are sanitised and bounded; draft text is sanitised", () => {
    const t = JSON.parse(JSON.stringify(state({ questionIds: ["q_stock", "q_evil", "c_1"], customQuestions: [{ id: "c_1", textFa: "ok‮" }], draftOverride: "a\u0000b" })));
    const r = sanitizeStoredInquiry(t, IDS)!;
    expect(r.questionIds).toEqual(["q_stock", "c_1"]);
    expect(r.customQuestions[0]!.textFa).toBe("ok");
    expect(r.draftOverride).toBe("ab");
  });
  it("stored data contains no phone-like or coordinate fields by construction", () => {
    const keys = Object.keys(JSON.parse(JSON.stringify(state())));
    expect(keys.join()).not.toMatch(/phone|tel|lat|lon|coord|demo/i);
    expect(storageKey({ product: "p", shop: "s", offer: "o" })).toBe(`hamghadam.inquiry.v${STORAGE_VERSION}:p|s|o`);
  });
});
