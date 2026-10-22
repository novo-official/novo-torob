import { describe, expect, it } from "vitest";
import { areSiblingKeys, buildMatchQuery, detectUnitHint, extractModelKeys, keysCompatible, modelRelation, normalizeSearchText, safePublicUrl } from "./text";

describe("normalizeSearchText", () => {
  it("unifies Arabic/Persian letters, digits, ZWNJ and diacritics", () => {
    expect(normalizeSearchText("دوربين كوچك‌مدل ۱۲٣ ـَ")).toBe("دوربین کوچک مدل 123");
  });
  it("keeps Latin model tokens intact and splits on punctuation", () => {
    expect(normalizeSearchText("داهوا DH-HAC-HDW1200CLQP (2MP)")).toBe("داهوا dh hac hdw1200clqp 2mp");
  });
  it("handles null / empty", () => {
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText("   ")).toBe("");
  });
});

describe("extractModelKeys / keysCompatible", () => {
  it("extracts compact and part keys", () => {
    expect(extractModelKeys("دوربین داهوا DH-HAC-HDW1200CLQP-IL-A")).toEqual(expect.arrayContaining(["DHHACHDW1200CLQPILA", "HDW1200CLQP"]));
  });
  it("ignores measurement-like tokens", () => {
    expect(extractModelKeys("خازن 2200uF 25V 5000mAh 12V")).toEqual([]);
  });
  it("joins two tokens separated by one space (FTP 4E-200S ≡ FTP4E-200S)", () => {
    expect(keysCompatible(extractModelKeys("هواکش FTP 4E-200S"), extractModelKeys("مدل FTP4E-200S سایز ۲۰"))).toBe(true);
    expect(keysCompatible(extractModelKeys("NVR304-32S"), extractModelKeys("مدل NVR 304-32S"))).toBe(true);
  });
  it("strips a short leading size number (43XH600 ≡ XH600, 55DU8000 ≡ DU8000)", () => {
    expect(keysCompatible(extractModelKeys("مدل 43XH600"), extractModelKeys("مدل XH600 سایز 43"))).toBe(true);
    expect(keysCompatible(extractModelKeys("DU8000 سایز ۵۵"), extractModelKeys("مدل 55DU8000"))).toBe(true);
  });
  it("does not treat measurements or word+digit as models (25V-1.5A-1W, 200dpi, Necklace5)", () => {
    expect(extractModelKeys("SS8050 25V-1.5A-1W NPN")).toEqual(["SS8050"]);
    expect(extractModelKeys("پوزتک 200dpi 400ml 30dBi")).toEqual([]);
    expect(extractModelKeys("هندزفری Necklace5")).toEqual([]);
  });
  it("still separates genuinely different models (KX-T7730 vs KX-AT7730, WD180PURZ vs WD181PURP)", () => {
    expect(keysCompatible(extractModelKeys("KX-T7730"), extractModelKeys("KX-AT7730"))).toBe(false);
    expect(keysCompatible(extractModelKeys("WD180PURZ"), extractModelKeys("WD181PURP"))).toBe(false);
  });
  it("accepts Persian digits inside Latin models", () => {
    expect(extractModelKeys("مدل JD۸۵۰۰THEB")).toContain("JD8500THEB");
  });
  it("treats a prefix family as compatible but different models as NOT compatible (LC1D95 vs LC1D50)", () => {
    const d95 = extractModelKeys("کنتاکتور 220 ولت LC1D95AM7 اشنایدر");
    const d50 = extractModelKeys("کنتاکتور 220 ولت LC1D50AM7 اشنایدر");
    expect(keysCompatible(d95, d50)).toBe(false);
    expect(keysCompatible(d95, extractModelKeys("LC1D95"))).toBe(true);
    expect(keysCompatible(extractModelKeys("HDW1200CLQP-IL-A"), extractModelKeys("DH-HAC-HDW1200CLQP"))).toBe(true);
  });
});

describe("detectUnitHint", () => {
  it.each([
    ["سیم مسی لخت (قیمت متری)", "per_metre"],
    ["سیم افشان مسی 2.5 افشار نژاد (1 متر)", "per_metre"],
    ["سیم افشان 2.5 حلقه 100 متری", "roll_or_pack"],
    ["رول برچسب دودی 30 متری", "roll_or_pack"],
    ["دوربین مداربسته داهوا DH-HAC", "unknown"], // «مداربسته» must not look like «بسته»
    ["کابل شبکه طول 5 متر", "unknown"], // a fixed-length cable is not a per-metre price
  ])("%s → %s", (title, hint) => expect(detectUnitHint(title)).toBe(hint));
});

describe("buildMatchQuery", () => {
  it("quotes every token and prefixes only the last", () => {
    expect(buildMatchQuery("دوربین داهوا HDW")?.and).toBe('"دوربین" AND "داهوا" AND "hdw"*');
  });
  it("neutralises FTS syntax and quotes in user input", () => {
    const q = buildMatchQuery('foo" OR NEAR(x) -bar*')!;
    expect(q.and).not.toMatch(/NEAR|\(/);
    expect(q.tokens.every((t) => !/["()*-]/.test(t))).toBe(true);
  });
  it("caps token count and returns null for empty", () => {
    expect(buildMatchQuery("a1 b2 c3 d4 e5 f6 g7 h8 i9 j0")?.tokens).toHaveLength(8);
    expect(buildMatchQuery("   ")).toBeNull();
  });
});

describe("safePublicUrl", () => {
  it("accepts https, rejects scripts and credentials", () => {
    expect(safePublicUrl("https://example.ir/shop")).toBe("https://example.ir/shop");
    expect(safePublicUrl("javascript:alert(1)")).toBeNull();
    expect(safePublicUrl("https://user:pw@example.ir")).toBeNull();
    expect(safePublicUrl("not a url")).toBeNull();
    expect(safePublicUrl(null)).toBeNull();
  });
});

describe("modelRelation (two-tier variant check)", () => {
  const rel = (p: string, o: string) => modelRelation(extractModelKeys(p), extractModelKeys(o));
  it.each([
    ["کنتاکتور LC1D95AM7", "کنتاکتور LC1D50AM7", "sibling"],
    ["کلید GV3P60", "کلید GV3P65", "sibling"],
    ["ترمومتر UT320D", "ترمومتر UT320A", "sibling"],
    ["تلفن KX-T7730", "تلفن KX-AT7730", "sibling"],
    ["هارد WD180PURZ", "هارد WD181PURP", "sibling"],
    ["دوربین DH-HAC-HDW1200CLQP-IL-A", "دوربین HDW1200CLQP", "compatible"],
    ["مدل 43XH600", "مدل XH600", "compatible"],
    ["قلم S Pen EJ-PS918", "PEN S23 ULTRA", "unrelated"],
    ["دوربین کانن EOS 250D", "Canon 250D kit", "unknown"],
    ["پمپ آب", "پمپ بشقابی CM100", "unknown"],
  ])("%s ⇄ %s → %s", (p, o, want) => expect(rel(p, o)).toBe(want));
  it("sibling keys need near-identity, shared start and ≥5 chars", () => {
    expect(areSiblingKeys("GV3P60", "GV3P65")).toBe(true);
    expect(areSiblingKeys("ABCDE", "XBCDE")).toBe(false); // different start
    expect(areSiblingKeys("AB12", "AB13")).toBe(false); // too short
    expect(areSiblingKeys("GV3P60", "GV3P60")).toBe(false);
  });
});
