import type { AdvisorOption, AdvisorQuestion } from "@/domain/advisor";
import {
  buildProductText, findSpec, lite, NEGATIVE, parseDecimal, reconcileNumeric, specEvidence, specsWhere, titleEvidence, unknownAttr,
  type Attr, type ProductText,
} from "./specs";

export type Test = { effect: "match" | "mismatch" | "unknown"; confidence: "explicit" | "inferred" | "unknown" };
const MATCH_E: Test = { effect: "match", confidence: "explicit" };
const UNKNOWN: Test = { effect: "unknown", confidence: "unknown" };

export interface OptionDef extends AdvisorOption {
  /** evaluate this option against extracted attributes */
  test: (a: Record<string, Attr<unknown>>) => Test;
}
export interface QuestionDef extends Omit<AdvisorQuestion, "options"> {
  options: OptionDef[];
  /** human labels for attributes this question reads (for evidence text) */
  attribute: string;
}

export interface CategorySchema {
  id: string;
  /** exact category_name in the catalog */
  category: string;
  label: string;
  extract: (p: ProductText) => Record<string, Attr<unknown>>;
  /** is this a main product (not a spare part / accessory that happens to sit in the category)? */
  primary: (p: ProductText) => boolean;
  attributeLabels: Record<string, string>;
  questions: QuestionDef[];
  limitations: string[];
}

// ---------- helpers ----------
const has = (re: RegExp, s: string) => re.test(s);
function scan(p: ProductText, keyRe: RegExp, rules: Array<[RegExp, string]>, titleRules: Array<[RegExp, string]> = []): Attr<string[]> {
  const found = new Set<string>();
  const evidence: Attr<string[]>["evidence"] = [];
  for (const s of specsWhere(p, keyRe)) {
    if (NEGATIVE.test(s.nvalue) && !rules.some(([re]) => has(re, s.nvalue))) continue;
    for (const [re, v] of rules) if (has(re, s.nvalue) && !found.has(v)) { found.add(v); evidence.push(specEvidence(s)); }
  }
  if (!found.size) {
    for (const [re, v] of titleRules) {
      const m = re.exec(p.ntitle);
      if (m && !found.has(v)) { found.add(v); evidence.push(titleEvidence(m[0])); }
    }
  }
  return found.size ? { value: [...found], confidence: "explicit", evidence } : unknownAttr<string[]>();
}
/** attribute value as a list of strings (scalar string attributes become one-element lists) */
const list = (a: Attr<unknown> | undefined): string[] => {
  const v = a?.value;
  return Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : [];
};
const num = (a: Attr<unknown> | undefined): number | null => (typeof a?.value === "number" ? a.value : null);
const conf = (a: Attr<unknown> | undefined): "explicit" | "inferred" => (a?.confidence === "inferred" ? "inferred" : "explicit");

/** option matches when one of its values is present; mismatches when the attribute is known and lacks all of them */
const oneOf = (attr: string, wanted: string[], mismatchIfOther = true) => (a: Record<string, Attr<unknown>>): Test => {
  const at = a[attr];
  const vals = list(at);
  if (!vals.length) return UNKNOWN;
  if (vals.some((v) => wanted.includes(v)) || vals.includes("both")) return { effect: "match", confidence: conf(at) };
  return mismatchIfOther ? { effect: "mismatch", confidence: conf(at) } : UNKNOWN;
};

const ANY: OptionDef = { id: "any", label: "فرقی نمی‌کند", test: () => MATCH_E };

// ======================= هدفون، هدست و هندزفری =======================
const headphones: CategorySchema = {
  id: "headphones",
  primary: (p) => !/^(گوش (راست|چپ)|کیس|قاب|کاور|پد|اسفنج|کابل|سیم|پوشش)(?=\s|$)/.test(p.ntitle),
  category: "هدفون، هدست و هندزفری",
  label: "هدفون و هندزفری",
  attributeLabels: { connection: "نوع اتصال", wearing: "نوع پوشش", use: "کاربرد", anc: "نویز کنسلینگ", mic: "میکروفون" },
  limitations: ["کیفیت صدا در داده سنجیده نشده؛ فقط مشخصات ثبت‌شده مقایسه می‌شود.", "بخشی از محصولات مشخصات کامل ندارند و «نامشخص» می‌مانند."],
  extract(p) {
    const connRaw = scan(
      p, /اتصال|رابط|بلوتوث/,
      [[/(بی ?سیم|بلوتوث|wireless|tws|bluetooth|دوگانه)/, "wireless"], [/(با ?سیم|jack|جک|aux|دوگانه)/, "wired"]],
      [[/(بی ?سیم|بلوتوث|wireless|tws|ایرپاد|airpods?|bluetooth)/, "wireless"], [/(با ?سیم|سیمی)/, "wired"]],
    );
    const connVals = list(connRaw);
    const connection: Attr<string> = connVals.length === 0 ? unknownAttr() : { ...connRaw, value: connVals.length > 1 ? "both" : connVals[0]! };
    const wearing = scan(p, /نوع هدفون|نوع گوشی|شکل|نوع محصول/, [[/(tws|true wireless)/, "tws"], [/(گردنی|neckband)/, "neckband"], [/(رو گوشی|over ?ear|on ?ear)/, "over_ear"], [/(تو گوشی|in ?ear|earbud|داخل گوش|ایربادز)/, "in_ear"]], [[/(tws|ایرپاد|airpods?)/, "tws"], [/(گردنی|neckband)/, "neckband"]]);
    const use = scan(p, /مناسب برای|کاربرد/, [[/(گیمینگ|gaming|گیمر|بازی)/, "gaming"], [/(ورزش|sport|دویدن|running)/, "sport"], [/(مکالمه|تماس|کنفرانس)/, "calls"], [/(عمومی|روزمره|موزیک|music)/, "general"]], [[/(گیمینگ|gaming|گیمر)/, "gaming"], [/(ورزشی|sport)/, "sport"]]);
    const ancSpec = specsWhere(p, /نویز|anc/)[0];
    let anc: Attr<string> = unknownAttr();
    if (ancSpec) {
      const neg = NEGATIVE.test(ancSpec.nvalue) || /فاقد/.test(ancSpec.nvalue);
      anc = { value: neg ? "no" : "yes", confidence: "explicit", evidence: [specEvidence(ancSpec)] };
    } else {
      const m = /(anc|نویز ?کنسل\w*|noise ?cancel\w*)/.exec(p.ntitle);
      if (m) anc = { value: "yes", confidence: "explicit", evidence: [titleEvidence(m[0])] };
    }
    const micSpec = specsWhere(p, /میکروفون|mic/)[0];
    let mic: Attr<string> = unknownAttr();
    if (micSpec) mic = { value: NEGATIVE.test(micSpec.nvalue) ? "no" : "yes", confidence: "explicit", evidence: [specEvidence(micSpec)] };
    else if (/(میکروفون|\bmic\b|هدست|headset)/.test(p.ntitle)) mic = { value: "yes", confidence: "inferred", evidence: [titleEvidence(/(میکروفون|\bmic\b|هدست|headset)/.exec(p.ntitle)![0], "inferred")] };
    return { connection, wearing: wearing, use, anc, mic };
  },
  questions: [
    {
      id: "use", text: "بیشتر برای چه کاری می‌خواهید؟", kind: "single", hardness: "soft", stage: "initial", attribute: "use",
      options: [
        { id: "general", label: "گوش دادن روزمره", test: oneOf("use", ["general"], false) },
        { id: "sport", label: "ورزش", test: oneOf("use", ["sport"], false) },
        { id: "gaming", label: "بازی", test: oneOf("use", ["gaming"], false) },
        { id: "calls", label: "مکالمه و جلسه", test: (a) => (list(a.use).includes("calls") || a.mic?.value === "yes" ? { effect: "match", confidence: a.mic?.value === "yes" && !list(a.use).includes("calls") ? "inferred" : "explicit" } : UNKNOWN) },
      ],
    },
    {
      id: "connection", text: "اتصال را چطور ترجیح می‌دهید؟", kind: "single", hardness: "hard", stage: "initial", attribute: "connection",
      options: [
        { id: "wireless", label: "بی‌سیم (بلوتوث)", test: oneOf("connection", ["wireless"]) },
        { id: "wired", label: "با سیم", test: oneOf("connection", ["wired"]) },
      ],
    },
    {
      id: "wearing", text: "ترجیح می‌دهید چطور استفاده شود؟", kind: "single", hardness: "soft", stage: "refine", attribute: "wearing",
      options: [
        { id: "in_ear", label: "داخل گوش (هندزفری / ایربادز)", test: oneOf("wearing", ["in_ear", "tws"]) },
        { id: "over_ear", label: "روی گوش (هدفون)", test: oneOf("wearing", ["over_ear"]) },
        { id: "neckband", label: "گردنی", test: oneOf("wearing", ["neckband"]) },
      ],
    },
    {
      id: "anc", text: "حذف نویز محیط برایتان مهم است؟", kind: "single", hardness: "soft", stage: "refine", attribute: "anc",
      options: [{ id: "yes", label: "بله، مهم است", test: oneOf("anc", ["yes"]) }, ANY],
    },
    {
      id: "mic", text: "میکروفون لازم دارید؟", kind: "single", hardness: "soft", stage: "refine", attribute: "mic",
      options: [{ id: "yes", label: "بله", test: oneOf("mic", ["yes"]) }, ANY],
    },
  ],
};

// ======================= دوربین مدار بسته =======================
function resolutionMp(p: ProductText): Attr<number> {
  const re = /(\d+(?:\.\d+)?)\s*(?:mp\b|مگا ?پیکسل)/;
  let spec: Attr<number> | null = null;
  for (const s of specsWhere(p, /رزولوشن|کیفیت تصویر|مگاپیکسل/)) {
    const m = re.exec(s.nvalue);
    if (m) { spec = { value: Number(m[1]), confidence: "explicit", evidence: [specEvidence(s)] }; break; }
    const wh = /(\d{3,4})\s*[x×*]\s*(\d{3,4})/.exec(s.nvalue);
    if (wh) { spec = { value: +((Number(wh[1]) * Number(wh[2])) / 1e6).toFixed(1), confidence: "inferred", evidence: [specEvidence(s, "inferred")] }; break; }
  }
  const t = re.exec(p.ntitle);
  const title: Attr<number> | null = t ? { value: Number(t[1]), confidence: "explicit", evidence: [titleEvidence(t[0])] } : null;
  // a pixel-count estimate (inferred) must not trigger a conflict with the title's rounded megapixel figure
  return spec && spec.confidence === "inferred" && title ? title : reconcileNumeric(spec, title, "مگاپیکسل");
}
const cctv: CategorySchema = {
  id: "cctv",
  primary: (p) => !/^(قاب|کیت|محافظ|پایه|کاور|آداپتور|کابل|لنز|باکس|جعبه|عنوان حذف)(?=\s|$)/.test(p.ntitle),
  category: "دوربین مدار بسته",
  label: "دوربین مداربسته",
  attributeLabels: { environment: "محیط نصب", night: "دید در شب", resolution: "کیفیت تصویر (مگاپیکسل)", tech: "فناوری اتصال", mic: "میکروفون" },
  limitations: ["«محیط نصب» در بسیاری از محصولات صریح نیست و از نوع دوربین (بولت/دام) یا درجه‌ی حفاظت استنباط می‌شود؛ این موارد «استنباطی» برچسب می‌خورند.", "برد و کیفیت واقعی دید در شب سنجیده نمی‌شود؛ فقط وجود قابلیت ثبت‌شده را می‌بینیم."],
  extract(p) {
    let environment: Attr<string> = unknownAttr();
    const outExplicit = /(بیرون|outdoor|خارجی|فضای باز|ضد ?آب|ip ?6[5-8])/;
    const inExplicit = /(داخل ساختمان|داخلی|indoor|فضای بسته)/;
    const typeSpec = specsWhere(p, /نوع دوربین/)[0];
    const hay = [p.ntitle, ...specsWhere(p, /نوع دوربین|حفاظت|مقاومت|ip|فضا|محیط/).map((s) => s.nvalue)].join(" | ");
    const evidenceFor = (re: RegExp) => {
      const s = specsWhere(p, /نوع دوربین|حفاظت|مقاومت|ip|فضا|محیط/).find((x) => re.test(x.nvalue));
      return s ? specEvidence(s) : titleEvidence(re.exec(p.ntitle)?.[0] ?? "");
    };
    const o = outExplicit.test(hay);
    const i = inExplicit.test(hay);
    if (o && i) environment = { value: "both", confidence: "explicit", evidence: [evidenceFor(outExplicit)] };
    else if (o) environment = { value: "outdoor", confidence: "explicit", evidence: [evidenceFor(outExplicit)] };
    else if (i) environment = { value: "indoor", confidence: "explicit", evidence: [evidenceFor(inExplicit)] };
    else if (/(بولت|بالت|bullet)/.test(hay)) environment = { value: "outdoor", confidence: "inferred", evidence: [typeSpec ? specEvidence(typeSpec, "inferred") : titleEvidence("بولت", "inferred")] };
    else if (/(دام|dome)/.test(hay)) environment = { value: "indoor", confidence: "inferred", evidence: [typeSpec ? specEvidence(typeSpec, "inferred") : titleEvidence("دام", "inferred")] };

    let night: Attr<string> = unknownAttr();
    const nvSpec = specsWhere(p, /دید در شب|دید شب|night/)[0];
    if (nvSpec) night = { value: NEGATIVE.test(nvSpec.nvalue) ? "no" : "yes", confidence: "explicit", evidence: [specEvidence(nvSpec)] };
    else {
      const m = /(دید در شب|دید شب|night ?vision|مادون قرمز|warm ?light|وارم ?لایت|starlight|full ?color|فول ?کالر)/.exec(p.ntitle);
      if (m) night = { value: "yes", confidence: "explicit", evidence: [titleEvidence(m[0])] };
    }
    const tech = scan(p, /تکنولوژی|فناوری|نوع اتصال|نوع دوربین مداربسته/, [[/(تحت شبکه|\bipc?\b|poe)/, "ip"], [/(ahd|tvi|cvi|hdcvi|turbo ?hd|آنالوگ|analog|bnc)/, "analog"], [/(wi ?fi|وای ?فای|بی ?سیم|سیم ?کارت)/, "wifi"]], [[/(تحت شبکه|\bip\b)/, "ip"], [/(ahd|tvi|cvi|hdcvi|آنالوگ)/, "analog"], [/(wi ?fi|وای ?فای|سیم ?کارت|بی ?سیم)/, "wifi"]]);
    const micSpec = specsWhere(p, /میکروفون/)[0];
    const mic: Attr<string> = micSpec ? { value: NEGATIVE.test(micSpec.nvalue) ? "no" : "yes", confidence: "explicit", evidence: [specEvidence(micSpec)] } : unknownAttr();
    return { environment, night, resolution: resolutionMp(p), tech, mic };
  },
  questions: [
    {
      id: "environment", text: "دوربین را کجا نصب می‌کنید؟", kind: "single", hardness: "hard", stage: "initial", attribute: "environment",
      options: [
        { id: "outdoor", label: "بیرون ساختمان / حیاط", test: oneOf("environment", ["outdoor"]) },
        { id: "indoor", label: "داخل ساختمان", test: oneOf("environment", ["indoor"]) },
      ],
    },
    {
      id: "night", text: "دید در شب لازم است؟", kind: "single", hardness: "hard", stage: "initial", attribute: "night",
      options: [{ id: "yes", label: "بله، لازم است", test: oneOf("night", ["yes"]) }, { id: "no", label: "نه، فقط روز", test: () => MATCH_E }],
    },
    {
      id: "resolution", text: "وضوح تصویر چقدر مهم است؟", help: "بر پایه‌ی مگاپیکسل ثبت‌شده؛ بیشتر بودن عدد الزاماً تصویر بهتر نیست.", kind: "single", hardness: "soft", stage: "refine", attribute: "resolution",
      options: [
        { id: "basic", label: "معمولی (حدود ۲ مگاپیکسل)", test: (a) => (num(a.resolution) === null ? UNKNOWN : { effect: num(a.resolution)! >= 2 ? "match" : "mismatch", confidence: conf(a.resolution) }) },
        { id: "good", label: "خوب (۴ مگاپیکسل به بالا)", test: (a) => (num(a.resolution) === null ? UNKNOWN : { effect: num(a.resolution)! >= 4 ? "match" : "mismatch", confidence: conf(a.resolution) }) },
        { id: "high", label: "بالا (۸ مگاپیکسل به بالا)", test: (a) => (num(a.resolution) === null ? UNKNOWN : { effect: num(a.resolution)! >= 8 ? "match" : "mismatch", confidence: conf(a.resolution) }) },
      ],
    },
    {
      id: "tech", text: "نوع اتصال دوربین؟", kind: "single", hardness: "soft", stage: "refine", attribute: "tech",
      options: [
        { id: "ip", label: "تحت شبکه (IP)", test: oneOf("tech", ["ip"]) },
        { id: "analog", label: "آنالوگ (AHD / TVI …)", test: oneOf("tech", ["analog"]) },
        { id: "wifi", label: "بی‌سیم / وای‌فای / سیم‌کارت", test: oneOf("tech", ["wifi"]) },
      ],
    },
    { id: "mic", text: "میکروفون لازم است؟", kind: "single", hardness: "soft", stage: "refine", attribute: "mic", options: [{ id: "yes", label: "بله", test: oneOf("mic", ["yes"]) }, ANY] },
  ],
};

// ======================= ژنراتور و موتور برق =======================
function powerKw(p: ProductText): Attr<number> {
  const kw = /(\d+(?:\.\d+)?|\d+\/\d+)\s*(?:کیلو ?وات|کیلووات|kw\b|کاوا|kva\b|کیلو ?ولت ?آمپر)/;
  const range = /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:کاوا|کیلو ?وات|kw\b|kva\b)/;
  const watts = /(\d{3,5})\s*وات/;
  let spec: Attr<number> | null = null;
  for (const s of specsWhere(p, /توان|ظرفیت|قدرت برق|خروجی/)) {
    const r = range.exec(s.nvalue);
    if (r) { spec = { value: Number(r[2]), confidence: "inferred", evidence: [specEvidence(s, "inferred")] }; break; }
    const m = kw.exec(s.nvalue);
    if (m) { spec = { value: parseDecimal(m[1]!) ?? 0, confidence: "explicit", evidence: [specEvidence(s)] }; break; }
    const w = watts.exec(s.nvalue);
    if (w) { spec = { value: Number(w[1]) / 1000, confidence: "explicit", evidence: [specEvidence(s)] }; break; }
  }
  const t = kw.exec(p.ntitle);
  const tw = watts.exec(p.ntitle);
  const title: Attr<number> | null = t ? { value: parseDecimal(t[1]!) ?? 0, confidence: "explicit", evidence: [titleEvidence(t[0])] } : tw ? { value: Number(tw[1]) / 1000, confidence: "explicit", evidence: [titleEvidence(tw[0])] } : null;
  // spec ranges ("50-100 کاوا") are classes, not exact values: they never conflict with the title
  return spec && spec.confidence === "inferred" && title ? title : reconcileNumeric(spec, title, "توان");
}
const generator: CategorySchema = {
  id: "generator",
  primary: (p) => !/^(لاستیک|قطعه|فیلتر|شمع|کاربراتور|سوپاپ|پیستون|رگولاتور|کویل|واشر|بوش|زنجیر|تسمه|آلترناتور|دینام|لوازم|پمپ بنزین|مخزن|درپوش|دسته|روغن|باتری|کیف|کاور|پایه|چرخ|لنت|بلبرینگ|سیم|کلید|سوئیچ)(?=\s|$)/.test(p.ntitle),
  category: "ژنراتور و موتور برق",
  label: "موتور برق و ژنراتور",
  attributeLabels: { power: "توان (کیلووات)", fuel: "نوع سوخت", phase: "تعداد فاز", start: "روش روشن شدن", silent: "سایلنت" },
  limitations: ["بازه‌های «چه چیزی را روشن می‌کند» تقریبی‌اند؛ پیش از خرید توان راه‌اندازی تجهیزات (مثلاً کمپرسور) را بررسی کنید.", "توان گاهی به‌صورت بازه (مثلاً ۵۰–۱۰۰ کاوا) ثبت شده و «استنباطی» برچسب می‌خورد."],
  extract(p) {
    return {
      power: powerKw(p),
      fuel: scan(p, /سوخت/, [[/(بنزین|petrol|gasoline)/, "petrol"], [/(گازوئیل|گازوییل|دیزل|diesel)/, "diesel"], [/(گاز ?شهری|گاز مایع|lpg|cng|گازسوز|سه ?گانه|دو ?گانه)/, "gas"]], [[/(بنزین|بنزینی)/, "petrol"], [/(دیزل|گازوئیل)/, "diesel"], [/(گازسوز|سه ?گانه|دو ?گانه)/, "gas"]]),
      phase: scan(p, /فاز/, [[/(تک ?فاز|single|\b1\b)/, "single"], [/(سه ?فاز|three|\b3\b)/, "three"]], [[/(تک ?فاز)/, "single"], [/(سه ?فاز)/, "three"]]),
      start: scan(p, /روشن|استارت/, [[/هندلی/, "manual"], [/(استارتی|برقی)/, "electric"], [/ریموت/, "remote"]], [[/(استارتی)/, "electric"], [/(هندلی)/, "manual"]]),
      silent: scan(p, /سایلنت|صدا/, [[/(سایلنت|silent|کم ?صدا|بی ?صدا)/, "yes"]], [[/(سایلنت|silent)/, "yes"]]),
    };
  },
  questions: [
    {
      id: "need", text: "می‌خواهید چه چیزهایی را با آن روشن کنید؟", help: "بازه‌ها تقریبی‌اند و فقط برای فیلتر توان کمینه استفاده می‌شوند.", kind: "single", hardness: "hard", stage: "initial", attribute: "power",
      options: [
        { id: "small", label: "چند لامپ و وسایل کوچک (حدود ۱ تا ۲ کیلووات)", test: (a) => (num(a.power) === null ? UNKNOWN : { effect: num(a.power)! >= 1 ? "match" : "mismatch", confidence: conf(a.power) }) },
        { id: "home", label: "یخچال، تلویزیون و روشنایی خانه (حدود ۳ کیلووات به بالا)", test: (a) => (num(a.power) === null ? UNKNOWN : { effect: num(a.power)! >= 3 ? "match" : "mismatch", confidence: conf(a.power) }) },
        { id: "shop", label: "مغازه یا کارگاه کوچک (حدود ۵ کیلووات به بالا)", test: (a) => (num(a.power) === null ? UNKNOWN : { effect: num(a.power)! >= 5 ? "match" : "mismatch", confidence: conf(a.power) }) },
        { id: "large", label: "ساختمان یا کارگاه بزرگ (۸ کیلووات به بالا)", test: (a) => (num(a.power) === null ? UNKNOWN : { effect: num(a.power)! >= 8 ? "match" : "mismatch", confidence: conf(a.power) }) },
      ],
    },
    {
      id: "fuel", text: "سوخت مورد نظر؟", kind: "single", hardness: "hard", stage: "initial", attribute: "fuel",
      options: [{ id: "petrol", label: "بنزین", test: oneOf("fuel", ["petrol"]) }, { id: "diesel", label: "گازوئیل", test: oneOf("fuel", ["diesel"]) }, { id: "gas", label: "گاز", test: oneOf("fuel", ["gas"]) }],
    },
    {
      id: "phase", text: "برق ساختمان شما چند فاز است؟", kind: "single", hardness: "hard", stage: "refine", attribute: "phase",
      options: [{ id: "single", label: "تک‌فاز", test: oneOf("phase", ["single"]) }, { id: "three", label: "سه‌فاز", test: oneOf("phase", ["three"]) }],
    },
    {
      id: "start", text: "روش روشن شدن؟", kind: "single", hardness: "soft", stage: "refine", attribute: "start",
      options: [{ id: "electric", label: "استارتی (کلیدی)", test: oneOf("start", ["electric", "remote"]) }, { id: "manual", label: "هندلی هم قبول است", test: () => MATCH_E }],
    },
    { id: "silent", text: "کم‌صدا (سایلنت) باشد؟", kind: "single", hardness: "soft", stage: "refine", attribute: "silent", options: [{ id: "yes", label: "بله", test: oneOf("silent", ["yes"]) }, ANY] },
  ],
};

// ======================= پاوربانک و شارژر همراه =======================
function capacityMah(p: ProductText): Attr<number> {
  const mah = /(\d{4,6})\s*(?:میلی ?آمپر|mah|میلی ?امپر)/;
  const thousand = /(\d{1,3})\s*هزار/;
  let spec: Attr<number> | null = null;
  for (const s of specsWhere(p, /ظرفیت/)) {
    const m = mah.exec(s.nvalue);
    if (m) { spec = { value: Number(m[1]), confidence: "explicit", evidence: [specEvidence(s)] }; break; }
    const rng = /(\d{1,3})\s*تا\s*(\d{1,3})\s*هزار/.exec(s.nvalue);
    if (rng) { spec = { value: Number(rng[2]) * 1000, confidence: "inferred", evidence: [specEvidence(s, "inferred")] }; break; }
    const k = thousand.exec(s.nvalue);
    if (k) { spec = { value: Number(k[1]) * 1000, confidence: "explicit", evidence: [specEvidence(s)] }; break; }
  }
  let title: Attr<number> | null = null;
  const t = mah.exec(p.ntitle);
  const k = thousand.exec(p.ntitle);
  if (t) title = { value: Number(t[1]), confidence: "explicit", evidence: [titleEvidence(t[0])] };
  else if (k) title = { value: Number(k[1]) * 1000, confidence: "explicit", evidence: [titleEvidence(k[0])] };
  if (!spec && !title) {
    const raw = /\b(\d{4,6})\b/.exec(p.ntitle);
    if (raw && Number(raw[1]) >= 2000 && Number(raw[1]) <= 100000) return { value: Number(raw[1]), confidence: "inferred", evidence: [titleEvidence(raw[0], "inferred")] };
  }
  return spec && spec.confidence === "inferred" && title ? title : reconcileNumeric(spec, title, "ظرفیت");
}
const powerbank: CategorySchema = {
  id: "powerbank",
  primary: (p) => !/^(کاور|کیف|قاب|کابل|پایه|محافظ|عنوان حذف)(?=\s|$)/.test(p.ntitle),
  category: "پاوربانک و شارژر همراه",
  label: "پاوربانک",
  attributeLabels: { capacity: "ظرفیت (میلی‌آمپرساعت)", fast: "شارژ سریع", ports: "تعداد درگاه خروجی" },
  limitations: ["ظرفیت اسمی با ظرفیت واقعی قابل‌استفاده فرق دارد؛ داده‌ای از آزمون واقعی موجود نیست.", "«شارژ سریع» فقط وقتی بله است که عنوان یا مشخصات صریحاً گفته باشند."],
  extract(p) {
    const fastRe = /(\bpd\b|\bqc\b|quick ?charge|fast ?charg\w*|فست ?شارژ|شارژ سریع|super ?charge|\b(?:18|20|22\.5|25|30|45|65|100)\s*(?:وات|w)\b)/;
    const fs = specsWhere(p, /شارژ|توان|فناوری|ویژگی|مشخصات فنی/).find((s) => fastRe.test(s.nvalue));
    const ft = fastRe.exec(p.ntitle);
    const fast: Attr<string> = fs ? { value: "yes", confidence: "explicit", evidence: [specEvidence(fs)] } : ft ? { value: "yes", confidence: "explicit", evidence: [titleEvidence(ft[0])] } : unknownAttr();
    const portSpec = specsWhere(p, /تعداد درگاه خروجی/)[0];
    const words: Record<string, number> = { یک: 1, دو: 2, سه: 3, چهار: 4 };
    let ports: Attr<number> = unknownAttr();
    if (portSpec) {
      const m = /(\d+)/.exec(portSpec.nvalue) ?? /(یک|دو|سه|چهار)/.exec(portSpec.nvalue);
      if (m) ports = { value: words[m[1]!] ?? Number(m[1]), confidence: "explicit", evidence: [specEvidence(portSpec)] };
    }
    return { capacity: capacityMah(p), fast, ports };
  },
  questions: [
    {
      id: "capacity", text: "چقدر شارژ نیاز دارید؟", help: "ظرفیت اسمی بر حسب میلی‌آمپرساعت.", kind: "single", hardness: "hard", stage: "initial", attribute: "capacity",
      options: [
        { id: "pocket", label: "کوچک و همراه (تا ۱۰ هزار)", test: (a) => (num(a.capacity) === null ? UNKNOWN : { effect: num(a.capacity)! <= 12000 ? "match" : "mismatch", confidence: conf(a.capacity) }) },
        { id: "daily", label: "روزانه برای گوشی (۱۰ هزار به بالا)", test: (a) => (num(a.capacity) === null ? UNKNOWN : { effect: num(a.capacity)! >= 10000 ? "match" : "mismatch", confidence: conf(a.capacity) }) },
        { id: "trip", label: "سفر یا چند دستگاه (۲۰ هزار به بالا)", test: (a) => (num(a.capacity) === null ? UNKNOWN : { effect: num(a.capacity)! >= 20000 ? "match" : "mismatch", confidence: conf(a.capacity) }) },
      ],
    },
    { id: "fast", text: "شارژ سریع مهم است؟", kind: "single", hardness: "soft", stage: "initial", attribute: "fast", options: [{ id: "yes", label: "بله", test: oneOf("fast", ["yes"], false) }, ANY] },
    {
      id: "ports", text: "چند دستگاه را هم‌زمان شارژ می‌کنید؟", kind: "single", hardness: "soft", stage: "refine", attribute: "ports",
      options: [{ id: "two", label: "دو دستگاه یا بیشتر", test: (a) => (num(a.ports) === null ? UNKNOWN : { effect: num(a.ports)! >= 2 ? "match" : "mismatch", confidence: "explicit" }) }, ANY],
    },
  ],
};

// ======================= پمپ خانگی و صنعتی =======================
function pumpHp(p: ProductText): Attr<number> {
  const re = /(\d+(?:[./]\d+)?)\s*(?:اسب|hp)/;
  let spec: Attr<number> | null = null;
  for (const s of specsWhere(p, /قدرت|توان/)) {
    const m = re.exec(s.nvalue);
    if (m) { spec = { value: parseDecimal(m[1]!) ?? 0, confidence: "explicit", evidence: [specEvidence(s)] }; break; }
  }
  const t = re.exec(p.ntitle);
  const title: Attr<number> | null = t ? { value: parseDecimal(t[1]!) ?? 0, confidence: "explicit", evidence: [titleEvidence(t[0])] } : null;
  return reconcileNumeric(spec, title, "توان");
}
const pump: CategorySchema = {
  id: "pump",
  primary: (p) => !/^(لوازم|قطعه|کیت|واشر|سیل|مکانیکال|پروانه|شفت|فیلتر|کاسه|درپوش|شیلنگ|اتصال|کنترلر|جک)(?=\s|$)/.test(p.ntitle),
  category: "پمپ خانگی و صنعتی",
  label: "پمپ آب",
  attributeLabels: { hp: "توان (اسب بخار)", voltage: "ولتاژ", type: "نوع پمپ" },
  limitations: ["توان به‌صورت «اسب» ثبت می‌شود و کسرهایی مثل ۱/۵ طبق عرف عنوان‌ها (۱٫۵) خوانده می‌شوند؛ این برداشت دقیق نیست.", "ارتفاع و آبدهی لازم به شرایط ساختمان بستگی دارد و در این مشاور سنجیده نمی‌شود."],
  extract(p) {
    return {
      hp: pumpHp(p),
      voltage: scan(p, /ولتاژ|فاز/, [[/(220|تک ?فاز)/, "220"], [/(380|سه ?فاز)/, "380"]], [[/(سه ?فاز|380)/, "380"], [/(تک ?فاز|220)/, "220"]]),
      type: scan(p, /نوع پمپ/, [[/(جتی|jet)/, "jet"], [/(بشقابی)/, "dish"], [/(محیطی|پریفرال)/, "peripheral"], [/(گریز از مرکز|سانتریفیوژ)/, "centrifugal"], [/(شناور|submersible)/, "submersible"]], [[/(جتی)/, "jet"], [/(بشقابی)/, "dish"], [/(شناور)/, "submersible"], [/(محیطی)/, "peripheral"]]),
    };
  },
  questions: [
    {
      id: "use", text: "پمپ را برای چه کاری می‌خواهید؟", help: "بازه‌ها تقریبی‌اند.", kind: "single", hardness: "hard", stage: "initial", attribute: "hp",
      options: [
        { id: "home", label: "آب‌رسانی خانه یا آپارتمان (تک‌فاز ۲۲۰ ولت)", test: (a) => { const v = list(a.voltage); if (v.includes("380") && !v.includes("220")) return { effect: "mismatch", confidence: "explicit" }; const h = num(a.hp); if (h === null) return v.includes("220") ? { effect: "match", confidence: "inferred" } : UNKNOWN; return { effect: h <= 2 ? "match" : "mismatch", confidence: conf(a.hp) }; } },
        { id: "garden", label: "باغ، حیاط یا کشاورزی کوچک (حدود ۱ تا ۳ اسب)", test: (a) => { const h = num(a.hp); return h === null ? UNKNOWN : { effect: h >= 1 && h <= 4 ? "match" : "mismatch", confidence: conf(a.hp) }; } },
        { id: "industrial", label: "صنعتی یا ساختمان بزرگ (۳ اسب به بالا یا سه‌فاز)", test: (a) => { const v = list(a.voltage); if (v.includes("380")) return { effect: "match", confidence: "explicit" }; const h = num(a.hp); return h === null ? UNKNOWN : { effect: h >= 3 ? "match" : "mismatch", confidence: conf(a.hp) }; } },
      ],
    },
    {
      id: "voltage", text: "برق در دسترس؟", kind: "single", hardness: "hard", stage: "refine", attribute: "voltage",
      options: [{ id: "220", label: "تک‌فاز ۲۲۰ ولت", test: oneOf("voltage", ["220"]) }, { id: "380", label: "سه‌فاز ۳۸۰ ولت", test: oneOf("voltage", ["380"]) }],
    },
    {
      id: "type", text: "نوع پمپ؟", kind: "single", hardness: "soft", stage: "refine", attribute: "type",
      options: [{ id: "jet", label: "جتی", test: oneOf("type", ["jet"]) }, { id: "dish", label: "بشقابی", test: oneOf("type", ["dish"]) }, { id: "peripheral", label: "محیطی", test: oneOf("type", ["peripheral"]) }],
    },
  ],
};

const VALUE_FA: Record<string, string> = {
  wireless: "بی‌سیم", wired: "با سیم", both: "هر دو", tws: "TWS (کاملاً بی‌سیم)", neckband: "گردنی", over_ear: "روی گوش", in_ear: "داخل گوش",
  gaming: "بازی", sport: "ورزش", calls: "مکالمه", general: "روزمره", yes: "دارد", no: "ندارد", outdoor: "بیرون ساختمان", indoor: "داخل ساختمان",
  ip: "تحت شبکه (IP)", analog: "آنالوگ", wifi: "بی‌سیم / وای‌فای", petrol: "بنزین", diesel: "گازوئیل", gas: "گاز", single: "تک‌فاز", three: "سه‌فاز",
  manual: "هندلی", electric: "استارتی", remote: "ریموت", "220": "۲۲۰ ولت", "380": "۳۸۰ ولت", jet: "جتی", dish: "بشقابی", peripheral: "محیطی", centrifugal: "گریز از مرکز",
};
const UNIT_FA: Record<string, string> = { resolution: "مگاپیکسل", power: "کیلووات", capacity: "میلی‌آمپرساعت", hp: "اسب بخار", ports: "عدد" };

/** Persian display text for an extracted attribute value (codes never reach the UI). */
export function formatAttrValue(attrId: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => VALUE_FA[String(v)] ?? String(v)).join("، ");
  if (typeof value === "number") return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(value)} ${UNIT_FA[attrId] ?? ""}`.trim();
  return VALUE_FA[String(value)] ?? String(value);
}

export const SCHEMAS: readonly CategorySchema[] = [headphones, cctv, generator, powerbank, pump];
export const schemaForCategory = (category: string): CategorySchema | undefined => SCHEMAS.find((s) => s.category === category);

export { buildProductText, lite, findSpec };
