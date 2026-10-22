import { describe, expect, it } from "vitest";
import { buildAdvisorHref, parseAdvisorParams, safeBackHref } from "./advisor-url";

const parse = (qs: string) => parseAdvisorParams(new URLSearchParams(qs));

describe("advisor URL state", () => {
  it("round-trips a full intent", () => {
    const a = parse("text=%D9%87%D8%AF%D9%81%D9%88%D9%86&cat=%D9%87%D8%AF%D9%81%D9%88%D9%86&a.use=sport&a.connection=wireless&skip=night&bmin=1000000&bmax=3000000&brand=%D8%A7%D9%86%DA%A9%D8%B1&show=1");
    expect(a).toMatchObject({ text: "هدفون", category: "هدفون", answers: { use: "sport", connection: "wireless" }, skipped: ["night"], bmin: 1000000, bmax: 3000000, brands: ["انکر"], show: true });
    expect(parse(buildAdvisorHref(a).split("?")[1]!)).toEqual(a);
  });
  it("drops malformed ids, numbers and never carries coordinates", () => {
    const a = parse("a.__proto__=x&a.Bad-Id=1&a.use=<script>&skip=ok,BAD,../x&bmin=-5&bmax=abc&lat=35.7&lon=51.4&ask=1bad");
    expect(a.answers).toEqual({});
    expect(a.skipped).toEqual(["ok"]);
    expect(a.bmin).toBeNull();
    expect(a.bmax).toBeNull();
    expect(a.ask).toBeNull();
    expect(buildAdvisorHref(a)).not.toMatch(/lat|lon/);
  });
  it("caps the number of answers and text length", () => {
    const qs = Array.from({ length: 40 }, (_, i) => `a.q${i}=v`).join("&") + "&text=" + "x".repeat(900);
    const a = parse(qs);
    expect(Object.keys(a.answers).length).toBeLessThanOrEqual(12);
    expect(a.text.length).toBe(200);
  });
  it("an empty state builds the bare route", () => expect(buildAdvisorHref({})).toBe("/discover"));
  it("safeBackHref only accepts same-origin /discover and /search targets", () => {
    expect(safeBackHref("/discover?cat=x&show=1")).toBe("/discover?cat=x&show=1");
    expect(safeBackHref("/search?q=a")).toBe("/search?q=a");
    for (const bad of ["https://evil.example", "//evil.example", "/products/x", "javascript:alert(1)", "/discover@evil", "", null, undefined]) expect(safeBackHref(bad as string)).toBeNull();
  });
});
