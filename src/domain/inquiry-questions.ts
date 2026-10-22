import { formatToman, toFaDigits } from "@/lib/format";
import type { CategoryProfileId, InquiryContext, InquiryQuestion } from "./inquiry";
import { LIMITS, sanitizeText } from "./inquiry-parse";

/** Category → profile. Only categories we actually have advisor/catalog evidence for; everything else is "generic" (no invented questions). */
export function categoryProfile(categoryName: string): CategoryProfileId {
  const c = categoryName.normalize("NFKC");
  if (/دوربین\s*مدار\s*بسته|دوربین\s*(امنیتی|مداربسته)/u.test(c)) return "cctv";
  if (/هدفون|هدست|هندزفری|ایرپاد|ایرباد/u.test(c)) return "headphones";
  if (/ژنراتور|موتور\s*برق/u.test(c)) return "generator";
  if (/پاوربانک|شارژر\s*همراه/u.test(c)) return "powerbank";
  if (/پمپ/u.test(c)) return "pump";
  if (/کابل|سیم(?!\s*کارت)/u.test(c)) return "cable";
  if (/کفش|نعلین|بوت|صندل/u.test(c)) return "footwear";
  return "generic";
}

const CATEGORY_QUESTIONS: Record<Exclude<CategoryProfileId, "generic">, Array<{ id: string; textFa: string; reasonFa: string; defaultOn: boolean }>> = {
  cctv: [
    { id: "cat_night", textFa: "دید در شب این مدل چگونه است (مادون قرمز یا رنگی) و تا چه فاصله‌ای؟", reasonFa: "مهم‌ترین تفاوت عملی دوربین‌های مدار بسته", defaultOn: true },
    { id: "cat_install", textFa: "نصب یا راهنمای نصب دارید؟ هزینه‌اش جداست؟ آداپتور/پایه همراه کالاست؟", reasonFa: "نصب و لوازم جانبی", defaultOn: false },
  ],
  headphones: [
    { id: "cat_battery", textFa: "نوع اتصال (بی‌سیم یا با سیم) و عمر باتری واقعی با یک بار شارژ چقدر است؟", reasonFa: "عمر باتری و اتصال در انتخاب هدفون تعیین‌کننده است", defaultOn: true },
    { id: "cat_box", textFa: "قاب شارژ، کابل و لوازم همراه داخل جعبه هست؟", reasonFa: "ست کامل", defaultOn: false },
  ],
  generator: [
    { id: "cat_power", textFa: "توان واقعی (کیلووات) و نوع سوخت (بنزین، گاز، دوگانه) این مدل چیست؟", reasonFa: "توان و سوخت مشخص‌کننده‌ی کاربرد", defaultOn: true },
    { id: "cat_start", textFa: "راه‌اندازی اولیه و گارانتی موتور/دینام را چه کسی انجام می‌دهد؟", reasonFa: "خدمات پس از فروش", defaultOn: false },
  ],
  cable: [
    { id: "cat_unit", textFa: "قیمت اعلام‌شده برای هر متر است یا کل حلقه/کلاف؟ حلقه چند متر است؟", reasonFa: "واحد قیمت کابل متفاوت است و قابل مقایسه نیست", defaultOn: true },
    { id: "cat_spec", textFa: "سطح مقطع و تعداد رشته‌ی دقیق همین کالا چیست؟", reasonFa: "مشخصه‌ی فنی کابل", defaultOn: false },
  ],
  footwear: [
    { id: "cat_size", textFa: "چه سایزهایی موجود است؟ امکان تعویض سایز بعد از خرید هست؟", reasonFa: "سایز", defaultOn: true },
    { id: "cat_color", textFa: "رنگ‌های موجود کدام‌اند؟", reasonFa: "رنگ", defaultOn: false },
  ],
  powerbank: [
    { id: "cat_capacity", textFa: "ظرفیت واقعی و اصالت کالا چگونه قابل بررسی است؟", reasonFa: "ظرفیت اعلامی پاوربانک اغلب با واقعی فرق دارد", defaultOn: true },
    { id: "cat_ports", textFa: "خروجی‌ها و توان شارژ سریع این مدل چیست؟", reasonFa: "خروجی‌ها", defaultOn: false },
  ],
  pump: [
    { id: "cat_spec", textFa: "قدرت (اسب بخار)، بیشینه ارتفاع و دبی این مدل چقدر است؟", reasonFa: "مشخصات فنی پمپ", defaultOn: true },
    { id: "cat_service", textFa: "نصب و خدمات پس از فروش دارید؟", reasonFa: "خدمات پس از فروش", defaultOn: false },
  ],
};

const fa = toFaDigits;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Smart defaults from the REAL offer context — only ask what the data does not already settle:
 *  - exact-model question is ON unless the title carries the exact model key (tier A);
 *  - price question always ON (a recorded price is never today's price), worded with the recorded value/date;
 *  - warranty/payment/hours/location questions are ON only when that fact is unknown/doubtful;
 *  - category questions only for categories we know (first one ON).
 */
export function buildQuestions(ctx: InquiryContext): InquiryQuestion[] {
  const out: InquiryQuestion[] = [];
  const o = ctx.offer;
  const model = ctx.variant.modelKey;

  out.push({
    id: "q_variant", intent: "exact_variant", defaultOn: o.tier !== "A" || ctx.variant.needsConfirmation || o.outsideSelectedVariant,
    textFa: `آیا دقیقاً همین مدل/نسخه — «${clip(o.sellerTitle, 110)}»${model ? ` (کد مدل ${model})` : ""} — را دارید؟ مدل مشابه یا جایگزین مدنظر نیست.${o.packQuantity ? ` (تعداد در بسته: ${fa(o.packQuantity)})` : ""}`,
    reasonFa: o.tier === "A" ? "کد مدل در عنوان آمده؛ فقط اگر می‌خواهید دوباره تأیید شود." : o.outsideSelectedVariant ? "این پیشنهاد خارج از نسخه‌ی انتخابی شماست." : "هویت نسخه فقط از روی عنوان فروشنده حدس زده شده.",
  });
  const visitTxt = ctx.visit.input ? ` (برنامه‌ی من: ${fa(ctx.visit.input.replace("T", " ساعت "))})` : "";
  out.push({
    id: "q_stock", intent: "stock_availability", defaultOn: true,
    textFa: `آیا همین کالا همین حالا موجود است و تا زمان رسیدن من${visitTxt} برایم نگه می‌دارید؟`,
    reasonFa: "وجود پیشنهاد در داده به معنی موجودی نیست.",
  });
  out.push({
    id: "q_price", intent: "fresh_price", defaultOn: true,
    textFa: o.priceToman !== null
      ? `قیمت ثبت‌شده برای این کالا ${formatToman(o.priceToman)} بوده${o.recordedAtLabel ? ` (${o.recordedAtLabel})` : ""}؛ قیمت نهایی امروز چقدر است، به چه واحدی (تکی/متر/بسته) و تخفیف یا شرط خاصی دارد؟`
      : "قیمتی برای این کالا ثبت نشده؛ قیمت نهایی امروز چقدر است و به چه واحدی (تکی/متر/بسته)؟",
    reasonFa: o.priceToman === null ? "قیمتی ثبت نشده است." : "قیمت ثبت‌شده قیمت امروز نیست.",
  });
  const w = o.warranty.kind;
  out.push({
    id: "q_warranty", intent: "warranty", defaultOn: w === "UNKNOWN" || w === "NONE_DECLARED" || w === "TEST_AT_DELIVERY",
    textFa: "گارانتی این کالا چند ماه و از طرف کدام شرکت یا فروشگاه است؟",
    reasonFa: w === "MONTHS" ? `ثبت‌شده: ${o.warranty.labelFa}؛ فقط برای تأیید.` : w === "UNKNOWN" ? "گارانتی ثبت نشده (نبودنش نیست)." : "گارانتی روشن نیست.",
  });
  out.push({
    id: "q_install", intent: "installments", defaultOn: ctx.payment.bucket !== "IN_PERSON_DECLARED",
    textFa: "برای همین کالا پرداخت حضوری با کارت یا خرید اقساطی امکان‌پذیر است؟ شرایطش چیست؟",
    reasonFa: ctx.payment.bucket === "IN_PERSON_DECLARED" ? `پرداخت حضوری اعلام‌شده (${ctx.payment.labelFa}) — برای خود این کالا فقط در صورت نیاز.` : "پرداخت حضوری اعلام نشده یا کانالش نامعلوم است.",
  });
  out.push({
    id: "q_hours", intent: "hours", defaultOn: ctx.hours.state !== "WITHIN_DECLARED",
    textFa: `در زمان مراجعه‌ی من${ctx.visit.input ? "" : " (امروز)"} تا چه ساعتی باز هستید؟`,
    reasonFa: ctx.hours.state === "UNKNOWN" ? "ساعت کاری اعلام نشده." : ctx.hours.state === "OUTSIDE_DECLARED" ? "زمان بازدید خارج از ساعت اعلام‌شده است." : "داخل ساعت اعلام‌شده؛ فقط برای تأیید.",
  });
  const mall = ctx.shop.sharedCoordinates > 0 || /پاساژ|طبقه|مجتمع|بازار/u.test(ctx.shop.address ?? "");
  out.push({
    id: "q_locate", intent: "locate_in_mall", defaultOn: mall,
    textFa: "نشانی دقیق واحد (پاساژ، طبقه، شماره‌ی مغازه) را بفرمایید.",
    reasonFa: mall ? "مختصات در سطح پاساژ است و واحد دقیق معلوم نیست." : "نشانی ثبت‌شده کافی به نظر می‌رسد.",
  });
  const cp = ctx.category;
  if (cp !== "generic") for (const q of CATEGORY_QUESTIONS[cp]) out.push({ ...q, intent: "category" });
  return out;
}

export const defaultQuestionIds = (qs: InquiryQuestion[]): string[] => qs.filter((q) => q.defaultOn).map((q) => q.id);

/** Deterministic Persian message. Contains NO phone number, no coordinates, no claim that anything was sent. */
export function composeInquiry(ctx: InquiryContext, questions: Array<Pick<InquiryQuestion, "textFa">>): string {
  const o = ctx.offer;
  const variant = ctx.variant.label ? ` (${clip(ctx.variant.label, 80)})` : "";
  const lines: string[] = ["سلام، وقت بخیر.", `درباره‌ی «${clip(ctx.product.title, 120)}»${variant} سؤال دارم.`];
  lines.push(`پیشنهاد شما در سایت: «${clip(o.sellerTitle, 140)}»${o.priceToman !== null ? ` — قیمت ثبت‌شده ${formatToman(o.priceToman)}${o.recordedAtLabel ? ` (${o.recordedAtLabel})` : ""}` : ""}.`);
  if (questions.length) {
    lines.push("لطفاً بفرمایید:");
    questions.forEach((q, i) => lines.push(`${fa(i + 1)}. ${sanitizeText(q.textFa, 400)}`));
  }
  lines.push("ممنون از وقتی که می‌گذارید.");
  return sanitizeText(lines.join("\n"), LIMITS.draft);
}

/** Short second message when nobody answered. Still just text for the USER to send. */
export function composeFollowUp(ctx: InquiryContext): string {
  return sanitizeText([
    "سلام، وقت بخیر؛ دوباره مزاحم می‌شوم.",
    `درباره‌ی «${clip(ctx.offer.sellerTitle, 120)}» قبلاً پرسیده بودم. اگر فرصت دارید فقط این دو مورد را بفرمایید:`,
    "۱. همین کالا الان موجود است؟",
    "۲. قیمت نهایی امروز چقدر است؟",
    "ممنون.",
  ].join("\n"), LIMITS.draft);
}

/** Reconfirmation text before travelling (a reported «available» is only the seller's claim and can change). */
export function composeReconfirm(ctx: InquiryContext): string {
  return sanitizeText([
    "سلام، وقت بخیر.",
    `پیش‌تر درباره‌ی «${clip(ctx.offer.sellerTitle, 120)}» صحبت کردیم و گفتید موجود است.${ctx.visit.input ? ` می‌خواهم ${fa(ctx.visit.input.replace("T", " ساعت "))} بیایم.` : " می‌خواهم امروز بیایم."}`,
    "لطفاً همین الان دوباره تأیید کنید که کالا موجود است و قیمت همان است که فرمودید؟",
    "ممنون.",
  ].join("\n"), LIMITS.draft);
}
