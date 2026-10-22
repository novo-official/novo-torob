import { describe, expect, it } from "vitest";
import { buildQuestionDraft, QUESTION_INTENTS, resolveChannel, unresolvedIntents } from "./seller-questions";
import type { ContactChannel } from "./types";

const syntheticPhone: ContactChannel = { kind: "phone", value: "۰۰۰۰۰۰۰۰۰۰۰", trust: "synthetic" };

describe("resolveChannel", () => {
  it("never treats a synthetic dataset phone as actionable", () => {
    const c = resolveChannel([syntheticPhone]);
    expect(c.available).toBe(false);
    if (!c.available) expect(c.userMessage).toBe("راه ارتباطی تأییدشده در داده‌ها موجود نیست");
  });
  it("returns the safe default with no channels at all", () => {
    expect(resolveChannel([]).available).toBe(false);
  });
  it("accepts only a verified channel", () => {
    const c = resolveChannel([syntheticPhone, { kind: "website", value: "https://example.test", trust: "verified" }]);
    expect(c).toEqual({ available: true, kind: "website", value: "https://example.test" });
  });
});

describe("buildQuestionDraft", () => {
  it("builds a Persian numbered draft containing the product and selected questions only", () => {
    const d = buildQuestionDraft({ productTitle: "دوربین DH-HAC-HDW1200CLQP", intents: ["stock_availability", "fresh_price"], channels: [syntheticPhone] });
    expect(d.text).toContain("«دوربین DH-HAC-HDW1200CLQP»");
    expect(d.text).toContain("۱.");
    expect(d.text).toContain("۲.");
    expect(d.text).not.toContain("۳.");
    expect(d.intents).toEqual(["stock_availability", "fresh_price"]);
  });
  it("never leaks the synthetic phone number into the draft", () => {
    const d = buildQuestionDraft({ productTitle: "کالا", intents: ["hours"], channels: [syntheticPhone] });
    expect(d.text).not.toContain(syntheticPhone.value);
    expect(d.channel.available).toBe(false);
  });
  it("includes the user's variant note when given", () => {
    expect(buildQuestionDraft({ productTitle: "سیم ۲٫۵", variantNote: "حلقه ۱۰۰ متری", intents: ["fresh_price"] }).text).toContain("(حلقه ۱۰۰ متری)");
  });
  it("never claims availability, a sent message or a price", () => {
    const all = QUESTION_INTENTS.map((q) => q.id);
    const { text } = buildQuestionDraft({ productTitle: "کالا", intents: all });
    expect(text).not.toMatch(/ارسال\s*شد|موجود است(?!؟)|\d\s*تومان/);
  });
  it("keeps the canonical question order regardless of selection order", () => {
    const d = buildQuestionDraft({ productTitle: "x", intents: ["hours", "stock_availability"] });
    expect(d.intents).toEqual(["stock_availability", "hours"]);
  });
});

describe("unresolvedIntents", () => {
  it("returns drafted intents without a recorded response", () => {
    expect(unresolvedIntents(["stock_availability", "fresh_price"], [{ intent: "fresh_price" }])).toEqual(["stock_availability"]);
  });
});
