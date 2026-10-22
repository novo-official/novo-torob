import Link from "next/link";
import type { ReactNode } from "react";
import { Clock, CreditCard, ExternalLink, FileQuestion, MoveHorizontal, ShieldCheck, Store, Trash2, TriangleAlert } from "lucide-react";
import { COMPARABILITY_FA, IDENTITY_EVIDENCE_FA, PRIORITY_FA, TIER_META, type ComparisonTier, type PriceEvidenceView, type SellerComparisonResponse, type SellerComparisonResult } from "@/domain/comparison";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { FLAG_SHORT } from "@/lib/flag-labels";
import { formatToman, toFaDigits } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import { EVIDENCE_KIND_FA, formatTehranDate, formatTehranDateTime } from "@/lib/seller-labels";
import styles from "./compare.module.css";

const fa = toFaDigits;
const TIER_TONE: Record<ComparisonTier, "ok" | "brand" | "danger" | "warn"> = { A: "ok", B: "brand", C: "danger", D: "warn" };
const COMP_TONE: Record<PriceEvidenceView["comparability"], "ok" | "warn" | "danger" | "neutral"> = { TRUSTED: "ok", CAUTION: "warn", STALE: "warn", NO_TIMESTAMP: "warn", OUTLIER_OR_INVALID: "danger", NO_PRICE: "neutral", IDENTITY_BLOCKED: "danger" };
const BUDGET_FA = { NOT_SET: null, WITHIN: "داخل بودجه", OVER: "بیش از بودجه", UNKNOWN: "نسبت به بودجه نامعلوم (قیمت قابل‌اتکا نیست)", NOT_COMPARABLE: "با بودجه سنجیده نمی‌شود (نسخه ناهم‌خوان)" } as const;

export interface CompareTableProps {
  data: SellerComparisonResponse;
  shopHref: (s: SellerComparisonResult) => string;
  missionHref: (s: SellerComparisonResult) => string;
  removeHref: (s: SellerComparisonResult) => string;
}

function PriceCell({ p }: { p: PriceEvidenceView }) {
  return (
    <div className="space-y-1">
      <p className="text-base font-bold" data-testid="price-value">{p.priceToman !== null ? formatToman(p.priceToman) : p.priceUnsafe ? "مقدار نامعتبر" : "قیمتی ثبت نشده"}</p>
      {p.priceRaw !== null ? <p className="text-xs text-ink-2" dir="ltr">raw: {p.priceRaw}</p> : <p className="text-xs text-ink-2">نامعلوم — صفر حساب نمی‌شود</p>}
      <Badge tone={COMP_TONE[p.comparability]}>{COMPARABILITY_FA[p.comparability]}</Badge>
      {p.cautions.includes("FAR_BELOW_PEERS") && p.ratioToPeerMedian !== null ? <p className="text-xs text-warn-ink">حدود {fa(Math.round(p.ratioToPeerMedian * 100))}٪ میانه‌ی همتایان</p> : null}
      {p.flags.filter((f) => FLAG_SHORT[f]).length ? <p className="flex flex-wrap gap-1">{p.flags.filter((f) => FLAG_SHORT[f]).map((f) => <Badge key={f} tone={FLAG_SHORT[f]!.tone}>{FLAG_SHORT[f]!.text}</Badge>)}</p> : null}
    </div>
  );
}

function Freshness({ p, snapshot }: { p: PriceEvidenceView; snapshot: string | null }) {
  if (!p.recordedAtKnown) return <p className="text-sm text-warn-ink">زمان ثبت قیمت نامعلوم</p>;
  return (
    <div className="space-y-0.5 text-sm">
      <p>{formatTehranDateTime(p.recordedAt)}</p>
      <p className="text-xs text-ink-2">{p.ageDaysToday !== null ? (p.ageDaysToday === 0 ? "امروز" : `${fa(p.ageDaysToday)} روز پیش از امروز`) : ""}</p>
      {p.ageDaysAtSnapshot !== null ? <p className="text-xs text-ink-2">{fa(p.ageDaysAtSnapshot)} روز پیش از عکس داده{snapshot ? ` (${formatTehranDate(snapshot)})` : ""}{p.staleBySnapshotRule ? " · قدیمی طبق قاعده‌ی ۹۰ روز" : ""}</p> : null}
    </div>
  );
}

/** Side-by-side comparison. The first column (criteria labels) is pinned; the table scrolls INSIDE its wrapper, never the page. */
export function CompareTable({ data, shopHref, missionHref, removeHref }: CompareTableProps) {
  const sellers = data.sellers;
  const snap = data.time.snapshotRef;
  const th = "sticky start-0 z-10 w-28 min-w-28 border-b border-line bg-surface-2 p-2.5 text-start align-top text-xs font-bold text-ink-2 sm:w-36 sm:min-w-36 sm:text-sm";
  const td = "min-w-[11rem] max-w-[15rem] border-b border-line p-2.5 align-top text-sm border-s border-line";
  const row = (label: string, render: (s: SellerComparisonResult) => ReactNode, testid?: string) => (
    <tr data-testid={testid} className="hover:bg-surface-2/20">
      <th scope="row" className={th}>{label}</th>
      {sellers.map((s) => <td key={s.shopId} className={cn(td, s.rank === null && "bg-surface-2/40")}>{render(s)}</td>)}
    </tr>
  );

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs leading-6 text-ink-2 md:hidden" data-testid="compare-scroll-hint">
        <MoveHorizontal aria-hidden size={14} className="text-brand" />
        <span>ستون عنوان‌ها ثابت است؛ جدول را به چپ و راست بکشید تا همه‌ی فروشنده‌ها را ببینید.</span>
      </p>
      <div
        className={styles.tableScroller}
        tabIndex={0}
        role="region"
        aria-label="جدول مقایسه‌ی فروشنده‌ها (با اسکرول افقی داخل جدول)"
        data-testid="compare-scroller"
      >
        <table className="w-full border-collapse" data-testid="compare-table">
          <caption className="sr-only">مقایسه‌ی {fa(sellers.length)} فروشنده برای {data.product?.title}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(th, "top-0")}><span className="sr-only">معیار</span></th>
              {sellers.map((s) => (
                <th key={s.shopId} scope="col" className={styles.colHeader} data-testid="compare-col" data-shop-id={s.shopId} data-rank={s.rank ?? ""}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-bold"><Store aria-hidden size={16} className="shrink-0 text-brand" /><bdi className="truncate">{s.name}</bdi></p>
                      <p className="text-xs font-normal text-ink-2">{s.locationLabel ?? ""}</p>
                    </div>
                    {s.rank !== null ? <Badge tone={s.rank === 1 ? "ok" : "neutral"} data-testid="rank-badge">رتبه‌ی {fa(s.rank)}{s.tiedWithPrevious ? " (هم‌رتبه)" : ""}</Badge> : <Badge tone="warn" data-testid="rank-badge">بدون رتبه</Badge>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row("چرا این جایگاه؟", (s) => <p className="leading-7" data-testid="summary">{s.summaryFa}</p>)}
            {row("هویت نسخه", (s) => (
              <div className="space-y-1.5">
                <Badge tone={TIER_TONE[s.tier]} data-testid="tier-badge">{TIER_META[s.tier].labelFa}</Badge>
                <ul className="list-disc space-y-0.5 ps-4 text-xs leading-6 text-ink-2">{(s.representative?.evidence ?? ["NO_OFFER_FOR_VARIANT" as const]).map((e) => <li key={e}>{IDENTITY_EVIDENCE_FA[e]}</li>)}</ul>
                {s.representative ? <p className="text-xs text-ink-2">عنوان خام فروشنده: <bdi className="text-ink">{s.representative.rawSellerTitle}</bdi></p> : null}
                {s.representative ? <p className="text-xs text-ink-2">{s.representative.unitOfSaleFa}{s.representative.packQuantity ? ` · بسته ${fa(s.representative.packQuantity.value)} عددی («${s.representative.packQuantity.evidence}»)` : ""}</p> : null}
              </div>
            ), "row-identity")}
            {row("قیمت ثبت‌شده", (s) => <PriceCell p={s.price} />, "row-price")}
            {row("زمان ثبت قیمت", (s) => <Freshness p={s.price} snapshot={snap} />, "row-fresh")}
            {data.criteria.budget.min || data.criteria.budget.max ? row("بودجه", (s) => <p className={cn("text-sm", s.budget === "OVER" && "text-danger-ink", s.budget === "UNKNOWN" && "text-warn-ink")}>{BUDGET_FA[s.budget]}</p>, "row-budget") : null}
            {row("فاصله (خط مستقیم)", (s) => s.distanceMeters === null ? <p className="text-ink-2">{data.criteria.origin ? "مختصات فروشگاه معتبر نیست" : "نقطه‌ی شروع انتخاب نشده"}</p> : <p>حدود {formatDistance(s.distanceMeters)}{s.withinRadius === false ? <span className="text-xs text-warn-ink"> · خارج از شعاع انتخابی</span> : null}<span className="block text-xs text-ink-2">نه زمان پیاده‌روی یا رانندگی</span></p>, "row-distance")}
            {row("ساعت در زمان بازدید", (s) => (
              <div className="space-y-1">
                <Badge tone={s.hours.state === "WITHIN_DECLARED" ? "ok" : s.hours.state === "OUTSIDE_DECLARED" ? "neutral" : "warn"}><Clock aria-hidden size={12} />{s.hours.state === "WITHIN_DECLARED" ? "داخل ساعت اعلام‌شده" : s.hours.state === "OUTSIDE_DECLARED" ? "خارج از ساعت اعلام‌شده" : "نامعلوم"}</Badge>
                <p className="text-xs text-ink-2">{s.hours.labelFa}</p>
                {s.hours.window ? <p className="text-xs text-ink-2">بازه: {fa(s.hours.window.start)} تا {fa(s.hours.window.end)}</p> : null}
              </div>
            ), "row-hours")}
            {row("پرداخت", (s) => (
              <div className="space-y-1">
                <p className="flex items-start gap-1.5 text-sm"><CreditCard aria-hidden size={14} className="mt-1 shrink-0" />{s.payment.labelFa}</p>
                {s.payment.providers.length ? <ul className="flex flex-wrap gap-1">{s.payment.providers.map((p) => <li key={p.name}><Badge tone={p.channel === "in_person" ? "ok" : "neutral"}>{p.name} · {p.channel === "in_person" ? "حضوری" : p.channel === "online" ? "آنلاین" : "کانال نامعلوم"}</Badge></li>)}</ul> : null}
              </div>
            ), "row-payment")}
            {row("گارانتی", (s) => <p className="flex items-start gap-1.5"><ShieldCheck aria-hidden size={14} className="mt-1 shrink-0" />{s.warranty.labelFa}</p>, "row-warranty")}
            {row("پیشنهادهای این فروشگاه", (s) => (
              <details>
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand">{fa(s.offers.length)} پیشنهاد ثبت‌شده</summary>
                <ul className="space-y-2">
                  {s.offers.map((o) => (
                    <li key={o.identity.offerId} className="rounded-xl bg-surface-2 p-2.5 text-xs leading-6" data-offer-id={o.identity.offerId}>
                      <p><Badge tone={TIER_TONE[o.identity.tier]}>{o.identity.tier}</Badge> <bdi>{o.identity.rawSellerTitle}</bdi></p>
                      <p className="font-semibold">{o.price.priceToman !== null ? formatToman(o.price.priceToman) : "بدون قیمت"} · {formatTehranDate(o.price.recordedAt) ?? "زمان نامعلوم"}</p>
                      <p className="text-ink-2">{o.warranty.labelFa}</p>
                      <p className="text-ink-2" dir="ltr">{o.identity.offerId}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-2">{EVIDENCE_KIND_FA.datasetOffer} — {EVIDENCE_KIND_FA.unverifiedStock}.</p>
              </details>
            ), "row-offers")}
            {row("دلیل‌ها و شواهد", (s) => (
              <details data-testid="reasons">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand">{fa(s.reasons.length)} دلیل</summary>
                <ul className="space-y-1.5">
                  {s.reasons.map((r, i) => (
                    <li key={`${r.code}${i}`} className="text-xs leading-6" data-reason={r.code}>
                      <span className={cn("me-1 font-bold", r.polarity === "positive" ? "text-ok-ink" : r.polarity === "negative" ? "text-danger-ink" : "text-ink-2")} aria-hidden>{r.polarity === "positive" ? "＋" : r.polarity === "negative" ? "－" : "•"}</span>
                      {r.textFa}
                      <span className="block text-ink-2" dir="ltr">{r.code}{Object.entries(r.evidence).filter(([, v]) => v !== null && v !== "").map(([k, v]) => ` ${k}=${v}`).join("")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ), "row-reasons")}
            {row("اقدام", (s) => (
              <div className="flex flex-col gap-2 pt-1">
                <Link href={missionHref(s)} data-testid="prepare-inquiry" className={styles.primaryAction}>
                  <FileQuestion aria-hidden size={14} />
                  <span>آماده‌سازی پرسش (دستی)</span>
                </Link>
                <Link href={shopHref(s)} className={styles.secondaryAction}>
                  <ExternalLink aria-hidden size={14} />
                  <span>جزئیات فروشگاه</span>
                </Link>
                <Link href={removeHref(s)} data-testid="remove-seller" className="inline-flex min-h-9 items-center justify-center gap-1.5 text-xs text-ink-2 hover:text-danger-ink underline">
                  <Trash2 aria-hidden size={13} />
                  <span>حذف از مقایسه<span className="sr-only"> ({s.name})</span></span>
                </Link>
              </div>
            ))}
          </tbody>
        </table>
        <p className="flex items-start gap-2 border-t border-line p-3 text-xs leading-6 text-ink-2">
          <TriangleAlert aria-hidden size={14} className="mt-1 shrink-0" />
          <span>معیار انتخابی: «{PRIORITY_FA[data.criteria.priority]}». {EVIDENCE_KIND_FA.datasetOffer}؛ {EVIDENCE_KIND_FA.declaredHours}؛ {EVIDENCE_KIND_FA.unverifiedStock}. هیچ پاسخی از فروشنده دریافت یا ارسال نشده است.</span>
        </p>
      </div>
    </div>
  );
}
