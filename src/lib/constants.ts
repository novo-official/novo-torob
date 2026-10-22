/** Neighbourhood labels that dominate the dataset (Phase 0 audit). Used as manual area choices. */
export const AREAS = [
  { id: "ferdowsi", label: "فردوسی" },
  { id: "sheikh-hadi", label: "شیخ‌هادی" },
  { id: "baharestan", label: "بهارستان" },
  { id: "other", label: "جای دیگری از تهران" },
] as const;

export const USE_CASES = [
  { id: "business", label: "کار و کسب‌وکار" },
  { id: "home", label: "مصرف خانگی" },
  { id: "project", label: "پروژه‌ی نصب/ساختمانی" },
  { id: "gift", label: "هدیه" },
  { id: "replace", label: "تعویض یا تعمیر" },
] as const;

export const PRIORITIES = [
  { id: "price", label: "کمترین قیمت" },
  { id: "warranty", label: "گارانتی" },
  { id: "near", label: "نزدیکی به من" },
  { id: "quality", label: "مشخصات فنی بهتر" },
  { id: "payment", label: "امکان پرداخت اعتباری" },
] as const;

export const QUICK_STARTS = [
  { label: "دوربین مداربسته", q: "دوربین مداربسته" },
  { label: "هدفون بی‌سیم", q: "هدفون بی‌سیم" },
  { label: "پاوربانک", q: "پاوربانک" },
  { label: "موتور برق", q: "موتور برق" },
] as const;

export const STAGES = [
  { id: "M1", title: "انتخاب محصول", desc: "ندانید چه بخرید؟ با چند سؤال کوتاه کاندیدها را مقایسه می‌کنیم.", href: "/discover", icon: "compass" },
  { id: "M2", title: "فروشنده‌های نزدیک", desc: "فقط پیشنهادهای واقعاً منطبق، بر اساس منطقه‌ی شما.", href: "/search", icon: "store" },
  { id: "M3", title: "مقایسه‌ی فروشنده‌ها", desc: "قیمت ثبت‌شده، فاصله، ساعت اعلام‌شده و شرایط خرید.", href: "/compare", icon: "scale" },
  { id: "M4", title: "پرسش از فروشنده", desc: "پیش‌نویس سؤال، ثبت پاسخ و پیگیری تا زمان مراجعه.", href: "/missions", icon: "message" },
] as const;
