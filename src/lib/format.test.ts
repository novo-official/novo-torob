import { describe, expect, it } from "vitest";
import { clip, formatToman, normalizeFa, parseBudget, safeDecode, toFaDigits, toLatinDigits } from "./format";

describe("digits", () => {
  it("converts ASCII to Persian digits", () => expect(toFaDigits("A12-3")).toBe("A۱۲-۳"));
  it("converts Persian, Arabic-Indic digits and separators to ASCII", () => {
    expect(toLatinDigits("۱٬۲۵۰٬۰۰۰")).toBe("1250000");
    expect(toLatinDigits("٣٤٥")).toBe("345");
  });
});

describe("formatToman", () => {
  it("formats with Persian grouping and unit", () => {
    const s = formatToman(12500000)!;
    expect(s).toContain("تومان");
    expect(s).toMatch(/^[۰-۹٬]+ تومان$/);
  });
  it("returns null (never 0) for missing or non-finite prices", () => {
    expect(formatToman(null)).toBeNull();
    expect(formatToman(undefined)).toBeNull();
    expect(formatToman(Number.NaN)).toBeNull();
  });
});

describe("parseBudget", () => {
  it.each([
    ["۵٬۰۰۰٬۰۰۰", 5000000],
    ["5,000,000", 5000000],
    ["۲۵۰ تومان", 250],
  ])("parses %s", (raw, expected) => expect(parseBudget(raw)).toBe(expected));
  it.each(["", "   ", "abc", "-5", "0", "12abc"])("rejects %j", (raw) => expect(parseBudget(raw)).toBeNull());
});

describe("normalizeFa", () => {
  it("unifies Arabic ya/kaf, digits and half-spaces", () => {
    expect(normalizeFa("دوربين كوچك‌مدل ۱۲")).toBe("دوربین کوچک مدل 12");
  });
});

describe("clip / safeDecode", () => {
  it("clips long text", () => expect(clip("x".repeat(300), 10)).toBe("xxxxxxxxxx…"));
  it("does not throw on malformed escapes", () => expect(safeDecode("%E0%A4%A")).toBe("%E0%A4%A"));
  it("decodes valid escapes", () => expect(safeDecode("%D8%B3")).toBe("س"));
});

import { formatNumberFa } from "./format";
describe("formatNumberFa", () => {
  it("groups with Persian digits and round-trips through parseBudget", () => {
    expect(formatNumberFa(5000000)).toBe("۵٬۰۰۰٬۰۰۰");
    expect(parseBudget(formatNumberFa(5000000))).toBe(5000000);
  });
});
