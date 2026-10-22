import { describe, expect, it } from "vitest";
import { schemaForCategory, SCHEMAS, formatAttrValue } from "./schemas";
import { buildProductText, parseDecimal, reconcileNumeric, unknownAttr } from "./specs";

const spec = (title: string, specs: Array<[string, string]> = []) => buildProductText(title, JSON.stringify(specs.map(([key, value]) => ({ section: "x", key, value }))));
const attrs = (cat: string, title: string, specs: Array<[string, string]> = []) => schemaForCategory(cat)!.extract(spec(title, specs));
const HP = "هدفون، هدست و هندزفری";
const CCTV = "دوربین مدار بسته";
const GEN = "ژنراتور و موتور برق";
const PB = "پاوربانک و شارژر همراه";
const PUMP = "پمپ خانگی و صنعتی";

describe("parseDecimal", () => {
  it.each([["8/5", 8.5], ["۸٫۵", 8.5], ["0/5", 0.5], ["1/2", 0.5], ["1/5", 1.5], ["7.5", 7.5], ["3", 3]])("%s → %s", (raw, n) => expect(parseDecimal(raw)).toBe(n));
});

describe("tri-state extraction: missing data is unknown, never 'no'", () => {
  it("a product with no specs and no clues is unknown on every attribute", () => {
    for (const s of SCHEMAS) {
      const a = s.extract(spec("محصول بدون اطلاعات"));
      for (const v of Object.values(a)) expect(v.confidence).toBe("unknown");
    }
  });
  it("explicit negatives are recorded as 'no' (not unknown)", () => {
    expect(attrs(HP, "هدفون x", [["قابلیت نویز کنسلینگ", "فاقد قابلیت نویز کنسلینگ"]]).anc!.value).toBe("no");
    expect(attrs(HP, "هدفون x", [["میکروفون", "ندارد"]]).mic!.value).toBe("no");
  });
});

describe("headphones", () => {
  it("spelling variants of wireless all map to wireless", () => {
    for (const v of ["بی‌سیم", "بی سیم", "بی‌ سیم", "بلوتوث", "Wireless"]) expect(attrs(HP, "هدفون", [["نوع اتصال", v]]).connection!.value).toBe("wireless");
  });
  it("wired variants map to wired; 'دوگانه' means both", () => {
    expect(attrs(HP, "هدفون", [["نوع اتصال", "با سیم"]]).connection!.value).toBe("wired");
    expect(attrs(HP, "هدفون", [["نوع اتصال", "باسیم"]]).connection!.value).toBe("wired");
    expect(attrs(HP, "هدفون", [["نوع اتصال", "دوگانه (بی‌سیم و با سیم)"]]).connection!.value).toBe("both");
  });
  it("falls back to the title when specs are silent, and cites the title as evidence", () => {
    const a = attrs(HP, "هدفون بی سیم ناتینگ");
    expect(a.connection!.value).toBe("wireless");
    expect(a.connection!.evidence[0]).toMatchObject({ kind: "title" });
  });
  it("evidence always quotes the recorded spec", () => {
    const a = attrs(HP, "هدفون", [["نوع اتصال", "بی‌سیم"]]);
    expect(a.connection!.evidence[0]).toMatchObject({ kind: "spec", label: "نوع اتصال" });
  });
  it("use: multi-valued 'مناسب برای' is split into use cases", () => {
    expect(attrs(HP, "هدفون", [["مناسب برای", "کاربری عمومی, مکالمه, ورزش"]]).use!.value).toEqual(expect.arrayContaining(["general", "calls", "sport"]));
  });
  it("question option tests: connection=wired mismatches an explicit wireless product (hard)", () => {
    const q = schemaForCategory(HP)!.questions.find((x) => x.id === "connection")!;
    const wired = q.options.find((o) => o.id === "wired")!;
    expect(wired.test(attrs(HP, "هدفون", [["نوع اتصال", "بی‌سیم"]])).effect).toBe("mismatch");
    expect(wired.test(attrs(HP, "هدفون")).effect).toBe("unknown");
    expect(q.hardness).toBe("hard");
  });
});

describe("CCTV", () => {
  it("IP67 is explicit outdoor evidence", () => {
    const a = attrs(CCTV, "دوربین", [["حفاظت", "IP67"]]);
    expect(a.environment).toMatchObject({ value: "outdoor", confidence: "explicit" });
  });
  it("bullet type without a rating is only INFERRED outdoor; dome is inferred indoor", () => {
    expect(attrs(CCTV, "دوربین بولت 2 مگاپیکسل").environment).toMatchObject({ value: "outdoor", confidence: "inferred" });
    expect(attrs(CCTV, "دوربین دام 2 مگاپیکسل").environment).toMatchObject({ value: "indoor", confidence: "inferred" });
  });
  it("night vision: 'ندارد' is no; a range in metres is yes", () => {
    expect(attrs(CCTV, "دوربین", [["دید در شب", "ندارد"]]).night!.value).toBe("no");
    expect(attrs(CCTV, "دوربین", [["برد دید در شب", "30 متر"], ["دید در شب", "30 متر"]]).night!.value).toBe("yes");
  });
  it("resolution from spec, title, or pixel dimensions (the last one is inferred)", () => {
    expect(attrs(CCTV, "دوربین", [["رزولوشن", "5MP"]]).resolution!.value).toBe(5);
    expect(attrs(CCTV, "دوربین 4 مگاپیکسل").resolution!.value).toBe(4);
    const px = attrs(CCTV, "دوربین", [["حداکثر رزولوشن", "1920 × 1080"]]).resolution!;
    expect(px.value).toBeCloseTo(2.1, 1);
    expect(px.confidence).toBe("inferred");
  });
  it("a title/spec megapixel contradiction becomes unknown with a conflict note", () => {
    const a = attrs(CCTV, "دوربین 8 مگاپیکسل", [["کیفیت تصویر", "2 مگاپیکسل"]]).resolution!;
    expect(a.value).toBeNull();
    expect(a.confidence).toBe("unknown");
    expect(a.conflict).toMatch(/مگاپیکسل/);
  });
  it("connection technology keeps IP / analog / wifi apart", () => {
    expect(attrs(CCTV, "دوربین تحت شبکه").tech!.value).toEqual(["ip"]);
    expect(attrs(CCTV, "دوربین AHD").tech!.value).toEqual(["analog"]);
    expect(attrs(CCTV, "دوربین سیمکارتی").tech!.value).toEqual(["wifi"]);
  });
});

describe("generator", () => {
  it("reads kW from slash decimals and watts", () => {
    expect(attrs(GEN, "موتور برق 8/5 کیلووات").power!.value).toBe(8.5);
    expect(attrs(GEN, "موتور برق ظرفیت ۸۰۰ وات").power!.value).toBe(0.8);
  });
  it("a spec range is an inferred class value, not exact", () => {
    expect(attrs(GEN, "ژنراتور", [["توان", "50-100 کاوا"]]).power).toMatchObject({ value: 100, confidence: "inferred" });
  });
  it("fuel, phase and start", () => {
    const a = attrs(GEN, "موتور برق بنزینی تک فاز استارتی");
    expect(a.fuel!.value).toEqual(["petrol"]);
    expect(a.phase!.value).toEqual(["single"]);
    expect(a.start!.value).toEqual(["electric"]);
  });
  it("need=home (≥3 kW) mismatches a 2 kW unit but not an unknown-power one", () => {
    const home = schemaForCategory(GEN)!.questions.find((x) => x.id === "need")!.options.find((o) => o.id === "home")!;
    expect(home.test(attrs(GEN, "موتور برق ۲ کیلووات")).effect).toBe("mismatch");
    expect(home.test(attrs(GEN, "موتور برق")).effect).toBe("unknown");
    expect(home.test(attrs(GEN, "موتور برق ۴ کیلووات")).effect).toBe("match");
  });
});

describe("power bank", () => {
  it("capacity from mAh, 'هزار' and bare numbers", () => {
    expect(attrs(PB, "پاوربانک ظرفیت 20000 میلی آمپر").capacity!.value).toBe(20000);
    expect(attrs(PB, "پاوربانک 10 هزار").capacity!.value).toBe(10000);
    expect(attrs(PB, "پاوربانک ۲۰۰۰۰").capacity).toMatchObject({ value: 20000, confidence: "inferred" });
  });
  it("conflicting title (20000) and spec (10000) → unknown, flagged", () => {
    const a = attrs(PB, "پاور بانک 22.5 وات ظرفیت 20000 میلی آمپر ساعت", [["ظرفیت اسمی", "10000 میلی آمپر ساعت"]]).capacity!;
    expect(a.value).toBeNull();
    expect(a.conflict).toContain("ظرفیت");
  });
  it("fast charge is 'yes' only when stated, otherwise unknown (never 'no')", () => {
    expect(attrs(PB, "پاوربانک PD 22.5 وات").fast!.value).toBe("yes");
    expect(attrs(PB, "پاوربانک ساده").fast!.confidence).toBe("unknown");
  });
});

describe("pump", () => {
  it("horsepower with slash decimals", () => {
    expect(attrs(PUMP, "پمپ آب ظرفیت 0/5 اسب").hp!.value).toBe(0.5);
    expect(attrs(PUMP, "پمپ", [["قدرت", "7.5 اسب بخار"]]).hp!.value).toBe(7.5);
  });
  it("voltage from phase wording", () => {
    expect(attrs(PUMP, "پمپ سه فاز").voltage!.value).toEqual(["380"]);
    expect(attrs(PUMP, "پمپ", [["ولتاژ", "220 ولت"]]).voltage!.value).toEqual(["220"]);
  });
  it("home use rejects an explicit 380 V pump", () => {
    const home = schemaForCategory(PUMP)!.questions[0]!.options.find((o) => o.id === "home")!;
    expect(home.test(attrs(PUMP, "پمپ سه فاز 5 اسب")).effect).toBe("mismatch");
  });
});

describe("schema hygiene", () => {
  it("every question has ≥1 option, unique ids, and a known attribute", () => {
    for (const s of SCHEMAS) {
      const ids = new Set<string>();
      for (const q of s.questions) {
        expect(q.options.length).toBeGreaterThan(0);
        expect(ids.has(q.id)).toBe(false);
        ids.add(q.id);
        expect(Object.keys(s.attributeLabels)).toContain(q.attribute);
        expect(new Set(q.options.map((o) => o.id)).size).toBe(q.options.length);
      }
      expect(s.questions.filter((q) => q.stage === "initial").length).toBeLessThanOrEqual(2); // ≤ 3 steps incl. budget
    }
  });
  it("formatAttrValue never leaks internal codes", () => {
    expect(formatAttrValue("connection", "wireless")).toBe("بی‌سیم");
    expect(formatAttrValue("resolution", 5)).toMatch(/مگاپیکسل/);
    expect(formatAttrValue("fuel", ["petrol", "gas"])).toBe("بنزین، گاز");
    expect(formatAttrValue("x", null)).toBeNull();
  });
});

describe("reconcileNumeric", () => {
  const n = (v: number) => ({ value: v, confidence: "explicit" as const, evidence: [] });
  it("agreeing within 10% keeps the spec value", () => expect(reconcileNumeric(n(100), n(105), "x").value).toBe(100));
  it("disagreeing beyond 10% is unknown", () => expect(reconcileNumeric(n(100), n(150), "x").value).toBeNull());
  it("one side only is used as is", () => {
    expect(reconcileNumeric(null, n(7), "x").value).toBe(7);
    expect(reconcileNumeric(null, null, "x")).toEqual(unknownAttr());
  });
});
