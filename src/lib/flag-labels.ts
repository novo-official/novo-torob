/** Short Persian badge text for quality flags (the long reason is shown as a tooltip / in details). */
export const FLAG_SHORT: Record<string, { text: string; tone: "warn" | "neutral" | "danger" }> = {
  NULL_PRICE: { text: "بدون قیمت", tone: "neutral" },
  PRICE_MALFORMED: { text: "قیمت نامعتبر", tone: "danger" },
  NONPOSITIVE_PRICE: { text: "قیمت نامعتبر", tone: "danger" },
  PRICE_ABSURD_MAGNITUDE: { text: "قیمت نامعقول", tone: "danger" },
  PRICE_PEER_OUTLIER_HIGH: { text: "بسیار گران‌تر از همتایان", tone: "warn" },
  PRICE_PEER_OUTLIER_LOW: { text: "بسیار ارزان‌تر از همتایان", tone: "warn" },
  PRICE_CATEGORY_OUTLIER_HIGH: { text: "قیمت پرت (نسبت به دسته)", tone: "warn" },
  PRICE_CATEGORY_OUTLIER_LOW: { text: "قیمت پرت (نسبت به دسته)", tone: "warn" },
  TIMESTAMP_STALE: { text: "قیمت قدیمی", tone: "warn" },
  TIMESTAMP_MISSING: { text: "زمان قیمت نامشخص", tone: "warn" },
  VARIANT_MODEL_MISMATCH: { text: "کد مدل شبیه ولی متفاوت", tone: "warn" },
  VARIANT_MODEL_UNCONFIRMED: { text: "مدل تأییدنشده", tone: "neutral" },
  UNIT_AMBIGUOUS: { text: "واحد قیمت نامشخص", tone: "warn" },
  EXACT_DUPLICATE_OFFER: { text: "پیشنهاد تکراری", tone: "neutral" },
};
