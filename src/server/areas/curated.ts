import type { ShoppingArea } from "@/domain/shopping-area";
import { buildRegistry } from "./validate";

/**
 * SMALL curated registry. Every entry was checked on 2026-10-22 against the public pages cited below
 * (specialisation claim) and against OpenStreetMap / Wikipedia data (coordinates). Anything that could not be
 * verified with BOTH a claim source and a coordinate source was NOT added (see docs/phase-4-sellers.md §Rejected).
 *
 * `categoryTags` map the sources' wording to dataset category names — that mapping is the SYSTEM'S inference,
 * which is why the UI shows it under "برداشت سیستم", separate from the quoted evidence.
 *
 * Broader "bourse knowledge" beyond these entries is a PHASE 7 TODO — not a catalogue we pretend to have.
 */
const VERIFIED = "2026-10-22";
const DISCLAIMER = "این یک سرنخ جغرافیایی برای گشتن است، نه پیشنهاد فروش، موجودی لحظه‌ای یا تأیید داشتن یک کالا در فروشگاه مشخص. پیش از رفتن موجودی را از فروشنده بپرسید.";

const ELECTRICAL_LIGHTING = [
  "لوستر و چراغ تزئینی", "چراغ پنلی و سقفی", "لامپ LED و کم مصرف", "سایر لامپ و چراغ", "چراغ خطی و زیر کابینتی",
  "چراغ دیواری", "چراغ حیاطی و پارکی", "ریسه و شلنگ نوری", "کلید و پریز", "سیم و کابل برق ساختمان", "سوکت و کانکتور", "کلید و فیوز مینیاتوری",
];
const MOBILE = ["گوشی موبایل", "پاوربانک و شارژر همراه", "هدفون، هدست و هندزفری", "کیف و کاور گوشی", "شارژر گوشی", "محافظ صفحه نمایش گوشی", "تاچ و ال سی دی گوشی و تبلت"];
const GENERATORS_PUMPS = ["ژنراتور و موتور برق", "پمپ خانگی و صنعتی"];

export const CURATED_AREAS: ShoppingArea[] = [
  {
    id: "curated-lalehzar-street",
    nameFa: "خیابان لاله‌زار — بورس لوازم برقی و روشنایی",
    kind: "street",
    center: { lat: 35.689056, lon: 51.42255 },
    coordinateBasisFa: "مختصات نقطه‌ی خیابان در جعبه‌ی اطلاعات ویکی‌پدیای فارسی (۳۵°۴۱′۲۰٫۶″ شمالی، ۵۱°۲۵′۲۱٫۱۸″ شرقی)؛ خیابان امتداد دارد و این فقط یک نقطه روی آن است. راه‌های OSM همین خیابان در همین محدوده (تا عرض ۳۵٫۶۹۹) هم دیده می‌شوند.",
    areaLabelFa: "خیابان لاله‌زار، از میدان امام خمینی (توپخانه) تا خیابان انقلاب اسلامی",
    categoryTags: ELECTRICAL_LIGHTING,
    recommendationReasonFa: "دو منبع مستقل لاله‌زار را محل تمرکز فروشندگان لوازم برقی و چراغ/لوستر می‌دانند.",
    sourceType: "curated_external",
    sources: [
      { supports: "claim", title: "خیابان لاله‌زار", publisher: "ویکی‌پدیای فارسی", url: "https://fa.wikipedia.org/wiki/%D8%AE%DB%8C%D8%A7%D8%A8%D8%A7%D9%86_%D9%84%D8%A7%D9%84%D9%87%E2%80%8C%D8%B2%D8%A7%D8%B1", quote: "امروزه بیشتر لاله‌زار را صنف فروشندگان لوازم برقی در اختیار گرفته‌اند." },
      { supports: "claim", title: "گزارش همشهری آنلاین درباره‌ی بازارهای روشنایی تهران", publisher: "همشهری آنلاین", url: "https://www.hamshahrionline.ir/news/970682", publishedAt: "2025-08-15", quote: "حالا دیگر سال‌هاست لاله‌زار به بورس انواع چراغ و لوستر تبدیل شده است." },
      { supports: "coordinates", title: "صفحه‌ی خیابان لاله‌زار (جعبه‌ی اطلاعات)", publisher: "ویکی‌پدیای فارسی", url: "https://fa.wikipedia.org/wiki/%D8%AE%DB%8C%D8%A7%D8%A8%D8%A7%D9%86_%D9%84%D8%A7%D9%84%D9%87%E2%80%8C%D8%B2%D8%A7%D8%B1", quote: "۳۵°۴۱′۲۰٫۶″N ۵۱°۲۵′۲۱٫۱۸″E" },
      { supports: "coordinates", title: "راه‌های OSM «لاله‌زار شمالی» (way 763310237 و 1036212926)", publisher: "OpenStreetMap contributors (ODbL)", url: "https://www.openstreetmap.org/way/763310237" },
    ],
    verifiedAt: VERIFIED,
    confidence: "high",
    disclaimerFa: DISCLAIMER,
  },
  {
    id: "curated-aladdin-passage",
    nameFa: "پاساژ علاءالدین — بورس موبایل و لوازم جانبی (نبش پل حافظ)",
    kind: "mall",
    center: { lat: 35.695148, lon: 51.411819 },
    coordinateBasisFa: "میانگین ۴ گره‌ی OSM تقاطع خیابان‌های حافظ و جمهوری (۱۴۱۰۱۴۶۰۸۲، ۱۴۱۰۱۴۶۰۸۷، ۳۴۸۲۷۲۶۵۲۰، ۳۴۸۲۷۲۶۵۲۱). منابع محل پاساژ را «نبش پل حافظ / تقاطع حافظ و جمهوری» می‌گویند؛ این نقطه‌ی ساختمان نیست. خوشه‌ی فروشگاه‌های «پاساژ علاالدین» در داده‌ی ما هم در حدود ۳۴ تا ۵۴ متری همین گره‌ها قرار دارد.",
    areaLabelFa: "خیابان جمهوری، نبش پل حافظ (تقاطع حافظ و جمهوری)",
    categoryTags: MOBILE,
    recommendationReasonFa: "دو منبع این پاساژ را «بورس موبایل» تهران و محل عرضه‌ی گوشی، تبلت و لوازم جانبی می‌دانند.",
    sourceType: "curated_external",
    sources: [
      { supports: "claim", title: "پاساژ علاالدین", publisher: "مجله‌ی علی‌بابا", url: "https://www.alibaba.ir/mag/aladdin-market/", quote: "پاساژ علاالدین در خیابان جمهوری نبش پل حافظ … واقع شده است." },
      { supports: "claim", title: "پاساژ علاالدین", publisher: "کجارو", url: "https://www.kojaro.com/attraction/8953-%D9%BE%D8%A7%D8%B3%D8%A7%DA%98-%D8%B9%D9%84%D8%A7%D8%A7%D9%84%D8%AF%DB%8C%D9%86/", publishedAt: "2017-06-24", quote: "هر نوع گوشی، تبلت و لوازم جانبی در این پاساژ عرضه می‌شود." },
      { supports: "coordinates", title: "گره‌های OSM تقاطع حافظ و جمهوری (Overpass)", publisher: "OpenStreetMap contributors (ODbL)", url: "https://www.openstreetmap.org/node/1410146082" },
    ],
    verifiedAt: VERIFIED,
    confidence: "medium",
    disclaimerFa: `${DISCLAIMER} منابع توصیفی این مورد قدیمی یا بدون تاریخ‌اند.`,
  },
  {
    id: "curated-saadi-south-street",
    nameFa: "خیابان سعدی جنوبی — ژنراتور و پمپ آب",
    kind: "street",
    center: { lat: 35.6917471, lon: 51.4242755 },
    coordinateBasisFa: "نقطه‌ی مرکزی راه OSM «سعدی جنوبی» (way 364251679، منطقه‌ی ۱۲ تهران)؛ خیابان امتداد دارد و این فقط یک نقطه روی آن است.",
    areaLabelFa: "خیابان سعدی جنوبی (پس از تقاطع جمهوری)",
    categoryTags: GENERATORS_PUMPS,
    recommendationReasonFa: "یک گزارش خبری (تنها منبع توصیفی) سعدی را مرکز فروش ژنراتور و سعدی جنوبی را محل بازار پمپ آب و دیزل‌ژنراتور می‌داند.",
    sourceType: "curated_external",
    sources: [
      { supports: "claim", title: "مرکز فروش ژنراتور برق در تهران", publisher: "آفتاب‌نیوز", url: "https://aftabnews.ir/fa/news/1037731/%D9%85%D8%B1%DA%A9%D8%B2-%D9%81%D8%B1%D9%88%D8%B4-%DA%98%D9%86%D8%B1%D8%A7%D8%AA%D9%88%D8%B1-%D8%A8%D8%B1%D9%82-%D8%AF%D8%B1-%D8%AA%D9%87%D8%B1%D8%A7%D9%86", publishedAt: "2026-02-11", quote: "مرکز فروش ژنراتور برق در تهران خیابان سعدی است." },
      { supports: "coordinates", title: "راه OSM «سعدی جنوبی» (way 364251679)", publisher: "OpenStreetMap contributors (ODbL)", url: "https://www.openstreetmap.org/way/364251679" },
    ],
    verifiedAt: VERIFIED,
    confidence: "medium",
    disclaimerFa: `${DISCLAIMER} فقط یک منبع توصیفی دارد.`,
  },
];

const built = buildRegistry(CURATED_AREAS);
export const CURATED_REGISTRY = built.valid;
export const CURATED_REJECTED = built.rejected;
