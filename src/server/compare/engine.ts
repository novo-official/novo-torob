import type { VariantGroup } from "@/domain/advisor";
import {
  COMPARISON_VERSION, DEFAULT_PRIORITY_ORDER, PRIORITY_FA, REASON_META, TIER_META,
  type BudgetStatus, type ComparableOfferIdentity, type ComparisonCandidate, type ComparisonCriteria, type ComparisonSituation, type ComparisonTier, type HoursAtVisit,
  type PaymentView, type PriceCaution, type PriceComparability, type PriceEvidenceView, type PriceVerdict, type RankingPriority, type RankingReason, type RankingReasonCode,
  type SellerComparisonResponse, type SellerComparisonResult, type WarrantyView,
} from "@/domain/comparison";
import type { DeclaredHours } from "@/domain/types";
import { flagDef, THRESHOLDS } from "@/domain/quality";
import { formatToman, toFaDigits } from "@/lib/format";
import { haversineMeters, isValidCoordinate } from "@/lib/geo";
import { evaluateHours } from "@/server/domain/hours";
import { classifyIdentity, extractPackQuantity, toIdentity, type EngineOffer } from "./identity";
import { ageDays, tehranDate } from "./time";

export interface EngineSeller {
  shopId: string;
  name: string;
  locationLabel: string | null;
  lat: number | null;
  lon: number | null;
  hours: DeclaredHours;
  payment: Array<{ providerName: string; channel: "in_person" | "online" | "unknown" }>;
  offers: EngineOffer[];
}

export interface EngineInput {
  product: { id: string; title: string; categoryName: string } | null;
  groups: VariantGroup[];
  selected: VariantGroup | null;
  needsConfirmation: boolean;
  sellers: EngineSeller[];
  /** comparison-eligible prices of the selected variant over ALL shops (used only to flag unusual records) */
  peerPrices: number[];
  snapshotRef: string | null;
  now: Date;
  visitAt: Date;
  visitIsNow: boolean;
  origin: ComparisonCriteria["origin"];
  radiusMeters: number;
  budget: { min: number | null; max: number | null };
  strictBudget: boolean;
  priority: RankingPriority;
  requestedShopIds: string[];
  candidates: ComparisonCandidate[];
  notices: string[];
}

/** Heuristic, documented: ≥5 trusted peers needed; a record this far from their median is set aside, not silently deleted. */
export const UNUSUAL = { minPeers: 5, belowRatio: 0.7, aboveRatio: 1.8, /** a winner this much cheaper than the runner-up is not declared unconditionally */ largeMargin: 0.3 } as const;
const BLOCKING_PRICE_FLAGS = (f: string) => !!flagDef(f)?.blocksComparison && f !== "VARIANT_MODEL_MISMATCH" && f !== "UNIT_AMBIGUOUS";
const TIMESTAMP_BAD = new Set(["TIMESTAMP_MISSING", "TIMESTAMP_MALFORMED", "TIMESTAMP_FUTURE"]);
const COMP_RANK: Record<PriceComparability, number> = { TRUSTED: 0, CAUTION: 1, STALE: 2, NO_TIMESTAMP: 3, OUTLIER_OR_INVALID: 4, NO_PRICE: 5, IDENTITY_BLOCKED: 6 };
const TIER_RANK: Record<ComparisonTier, number> = { A: 0, B: 1, C: 2, D: 3 };
const fa = toFaDigits;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ---------- price ----------
export function evaluatePrice(offer: EngineOffer | null, tier: ComparisonTier, ctx: { peerPrices: number[]; snapshotRef: string | null; now: Date }): PriceEvidenceView {
  if (!offer) {
    return { offerId: null, priceToman: null, priceRaw: null, priceUnsafe: false, recordedAt: null, recordedAtKnown: false, ageDaysToday: null, ageDaysAtSnapshot: null, staleBySnapshotRule: false, comparability: tier === "A" || tier === "B" ? "NO_PRICE" : "IDENTITY_BLOCKED", cautions: [], flags: [], ratioToPeerMedian: null };
  }
  const flags = offer.flags.filter((f) => !!flagDef(f));
  const priceUnsafe =
    offer.priceOutOfRange || (offer.priceToman !== null && (!Number.isSafeInteger(offer.priceToman) || offer.priceToman <= 0)) ||
    flags.some((f) => f === "PRICE_ABSURD_MAGNITUDE" || f === "PRICE_MALFORMED" || f === "NONPOSITIVE_PRICE");
  const price = priceUnsafe ? null : offer.priceToman;
  const recordedAtKnown = !!offer.priceChangedAt && Number.isFinite(Date.parse(offer.priceChangedAt)) && !flags.some((f) => TIMESTAMP_BAD.has(f));
  const age = recordedAtKnown ? ageDays(offer.priceChangedAt, ctx.now) : null;
  const snap = ctx.snapshotRef ? new Date(ctx.snapshotRef) : null;
  const ageAtSnapshot = recordedAtKnown && snap && Number.isFinite(snap.getTime()) ? ageDays(offer.priceChangedAt, snap) : null;
  const stale = flags.includes("TIMESTAMP_STALE");
  const med = price !== null && ctx.peerPrices.length >= UNUSUAL.minPeers ? median(ctx.peerPrices) : null;
  const ratio = med && price !== null ? price / med : null;
  const cautions: PriceCaution[] = [];
  if (ratio !== null && ratio <= UNUSUAL.belowRatio) cautions.push("FAR_BELOW_PEERS");
  if (ratio !== null && ratio >= UNUSUAL.aboveRatio) cautions.push("FAR_ABOVE_PEERS");

  let comparability: PriceComparability;
  if (tier === "C" || tier === "D") comparability = "IDENTITY_BLOCKED";
  else if (offer.priceToman === null && !offer.priceOutOfRange && !priceUnsafe) comparability = "NO_PRICE";
  else if (priceUnsafe || flags.some(BLOCKING_PRICE_FLAGS)) comparability = "OUTLIER_OR_INVALID";
  else if (!recordedAtKnown) comparability = "NO_TIMESTAMP";
  else if (stale) comparability = "STALE";
  else if (cautions.includes("FAR_BELOW_PEERS")) comparability = "CAUTION";
  else comparability = "TRUSTED";

  return {
    offerId: offer.offerId, priceToman: price, priceRaw: offer.priceRaw, priceUnsafe, recordedAt: offer.priceChangedAt, recordedAtKnown, ageDaysToday: age, ageDaysAtSnapshot: ageAtSnapshot,
    staleBySnapshotRule: stale, comparability, cautions, flags, ratioToPeerMedian: ratio,
  };
}

// ---------- hours / payment / warranty ----------
export function hoursAtVisit(hours: DeclaredHours, visitAt: Date): HoursAtVisit {
  const ev = evaluateHours(hours, visitAt);
  const base = { atTehran: ev.evidence.tehranTime, window: ev.evidence.window, reasonCode: ev.status.reasonCode };
  if (ev.status.state === "open") return { ...base, state: "WITHIN_DECLARED", labelFa: "داخل ساعت اعلام‌شده (طبق اعلام فروشگاه؛ باز بودن تأییدشده نیست)" };
  if (ev.status.state === "closed") return { ...base, state: "OUTSIDE_DECLARED", labelFa: "خارج از ساعت اعلام‌شده (طبق اعلام فروشگاه)" };
  return { ...base, state: "UNKNOWN", labelFa: "ساعت کاری اعلام نشده یا قابل‌استفاده نیست (بسته حساب نمی‌شود)" };
}

export function paymentView(p: EngineSeller["payment"]): PaymentView {
  const providers = p.map((x) => ({ name: x.providerName, channel: x.channel }));
  if (!providers.length) return { declared: false, providers, bucket: "UNDECLARED", labelFa: "پرداخت اعلام نشده (به معنی پشتیبانی‌نشدن نیست)" };
  if (providers.some((x) => x.channel === "in_person")) return { declared: true, providers, bucket: "IN_PERSON_DECLARED", labelFa: `پرداخت حضوری اعلام‌شده: ${providers.filter((x) => x.channel === "in_person").map((x) => x.name).join("، ")}` };
  return { declared: true, providers, bucket: "DECLARED_CHANNEL_UNKNOWN", labelFa: `ارائه‌دهنده اعلام شده (${providers.map((x) => x.name).join("، ")}) ولی حضوری بودنش معلوم نیست` };
}

export function warrantyView(w: EngineOffer["warranty"] | null): WarrantyView {
  if (!w) return { kind: "UNKNOWN", months: null, provider: null, description: null, labelFa: "گارانتی اعلام نشده (نبودنش نیست)" };
  const provider = w.provider?.trim() || null;
  const description = w.description?.trim() || null;
  if (provider && /بدون\s*گارانتی/.test(provider)) return { kind: "NONE_DECLARED", months: null, provider, description, labelFa: "صریحاً «بدون گارانتی» اعلام شده" };
  if (w.months && w.months > 0) return { kind: "MONTHS", months: w.months, provider, description, labelFa: `گارانتی ${fa(w.months)} ماهه${provider ? ` (${provider})` : ""}` };
  if (provider && /تست\s*و\s*تحویل/.test(provider)) return { kind: "TEST_AT_DELIVERY", months: null, provider, description, labelFa: "تست و تحویل در حضور مشتری (گارانتی نیست)" };
  if (description) return { kind: "DESCRIPTION", months: null, provider, description, labelFa: `ضمانت اعلام‌شده: ${description}` };
  if (provider) return { kind: "DESCRIPTION", months: null, provider, description, labelFa: `ثبت‌شده: ${provider}` };
  return { kind: "UNKNOWN", months: null, provider: null, description: null, labelFa: "گارانتی اعلام نشده (نبودنش نیست)" };
}

// ---------- ranking keys ----------
const hoursRank = (h: HoursAtVisit) => (h.state === "WITHIN_DECLARED" ? 0 : h.state === "UNKNOWN" ? 1 : 2);
const paymentRank = (p: PaymentView) => (p.bucket === "IN_PERSON_DECLARED" ? 0 : p.bucket === "DECLARED_CHANNEL_UNKNOWN" ? 1 : 2);
const warrantyRank = (w: WarrantyView) => (w.kind === "MONTHS" ? 0 : w.kind === "DESCRIPTION" ? 1 : w.kind === "NONE_DECLARED" ? 3 : 2);

type Keyed = { priceBucket: number; priceValue: number; distance: number | null; hours: HoursAtVisit; payment: PaymentView; warranty: WarrantyView };
function criterionKey(c: RankingPriority, k: Keyed, hasOrigin: boolean): number[] {
  switch (c) {
    case "price": return [k.priceBucket, k.priceBucket <= 1 ? k.priceValue : 0];
    case "distance": return hasOrigin ? [k.distance === null ? 1 : 0, k.distance ?? 0] : [0, 0];
    case "hours": return [hoursRank(k.hours)];
    case "payment": return [paymentRank(k.payment)];
    case "warranty": return [warrantyRank(k.warranty), -(k.warranty.months ?? 0)];
  }
}
export const priorityOrder = (p: RankingPriority): RankingPriority[] => [p, ...DEFAULT_PRIORITY_ORDER.filter((x) => x !== p)];
const cmpKeys = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };

/** price bucket: only trusted prices (0) and unusual-but-valid ones (1) carry a numeric value; the rest are ordered by kind of doubt */
const priceBucket = (c: PriceComparability): number => (c === "TRUSTED" ? 0 : c === "CAUTION" ? 1 : c === "STALE" ? 2 : c === "NO_TIMESTAMP" ? 3 : c === "OUTLIER_OR_INVALID" ? 4 : 5);

// ---------- main ----------
interface Row { offer: EngineOffer; identity: ComparableOfferIdentity; price: PriceEvidenceView; warranty: WarrantyView }
interface Prelim { s: EngineSeller; rows: Row[]; rep: number }
interface BaseSeller {
  p: Prelim;
  r: Row | null;
  tier: ComparisonTier;
  identityEvidence: readonly string[];
  price: PriceEvidenceView;
  distance: number | null;
  hours: HoursAtVisit;
  payment: PaymentView;
  warranty: WarrantyView;
}

export function compareSellers(input: EngineInput): SellerComparisonResponse {
  const { selected, now, visitAt } = input;
  const ctx = { peerPrices: input.peerPrices, snapshotRef: input.snapshotRef, now };

  // 1) per seller: classify EVERY offer, evaluate its price, choose the representative offer
  const prelim: Prelim[] = input.sellers.map((s) => {
    const rows = s.offers.map((offer) => {
      const identity = toIdentity(offer, selected);
      return { offer, identity, price: evaluatePrice(offer, identity.tier, ctx), warranty: warrantyView(offer.warranty) };
    });
    let rep = -1;
    rows.forEach((r, i) => {
      if (rep < 0) { rep = i; return; }
      const a = rows[rep]!;
      const better = cmpKeys(
        [COMP_RANK[r.price.comparability], TIER_RANK[r.identity.tier], r.price.priceToman ?? Number.MAX_SAFE_INTEGER],
        [COMP_RANK[a.price.comparability], TIER_RANK[a.identity.tier], a.price.priceToman ?? Number.MAX_SAFE_INTEGER],
      ) || r.offer.offerId.localeCompare(a.offer.offerId);
      if (better < 0) rep = i;
    });
    return { s, rows, rep };
  });

  // 2) pack quantity: the odd one out among comparable representatives is a MISMATCH (tier C), never normalised
  const comparableReps = prelim.filter((p) => p.rep >= 0 && (p.rows[p.rep]!.identity.tier === "A" || p.rows[p.rep]!.identity.tier === "B"));
  const qtyOf = (p: Prelim) => p.rows[p.rep]!.identity.packQuantity?.value ?? 1;
  if (comparableReps.length >= 2) {
    const freq = new Map<number, number>();
    for (const p of comparableReps) freq.set(qtyOf(p), (freq.get(qtyOf(p)) ?? 0) + 1);
    if (freq.size > 1) {
      const ref = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
      for (const p of comparableReps) {
        if (qtyOf(p) === ref) continue;
        for (const r of p.rows) {
          if ((r.identity.tier === "A" || r.identity.tier === "B") && (r.identity.packQuantity?.value ?? 1) !== ref) {
            r.identity = { ...r.identity, tier: "C", evidence: [...r.identity.evidence, "PACK_QUANTITY_DIFFERS"] };
            r.price = evaluatePrice(r.offer, "C", ctx);
          }
        }
        // re-pick the representative now that tiers changed
        let rep = 0;
        p.rows.forEach((r, i) => { const a = p.rows[rep]!; if (cmpKeys([COMP_RANK[r.price.comparability], TIER_RANK[r.identity.tier], r.price.priceToman ?? Number.MAX_SAFE_INTEGER], [COMP_RANK[a.price.comparability], TIER_RANK[a.identity.tier], a.price.priceToman ?? Number.MAX_SAFE_INTEGER]) < 0) rep = i; });
        p.rep = rep;
      }
    }
  }

  // 3) seller-level facts
  const hasOrigin = !!input.origin;
  const base = prelim.map((p) => {
    const r = p.rep >= 0 ? p.rows[p.rep]! : null;
    const tier: ComparisonTier = r ? r.identity.tier : "D";
    const identityEvidence = r ? r.identity.evidence : (["NO_OFFER_FOR_VARIANT"] as const);
    const price = r ? r.price : evaluatePrice(null, "D", ctx);
    const distance = hasOrigin && p.s.lat !== null && p.s.lon !== null && isValidCoordinate(p.s.lat, p.s.lon) ? haversineMeters(input.origin!.lat, input.origin!.lon, p.s.lat, p.s.lon) : null;
    return { p, r, tier, identityEvidence, price, distance, hours: hoursAtVisit(p.s.hours, visitAt), payment: paymentView(p.s.payment), warranty: r ? r.warranty : warrantyView(null) };
  });

  // 4) ranking among rankable (tier A/B); the chosen priority comes first, others follow in a fixed default order, id breaks ties
  const rankable = base.filter((b) => b.tier === "A" || b.tier === "B");
  const order = priorityOrder(input.priority);
  const keyOf = (b: (typeof base)[number]) => {
    const k: Keyed = { priceBucket: priceBucket(b.price.comparability), priceValue: b.price.priceToman ?? 0, distance: b.distance, hours: b.hours, payment: b.payment, warranty: b.warranty };
    return order.flatMap((c) => criterionKey(c, k, hasOrigin));
  };
  const sorted = [...rankable].sort((a, b) => cmpKeys(keyOf(a), keyOf(b)) || a.p.s.shopId.localeCompare(b.p.s.shopId));
  const notRankable = base.filter((b) => !(b.tier === "A" || b.tier === "B")).sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.p.s.shopId.localeCompare(b.p.s.shopId));

  // 5) price verdict (trusted prices only; never forced)
  const trusted = sorted.filter((b) => b.price.comparability === "TRUSTED" && b.price.priceToman !== null);
  const verdict = buildVerdict({ trusted, sorted, notRankable, base });
  const bestPrice = verdict.winnerShopId ? trusted.find((t) => t.p.s.shopId === verdict.winnerShopId)!.price.priceToman : (trusted.map((t) => t.price.priceToman!).sort((a, b) => a - b)[0] ?? null);
  const nearest = sorted.map((b) => b.distance).filter((d): d is number => d !== null).sort((a, b) => a - b)[0] ?? null;

  // 6) budget
  const { min: bmin, max: bmax } = input.budget;
  const budgetOf = (b: (typeof base)[number]): BudgetStatus => {
    if (!bmin && !bmax) return "NOT_SET";
    if (b.tier === "C" || b.tier === "D") return "NOT_COMPARABLE";
    if (b.price.comparability !== "TRUSTED" || b.price.priceToman === null) return "UNKNOWN";
    return (bmin && b.price.priceToman < bmin) || (bmax && b.price.priceToman > bmax) ? "OVER" : "WITHIN";
  };

  // 7) assemble results
  const ordered = [...sorted, ...notRankable];
  const results: SellerComparisonResult[] = ordered.map((b, idx) => {
    const isRank = idx < sorted.length;
    const prev = idx > 0 && idx < sorted.length ? sorted[idx - 1]! : null;
    const tied = !!prev && cmpKeys(keyOf(prev), keyOf(b)) === 0;
    const budget = budgetOf(b);
    const reasons = buildReasons({ b, bestPrice, nearest, budget, verdict, input });
    return {
      shopId: b.p.s.shopId, name: b.p.s.name, locationLabel: b.p.s.locationLabel, lat: b.p.s.lat, lon: b.p.s.lon,
      rank: isRank ? idx + 1 : null, tiedWithPrevious: tied, tier: b.tier, representative: b.r?.identity ?? null,
      offers: b.p.rows.map((r) => ({ identity: r.identity, price: r.price, warranty: r.warranty })),
      price: b.price, budget, distanceMeters: b.distance, withinRadius: b.distance === null ? null : b.distance <= input.radiusMeters,
      hours: b.hours, payment: b.payment, warranty: b.warranty, reasons, summaryFa: summarize(b, isRank ? idx + 1 : null, input.priority, reasons, tied),
      stock: "unconfirmed",
    };
  });

  const budgetGroups = input.strictBudget && (bmin || bmax)
    ? { within: results.filter((r) => r.budget === "WITHIN").map((r) => r.shopId), over: results.filter((r) => r.budget === "OVER").map((r) => r.shopId), unknown: results.filter((r) => r.budget === "UNKNOWN" || r.budget === "NOT_COMPARABLE").map((r) => r.shopId) }
    : null;

  let situation: ComparisonSituation = "OK";
  if (!input.product) situation = "PRODUCT_NOT_FOUND";
  else if (!input.sellers.length) situation = "NO_SELLERS_SELECTED";
  else if (input.needsConfirmation && !selected) situation = "VARIANT_UNCONFIRMED";
  else if (input.sellers.length === 1) situation = "SINGLE_SELLER";
  else if (!sorted.length) situation = "NO_COMPARABLE_SELLERS";

  return {
    state: "SELLER_COMPARISON", situation, product: input.product,
    variant: { selectedGroupId: selected?.id ?? null, selected, groups: input.groups, needsConfirmation: input.needsConfirmation },
    criteria: { priority: input.priority, visitAtTehran: toIso(visitAt), visitIsNow: input.visitIsNow, origin: input.origin, radiusMeters: input.radiusMeters, budget: input.budget, strictBudget: input.strictBudget },
    sellers: results, verdict, budgetGroups, requestedShopIds: input.requestedShopIds, candidates: input.candidates, notices: input.notices,
    time: { snapshotRef: input.snapshotRef, todayTehran: tehranDate(now), staleRuleDays: THRESHOLDS.staleDays },
    selection: { productId: input.product?.id ?? "", variantGroupId: selected?.id ?? null },
    engineVersion: COMPARISON_VERSION,
  };
}

const toIso = (d: Date) => d.toISOString();

// ---------- verdict ----------
type B = {
  p: { s: EngineSeller };
  tier: ComparisonTier;
  price: PriceEvidenceView;
};
function buildVerdict(a: { trusted: B[]; sorted: B[]; notRankable: B[]; base: B[] }): PriceVerdict {
  const { trusted, sorted, notRankable } = a;
  const none = (kind: PriceVerdict["kind"], headlineFa: string, detailFa: string): PriceVerdict => ({ kind, winnerShopId: null, marginToman: null, headlineFa, detailFa, setAsideShopIds: [] });
  if (!sorted.length) {
    const anyC = notRankable.some((b) => b.tier === "C");
    return anyC
      ? none("NO_WINNER_MISMATCH", "برنده‌ی قیمتی اعلام نمی‌شود", "مدل، واحد یا تعداد بسته‌ی پیشنهادهای انتخاب‌شده با هم نمی‌خواند؛ مقایسه‌ی قیمت بی‌معنی است.")
      : none("NO_WINNER_UNKNOWN_IDENTITY", "برنده‌ی قیمتی اعلام نمی‌شود", "هویت نسخه‌ی پیشنهادها معلوم نیست؛ ابتدا نسخه‌ی دقیق را انتخاب یا از فروشنده بپرسید.");
  }
  if (trusted.length < 2) {
    const why: string[] = [];
    const cnt = (c: PriceComparability) => sorted.filter((b) => b.price.comparability === c).length;
    if (cnt("NO_PRICE")) why.push(`${fa(cnt("NO_PRICE"))} فروشگاه قیمت ثبت‌شده ندارد`);
    if (cnt("STALE")) why.push(`${fa(cnt("STALE"))} قیمت قدیمی است`);
    if (cnt("NO_TIMESTAMP")) why.push(`${fa(cnt("NO_TIMESTAMP"))} قیمت زمان ثبت ندارد`);
    if (cnt("OUTLIER_OR_INVALID")) why.push(`${fa(cnt("OUTLIER_OR_INVALID"))} قیمت پرت یا نامعتبر است`);
    if (cnt("CAUTION")) why.push(`${fa(cnt("CAUTION"))} قیمت غیرعادی پایین است`);
    const mism = notRankable.some((b) => b.tier === "C");
    if (mism) why.push("دست‌کم یک پیشنهاد مدل/واحد/بسته‌ی ناهم‌خوان دارد");
    const kind = mism ? "NO_WINNER_MISMATCH" : "NO_WINNER_INSUFFICIENT";
    const t = trusted[0];
    return none(kind, "برای ادعای «ارزان‌ترین» دست‌کم دو قیمت قابل‌اتکا لازم است", `${t ? `فقط یک قیمت قابل‌اتکا (${formatToman(t.price.priceToman)}) هست` : "قیمت قابل‌اتکایی نیست"}${why.length ? `؛ ${why.join("؛ ")}` : ""}.`);
  }
  const prices = trusted.map((t) => t.price.priceToman!);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  if (hi / lo > THRESHOLDS.priceSpreadReliableMax) return none("NO_WINNER_WIDE_SPREAD", "برنده‌ی قیمتی اعلام نمی‌شود", `قیمت‌های قابل‌اتکا بیش از ${fa(THRESHOLDS.priceSpreadReliableMax)} برابر با هم فرق دارند (${formatToman(lo)} تا ${formatToman(hi)})؛ احتمالاً کالای یکسانی نیستند.`);
  const atLo = trusted.filter((t) => t.price.priceToman === lo);
  if (atLo.length > 1) return none("NO_WINNER_TIE", "قیمت ثبت‌شده‌ی چند فروشگاه برابر است", `${fa(atLo.length)} فروشگاه قیمت ${formatToman(lo)} ثبت کرده‌اند؛ برنده‌ی قیمتی اعلام نمی‌شود.`);
  const win = trusted.find((t) => t.price.priceToman === lo)!;
  const second = prices.filter((p) => p > lo).sort((x, y) => x - y)[0] ?? null;
  const setAside = sorted.filter((b) => b.price.comparability === "CAUTION" && b.price.priceToman !== null && b.price.priceToman < lo).map((b) => b.p.s.shopId);
  const bigGap = second !== null && (second - lo) / second > UNUSUAL.largeMargin;
  const tiersA = trusted.every((t) => t.tier === "A");
  const allA = tiersA && !bigGap && setAside.length === 0;
  const aside = setAside.length ? ` یک قیمت پایین‌تر ولی بسیار غیرعادی (${setAside.length === 1 ? "۱ فروشگاه" : `${fa(setAside.length)} فروشگاه`}) کنار گذاشته شد؛ پیش از رفتن از فروشنده بپرسید.` : "";
  return {
    kind: allA ? "CHEAPEST_CONFIRMED" : "CHEAPEST_QUALIFIED", winnerShopId: win.p.s.shopId, marginToman: second !== null ? second - lo : null, setAsideShopIds: setAside,
    headlineFa: allA ? `کمترین قیمت ثبت‌شده‌ی قابل‌اتکا: ${win.p.s.name}` : setAside.length ? `کمترین قیمت قابل‌اتکا (نه لزوماً کمترین ثبت‌شده): ${win.p.s.name}` : bigGap ? `کمترین قیمت قابل‌اتکا (با اختلاف زیاد — نیازمند تأیید): ${win.p.s.name}` : `کمترین قیمت قابل‌اتکا میان پیشنهادهای احتمالاً هم‌نسخه: ${win.p.s.name}`,
    detailFa: `${formatToman(lo)}${second !== null ? `، ${formatToman(second - lo)} کمتر از قیمت بعدی` : ""}. این قیمت ثبت‌شده در داده است، نه قیمت امروز و نه تضمین موجودی.${!tiersA ? " نسخه‌ی دقیق فقط از روی عنوان فروشنده حدس زده شده؛ از فروشنده تأیید بگیرید." : ""}${bigGap ? " اختلاف با قیمت بعدی بسیار زیاد است (بیش از ۳۰٪)؛ پیش از رفتن مدل و قیمت را از فروشنده تأیید کنید." : ""}${aside}`,
  };
}

// ---------- reasons ----------
function buildReasons(a: { b: BaseSeller; bestPrice: number | null; nearest: number | null; budget: BudgetStatus; verdict: PriceVerdict; input: EngineInput }): RankingReason[] {
  const { b, bestPrice, nearest, budget, verdict, input } = a;
  const out: RankingReason[] = [];
  const add = (code: RankingReasonCode, textFa: string, evidence: RankingReason["evidence"] = {}) => out.push({ code, textFa, polarity: REASON_META[code].polarity, evidence });
  const sid = b.p.s.shopId;

  // identity
  if (b.tier === "A") add("IDENTITY_EXACT_KEY", REASON_META.IDENTITY_EXACT_KEY.meaningFa, { modelKey: b.r?.identity.referenceModelKey ?? null, offerId: b.r?.offer.offerId ?? null });
  else if (b.tier === "B") add("IDENTITY_LIKELY_ONLY", REASON_META.IDENTITY_LIKELY_ONLY.meaningFa, { evidence: b.identityEvidence.join(",") });
  else if (b.tier === "C") add("IDENTITY_MISMATCH", `ناهم‌خوان: ${b.identityEvidence.map((e) => ({ UNIT_MISMATCH: "واحد قیمت متفاوت", SIBLING_MODEL: "کد مدل همخانواده ولی متفاوت", PACK_QUANTITY_DIFFERS: "تعداد در بسته متفاوت" } as Record<string, string>)[e] ?? e).join("، ")}`, { evidence: b.identityEvidence.join(",") });
  else add("IDENTITY_UNKNOWN", b.identityEvidence.includes("NO_OFFER_FOR_VARIANT") ? "این فروشگاه برای نسخه‌ی انتخابی پیشنهادی ثبت نکرده است" : REASON_META.IDENTITY_UNKNOWN.meaningFa, { evidence: b.identityEvidence.join(",") });

  // price
  const c = b.price.comparability;
  const pr = b.price.priceToman;
  if (c === "TRUSTED" && pr !== null) {
    if (verdict.winnerShopId === sid) add("LOWEST_TRUSTED_PRICE", `${REASON_META.LOWEST_TRUSTED_PRICE.meaningFa}: ${formatToman(pr)}`, { priceToman: pr, marginToman: verdict.marginToman });
    else if (verdict.kind === "NO_WINNER_TIE" && bestPrice === pr) add("PRICE_TIE", `${REASON_META.PRICE_TIE.meaningFa}: ${formatToman(pr)}`, { priceToman: pr });
    else if (bestPrice !== null && pr > bestPrice) add("PRICE_HIGHER_THAN_BEST", `${formatToman(pr - bestPrice)} بیشتر از کمترین قیمت قابل‌اتکا (${formatToman(bestPrice)})`, { priceToman: pr, bestPriceToman: bestPrice, deltaToman: pr - bestPrice });
    else if (bestPrice !== null && pr === bestPrice) add("PRICE_TIE", `${REASON_META.PRICE_TIE.meaningFa}: ${formatToman(pr)}`, { priceToman: pr });
  } else if (c === "CAUTION") add("PRICE_UNUSUALLY_LOW", `${REASON_META.PRICE_UNUSUALLY_LOW.meaningFa} (${b.price.ratioToPeerMedian !== null ? `حدود ${fa(Math.round(b.price.ratioToPeerMedian * 100))}٪ میانه` : ""})`, { priceToman: pr, ratio: b.price.ratioToPeerMedian });
  else if (c === "STALE") add("PRICE_STALE", `${REASON_META.PRICE_STALE.meaningFa}${b.price.ageDaysToday !== null ? ` (${fa(b.price.ageDaysToday)} روز پیش از امروز)` : ""}`, { ageDaysToday: b.price.ageDaysToday, ageDaysAtSnapshot: b.price.ageDaysAtSnapshot });
  else if (c === "NO_TIMESTAMP") add("PRICE_NO_TIMESTAMP", REASON_META.PRICE_NO_TIMESTAMP.meaningFa, { priceToman: pr });
  else if (c === "OUTLIER_OR_INVALID") add("PRICE_INVALID_OR_OUTLIER", `${REASON_META.PRICE_INVALID_OR_OUTLIER.meaningFa}${b.price.flags.length ? ` (${b.price.flags.filter((f) => flagDef(f)?.blocksComparison).join("، ")})` : ""}`, { flags: b.price.flags.join(",") });
  else if (c === "NO_PRICE") add("PRICE_MISSING", REASON_META.PRICE_MISSING.meaningFa, {});
  if (b.price.cautions.includes("FAR_ABOVE_PEERS")) add("PRICE_UNUSUALLY_HIGH", REASON_META.PRICE_UNUSUALLY_HIGH.meaningFa, { ratio: b.price.ratioToPeerMedian });

  // budget
  if (budget === "WITHIN") add("BUDGET_WITHIN", REASON_META.BUDGET_WITHIN.meaningFa, { priceToman: pr });
  else if (budget === "OVER") add("BUDGET_OVER", REASON_META.BUDGET_OVER.meaningFa, { priceToman: pr });
  else if (budget === "UNKNOWN" || budget === "NOT_COMPARABLE") add("BUDGET_UNKNOWN", REASON_META.BUDGET_UNKNOWN.meaningFa, {});

  // distance
  if (input.origin) {
    if (b.distance === null) add("DISTANCE_UNKNOWN", REASON_META.DISTANCE_UNKNOWN.meaningFa);
    else if (nearest !== null && b.distance === nearest && (b.tier === "A" || b.tier === "B")) add("NEAREST", `${REASON_META.NEAREST.meaningFa} (حدود ${fa(Math.round(b.distance))} متر)`, { meters: Math.round(b.distance) });
    else if (nearest !== null) add("FARTHER_THAN_NEAREST", `${fa(Math.round(b.distance - nearest))} متر دورتر از نزدیک‌ترین (خط مستقیم)`, { meters: Math.round(b.distance), nearestMeters: Math.round(nearest) });
  }

  // hours / payment / warranty
  add(b.hours.state === "WITHIN_DECLARED" ? "HOURS_WITHIN" : b.hours.state === "OUTSIDE_DECLARED" ? "HOURS_OUTSIDE" : "HOURS_UNKNOWN", b.hours.labelFa, { atTehran: b.hours.atTehran });
  add(b.payment.bucket === "IN_PERSON_DECLARED" ? "PAYMENT_IN_PERSON" : b.payment.bucket === "DECLARED_CHANNEL_UNKNOWN" ? "PAYMENT_CHANNEL_UNKNOWN" : "PAYMENT_UNDECLARED", b.payment.labelFa, { providers: b.payment.providers.map((p) => `${p.name}:${p.channel}`).join(",") });
  add(b.warranty.kind === "MONTHS" || b.warranty.kind === "DESCRIPTION" ? "WARRANTY_DECLARED" : b.warranty.kind === "NONE_DECLARED" ? "WARRANTY_NONE_DECLARED" : "WARRANTY_UNKNOWN", b.warranty.labelFa, { months: b.warranty.months });
  if (b.p.rows.length > 1) add("MULTIPLE_OFFERS_SAME_SHOP", `${REASON_META.MULTIPLE_OFFERS_SAME_SHOP.meaningFa} (${fa(b.p.rows.length)} پیشنهاد)`, { offers: b.p.rows.length });
  return out;
}

function summarize(b: BaseSeller, rank: number | null, priority: RankingPriority, reasons: RankingReason[], tied: boolean): string {
  if (rank === null) return `رتبه‌بندی نمی‌شود — ${TIER_META[b.tier].labelFa}: ${reasons.find((r) => r.code.startsWith("IDENTITY_"))?.textFa ?? TIER_META[b.tier].descriptionFa}`;
  const key = ({ price: ["LOWEST_TRUSTED_PRICE", "PRICE_HIGHER_THAN_BEST", "PRICE_TIE", "PRICE_UNUSUALLY_LOW", "PRICE_STALE", "PRICE_NO_TIMESTAMP", "PRICE_INVALID_OR_OUTLIER", "PRICE_MISSING"], distance: ["NEAREST", "FARTHER_THAN_NEAREST", "DISTANCE_UNKNOWN"], hours: ["HOURS_WITHIN", "HOURS_OUTSIDE", "HOURS_UNKNOWN"], payment: ["PAYMENT_IN_PERSON", "PAYMENT_CHANNEL_UNKNOWN", "PAYMENT_UNDECLARED"], warranty: ["WARRANTY_DECLARED", "WARRANTY_NONE_DECLARED", "WARRANTY_UNKNOWN"] } as Record<RankingPriority, RankingReasonCode[]>)[priority];
  const r = reasons.find((x) => key.includes(x.code));
  return `رتبه‌ی ${fa(rank)}${tied ? " (هم‌رتبه در معیارها؛ ترتیب فقط برای ثبات است)" : ""} بر پایه‌ی «${PRIORITY_FA[priority]}»${r ? `: ${r.textFa}` : ""}`;
}

export { classifyIdentity, extractPackQuantity };
