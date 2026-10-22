import { EVIDENCE_RULES_VERSION, flagDef, isComparisonEligible, THRESHOLDS, type PriceStatus } from "@/domain/quality";

export type { PriceStatus };

/**
 * Honest price evidence for ONE product, computed only from comparable offers.
 * Never mixes units, never uses flagged outliers/duplicates/variant-mismatches, and refuses to show
 * a single range when the comparable offers disagree by more than THRESHOLDS.priceSpreadReliableMax.
 */

export interface OfferForEvidence {
  shopId: string;
  price: number | null;
  unitHint: string;
  /** quality flag codes of this offer */
  flags: readonly string[];
}

export interface PriceEvidence {
  status: PriceStatus;
  reliableCount: number;
  min: number | null;
  median: number | null;
  max: number | null;
  unitHint: string | null;
  spreadRatio: number | null;
  staleShare: number | null;
  totalOffers: number;
  pricedOffers: number;
  distinctSellers: number;
  /** priced offers left OUT of the range, by the flag that excluded them (an offer counts once per blocking flag) */
  excluded: Record<string, number>;
  rulesVersion: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

export function buildPriceEvidence(offers: readonly OfferForEvidence[]): PriceEvidence {
  const priced = offers.filter((o) => o.price !== null);
  const sellers = new Set(offers.map((o) => o.shopId));
  const excluded: Record<string, number> = {};
  const eligible: OfferForEvidence[] = [];
  for (const o of priced) {
    if (isComparisonEligible(o.flags)) {
      eligible.push(o);
      continue;
    }
    for (const f of o.flags) if (flagDef(f)?.blocksComparison) excluded[f] = (excluded[f] ?? 0) + 1;
  }
  const base = {
    totalOffers: offers.length, pricedOffers: priced.length, distinctSellers: sellers.size, excluded, rulesVersion: EVIDENCE_RULES_VERSION,
    reliableCount: eligible.length, min: null, median: null, max: null, unitHint: null, spreadRatio: null, staleShare: null,
  };
  if (priced.length === 0) return { ...base, status: "no_price" };
  if (eligible.length === 0) return { ...base, status: "no_eligible" };

  const prices = eligible.map((o) => o.price as number);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const hints = new Set(eligible.map((o) => o.unitHint));
  const stale = eligible.filter((o) => o.flags.includes("TIMESTAMP_STALE")).length / eligible.length;
  const filled = { ...base, min, median: median(prices), max, spreadRatio: +(max / min).toFixed(2), staleShare: +stale.toFixed(2) };

  if (hints.size > 1) return { ...filled, status: "mixed_units" };
  const unitHint = [...hints][0]!;
  if (eligible.length >= 2 && max / min > THRESHOLDS.priceSpreadReliableMax) return { ...filled, unitHint, status: "wide_spread" };
  return { ...filled, unitHint, status: "reliable" };
}

/** Persian one-line summary used by UI and tests (never invents a number). */
export function describePriceStatus(e: Pick<PriceEvidence, "status" | "spreadRatio">): string {
  switch (e.status) {
    case "reliable":
      return "قیمت قابل اتکا";
    case "wide_spread":
      return `قیمت قابل اتکا موجود نیست (پراکندگی ${e.spreadRatio}× بین پیشنهادها؛ نسخه یا واحد ممکن است متفاوت باشد)`;
    case "mixed_units":
      return "قیمت قابل اتکا موجود نیست (واحد قیمت پیشنهادها یکسان نیست)";
    case "no_eligible":
      return "قیمت قابل اتکا موجود نیست (پیشنهادهای قیمت‌دار قابل مقایسه نیستند)";
    default:
      return "قیمت قابل اتکا موجود نیست";
  }
}
