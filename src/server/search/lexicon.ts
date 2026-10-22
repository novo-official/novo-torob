/**
 * Hand-maintained Persian retrieval lexicon. Every entry is VALIDATED against the imported
 * vocabulary at query time (terms absent from the data are ignored) and by tests, so nothing here
 * can silently point at nothing. Entries are retrieval aids, not claims about products.
 */

/** Function words / shopping fillers that carry no product meaning. Compared after normalizeSearchText. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "و", "با", "از", "به", "در", "برای", "این", "آن", "که", "را", "یک", "یه", "تا", "هم", "یا", "بر", "اگر", "ولی", "اما", "هر", "همه",
  "من", "ما", "شما", "چه", "چی", "کدام", "کدوم", "بهتره", "بهتر", "است", "هست", "باشه", "باشد", "دارم", "میخوام", "می", "خوام", "خواهم", "میخواهم",
  "لطفا", "لطفاً", "مدل", "نوع", "خرید", "فروش", "قیمت", "بهترین", "مناسب", "کیفیت", "خوب", "نیاز", "نیازه", "دارد", "دارید",
  "میشه", "میشود", "کنم", "کنید", "مثل", "مثلا", "حدود", "حدودا", "سری", "جدید", "اصل", "اصلی", "اورجینال",
]);

/** Words expressing a preference rather than a product; surfaced to the advisor, not used for retrieval. */
export const PREFERENCE_WORDS: Readonly<Record<string, "cheap" | "premium">> = {
  ارزان: "cheap", ارزانترین: "cheap", ارزون: "cheap", اقتصادی: "cheap", "کم هزینه": "cheap",
  گرانترین: "premium", حرفه‌ای: "premium", حرفه: "premium", لوکس: "premium",
};

/**
 * Synonym groups. A term may be several words (a phrase). At query time a group is kept only
 * through the terms that actually exist in the FTS vocabulary.
 */
export const SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
  ["هندزفری", "هدفون", "هدست", "ایرفون", "ایربادز", "earbuds", "earphone", "headphone", "headset"],
  ["پاوربانک", "پاور بانک", "شارژر همراه", "powerbank"],
  ["موتور برق", "ژنراتور", "generator"],
  ["دوربین مداربسته", "دوربین مدار بسته", "دوربین امنیتی", "دوربین نظارتی", "cctv"],
  ["ساعت هوشمند", "اسمارت واچ", "smartwatch", "smart watch"],
  ["لپ تاپ", "لپتاپ", "نوت بوک", "نوتبوک", "laptop"],
  ["تلویزیون", "تی وی", "tv"],
  ["پمپ آب", "واترپمپ", "water pump"],
  ["داهوا", "dahua"],
  ["هایک ویژن", "hikvision", "hik vision", "هایکویژن"],
  ["سامسونگ", "samsung"],
  ["شیائومی", "xiaomi"],
  ["اپل", "apple"],
  ["انکر", "anker"],
  ["اشنایدر", "schneider"],
  ["زیمنس", "siemens"],
  ["پاناسونیک", "panasonic"],
];

/**
 * Query phrases that point to a catalog category (category_name as stored). Used to bias category
 * detection; each target is verified to exist by tests.
 */
export const CATEGORY_HINTS: ReadonlyArray<{ phrases: readonly string[]; category: string }> = [
  { phrases: ["دوربین مداربسته", "دوربین مدار بسته", "دوربین امنیتی", "دوربین نظارتی", "cctv"], category: "دوربین مدار بسته" },
  { phrases: ["هندزفری", "هدفون", "هدست", "ایرفون", "ایربادز", "earbuds", "headphone"], category: "هدفون، هدست و هندزفری" },
  { phrases: ["موتور برق", "ژنراتور", "generator"], category: "ژنراتور و موتور برق" },
  { phrases: ["پاوربانک", "پاور بانک", "شارژر همراه", "powerbank"], category: "پاوربانک و شارژر همراه" },
  { phrases: ["پمپ آب", "پمپ", "واترپمپ"], category: "پمپ خانگی و صنعتی" },
];

/** Spacing variants that real titles use interchangeably (single token ⇄ two tokens). */
export const SPLIT_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  ["مداربسته", "مدار بسته"],
  ["پاوربانک", "پاور بانک"],
  ["هندزفری", "هندز فری"],
  ["اسپیکر", "اس پیکر"],
  ["لپتاپ", "لپ تاپ"],
  ["پیشگیر", "پیش گیر"],
  ["جاروبرقی", "جارو برقی"],
  ["تلفنهمراه", "تلفن همراه"],
];
