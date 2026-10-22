import { describe, expect, it } from "vitest";
import { analyzeQuery, toFtsExpr } from "./analyze";
import type { Vocabulary } from "./vocab";
import { osaDistance } from "@/server/domain/text";

/** A tiny in-memory vocabulary: the analyzer must work against ANY vocabulary, never against hard-coded words. */
function vocab(terms: Record<string, number>): Vocabulary {
  const sorted = Object.keys(terms).sort();
  return {
    size: sorted.length,
    doc: (t) => terms[t] ?? 0,
    hasPrefix: (p) => sorted.some((t) => t.startsWith(p)),
    fuzzy: (term, max, limit = 3, minDoc = 1) =>
      Object.entries(terms)
        .filter(([t, d]) => d >= minDoc && t !== term && Math.abs(t.length - term.length) <= max)
        .map(([t, d]) => ({ term: t, doc: d, distance: osaDistance(term, t, max) }))
        .filter((x) => x.distance <= max)
        .sort((a, b) => a.distance - b.distance || b.doc - a.doc)
        .slice(0, limit),
  };
}
const V = vocab({ هدفون: 1460, هندزفری: 1480, ایربادز: 400, بی: 900, سیم: 5000, بیسیم: 596, دوربین: 8000, مدار: 3769, بسته: 7143, مداربسته: 2811, پاور: 1538, بانک: 308, پاوربانک: 760, داهوا: 1158, dahua: 252, hdw1200clqp: 3, شب: 856, دید: 941, گوشی: 2000, هدفن: 5 });

describe("analyzeQuery: validity & stop words", () => {
  it.each([["", "empty"], ["   ", "empty"], ["!!!", "empty"], ["و", "only_stopwords"], ["با از به", "only_stopwords"], ["قیمت بهترین خرید", "only_stopwords"], ["ا", "only_stopwords"]])("«%s» is rejected as %s", (q, reason) => {
    const a = analyzeQuery(q, V);
    expect(a.valid).toBe(false);
    expect(a.invalidReason).toBe(reason);
  });
  it("drops function words but keeps product words, and remembers what it dropped", () => {
    const a = analyzeQuery("هدفون برای ورزش", V);
    expect(a.valid).toBe(true);
    expect(a.droppedStopWords).toEqual(["برای"]);
    expect(a.groups.map((g) => g.source)).toEqual(["هدفون", "ورزش"]);
  });
  it("extracts preference words (cheap) instead of searching for them", () => {
    const a = analyzeQuery("هدفون ارزان", V);
    expect(a.preferences).toEqual(["cheap"]);
    expect(a.groups.map((g) => g.source)).toEqual(["هدفون"]);
  });
  it("caps the number of groups", () => {
    expect(analyzeQuery("a1 b2 c3 d4 e5 f6 g7 h8 i9 j0 k1 l2", V).groups.length).toBeLessThanOrEqual(8);
  });
});

describe("analyzeQuery: Persian normalization & spacing", () => {
  it("unifies Arabic letters and Persian digits", () => {
    expect(analyzeQuery("هدفون ۲۰۰۰۰", V).groups.map((g) => g.source)).toEqual(["هدفون", "20000"]);
    expect(analyzeQuery("دوربين", V).groups[0]!.source).toBe("دوربین");
  });
  it("treats ZWNJ as a space (بی‌سیم → بی سیم)", () => {
    const a = analyzeQuery("هدفون بی" + String.fromCharCode(0x200c) + "سیم", V);
    expect(a.groups.map((g) => g.source)).toEqual(["هدفون", "بی سیم"]); // two words, joined as one vocabulary term «بیسیم»
    expect(a.groups[1]!.forms).toEqual(expect.arrayContaining(["بی سیم", "بیسیم"]));
  });
  it("joins adjacent words found as one vocabulary term (پاور بانک ⇄ پاوربانک)", () => {
    const a = analyzeQuery("پاور بانک", V);
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0]!.forms).toEqual(expect.arrayContaining(["پاور بانک", "پاوربانک"]));
  });
  it("does NOT join across a dropped stop word (دید در شب must stay two words)", () => {
    const a = analyzeQuery("دید در شب", V);
    expect(a.groups.map((g) => g.source)).toEqual(["دید", "شب"]);
  });
  it("known spacing variants expand in both directions (مداربسته ⇄ مدار بسته)", () => {
    expect(analyzeQuery("دوربین مداربسته", V).groups.flatMap((g) => g.forms).join("|")).toMatch(/مدار بسته/);
  });
});

describe("analyzeQuery: synonyms are validated against the vocabulary", () => {
  it("expands only to terms that exist in the data", () => {
    const a = analyzeQuery("هندزفری", V);
    expect(a.groups[0]!.forms).toEqual(expect.arrayContaining(["هندزفری", "هدفون", "ایربادز"]));
    expect(a.groups[0]!.forms).not.toContain("ایرفون"); // not in this vocabulary → never searched
    expect(a.expansions[0]!.from).toBe("هندزفری");
  });
  it("brand transliteration (داهوا ⇄ dahua)", () => {
    expect(analyzeQuery("داهوا", V).groups[0]!.forms).toEqual(expect.arrayContaining(["داهوا", "dahua"]));
  });
});

describe("analyzeQuery: typos", () => {
  it("corrects an unknown word to a close frequent one and reports the correction", () => {
    const a = analyzeQuery("هدفوون", V);
    expect(a.corrections).toEqual([{ from: "هدفوون", to: "هدفون" }]);
    expect(a.groups[0]!.unknown).toBe(false);
  });
  it("corrects a RARE existing word toward a ≥50× more frequent neighbour (هدفن → هدفون)", () => {
    expect(analyzeQuery("هدفن", V).corrections.some((c) => c.to === "هدفون")).toBe(true);
  });
  it("keeps a genuinely unknown word as unknown instead of inventing a correction", () => {
    const a = analyzeQuery("زززززز", V);
    expect(a.corrections).toEqual([]);
    expect(a.groups[0]!.unknown).toBe(true);
  });
  it("very short words are never 'corrected'", () => {
    expect(analyzeQuery("گوش", V).corrections).toEqual([]);
  });
});

describe("analyzeQuery: model tokens", () => {
  it("a hyphenated model becomes one dedicated group with phrase + compact forms", () => {
    const a = analyzeQuery("DH-HAC-HDW1200CLQP-IL-A", V);
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0]!.kind).toBe("model");
    expect(a.modelKeys).toEqual(expect.arrayContaining(["DHHACHDW1200CLQPILA", "HDW1200CLQP"]));
    expect(a.groups[0]!.alternatives.some((x) => x.includes("dh hac hdw1200clqp il a"))).toBe(true);
  });
  it("mixed Persian + Latin model", () => {
    const a = analyzeQuery("دوربین داهوا HDW1200CLQP", V);
    expect(a.groups.map((g) => g.kind)).toEqual(["word", "word", "model"]);
  });
});

describe("toFtsExpr: syntax safety", () => {
  it("quotes every token; user text can never inject FTS operators", () => {
    const expr = toFtsExpr(analyzeQuery('هدفون" OR NEAR(x) -bar* ^', V).groups);
    expect(expr).not.toMatch(/\bNEAR\b/);
    for (const part of expr.split(" AND ")) expect(part.replace(/[()]/g, "")).toMatch(/^"/);
  });
  it("column restriction wraps the whole expression", () => {
    expect(toFtsExpr(analyzeQuery("هدفون", V).groups, ["title", "brand"])).toMatch(/^\{title brand\} : \(/);
  });
  it("groups with several alternatives are OR-ed inside parentheses and AND-ed together", () => {
    expect(toFtsExpr(analyzeQuery("هندزفری بیسیم", V).groups)).toMatch(/^\(.* OR .*\) AND /);
  });
});
