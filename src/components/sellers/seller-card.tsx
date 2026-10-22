import Link from "next/link";
import { Clock, CreditCard, ExternalLink, MapPin, Store, TriangleAlert } from "lucide-react";
import type { SellerMatch } from "@/domain/sellers";
import { Badge, ButtonLink } from "@/components/ui";
import { FLAG_SHORT } from "@/lib/flag-labels";
import { formatToman, toFaDigits } from "@/lib/format";
import { externalMapLink, formatDistance } from "@/lib/geo";
import { DISTANCE_NOTE, EVIDENCE_LABEL, hoursLabel, priceAgeLabel, VARIANT_LABEL } from "@/lib/seller-labels";
import { cn } from "@/lib/cn";

const UNIT: Record<string, string> = { per_metre: " (قیمت هر متر)", roll_or_pack: " (حلقه یا بسته)" };

export interface SellerCardProps {
  seller: SellerMatch;
  detailHref: string;
  handoffHref: string;
  /** Phase 6: manual inquiry workspace for this shop's first recorded offer */
  inquiryHref?: string;
  selected: boolean;
  outside?: boolean;
  onShowOnMap?: (id: string) => void;
  /** Phase 5: tick this shop for the side-by-side comparison */
  compare?: { checked: boolean; disabled: boolean; onToggle: (id: string) => void };
}

/** One card = one unique SHOP. Its offers stay separate inside (never merged), stock is always "unconfirmed". */
export function SellerCard({ seller: s, detailHref, handoffHref, inquiryHref, selected, outside = false, onShowOnMap, compare }: SellerCardProps) {
  const hours = hoursLabel(s.declaredSchedule.status);
  const variant = VARIANT_LABEL[s.variantMatchStatus];
  const p = s.priceEvidence;
  const link = externalMapLink(s.lat, s.lon);
  const unit = UNIT[s.offers.find((o) => o.unitHint !== "unknown")?.unitHint ?? ""] ?? "";
  return (
    <li
      id={`seller-${s.shopId}`}
      data-testid="seller-card"
      data-shop-id={s.shopId}
      aria-current={selected ? "true" : undefined}
      className={cn("space-y-3 rounded-[var(--radius-card)] border bg-surface p-4", selected ? "border-brand ring-2 ring-brand" : "border-line", outside && "border-dashed")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-center gap-2 font-bold"><Store aria-hidden size={18} className="shrink-0 text-brand" /><bdi className="truncate">{s.name}</bdi></h3>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
            {s.locationLabel ? <Badge tone="neutral">{s.locationLabel}</Badge> : null}
            {s.distanceMeters !== null ? <span data-testid="distance"><MapPin aria-hidden size={14} className="me-1 inline" />حدود {formatDistance(s.distanceMeters)}{outside ? " (خارج از شعاع انتخابی)" : ""}</span> : null}
          </p>
        </div>
        <Badge tone={variant.tone === "danger" ? "danger" : variant.tone}>{s.offerCount === 1 ? "۱ پیشنهاد" : `${toFaDigits(s.offerCount)} پیشنهاد`}</Badge>
      </div>

      <p className={cn("flex items-start gap-1.5 text-sm", variant.tone === "ok" ? "text-ok-ink" : "text-warn-ink")}>
        {variant.tone !== "ok" ? <TriangleAlert aria-hidden size={16} className="mt-1 shrink-0" /> : null}
        <span>{variant.text}</span>
      </p>

      <div className="space-y-0.5" data-testid="price-block">
        {p.status === "recorded" && p.min !== null && p.max !== null ? (
          <>
            <p className="font-bold">{p.min === p.max ? formatToman(p.min) : `${formatToman(p.min)?.replace(" تومان", "")} تا ${formatToman(p.max)}`}<span className="text-xs font-normal text-ink-2">{unit}</span></p>
            <p className="text-xs text-ink-2">قیمت ثبت‌شده در داده، نه قیمت امروز · {priceAgeLabel(p.newestAt, p.newestAgeDays)}{p.stale ? " · قیمت قدیمی" : ""}</p>
          </>
        ) : (
          <p className="text-sm font-semibold text-warn-ink">{p.noteFa ?? "قیمت قابل‌اتکا ثبت نشده"}</p>
        )}
      </div>

      <ul className="flex flex-wrap gap-1.5 text-xs">
        <li><Badge tone={hours.tone === "ok" ? "ok" : hours.tone === "warn" ? "warn" : "neutral"}><Clock aria-hidden size={12} />{hours.text}</Badge></li>
        <li><Badge tone="neutral"><CreditCard aria-hidden size={12} />{s.payment.declared ? (s.payment.providers.length ? s.payment.providers.slice(0, 3).join("، ") : "پرداخت: اعلام‌شده") : "پرداخت اعلام نشده"}</Badge></li>
        <li><Badge tone="warn">موجودی تأییدنشده</Badge></li>
        {s.locationEvidence.sharedWithShops > 0 ? <li><Badge tone="neutral">{toFaDigits(s.locationEvidence.sharedWithShops + 1)} فروشگاه با مختصات یکسان (سطح پاساژ)</Badge></li> : null}
      </ul>

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand">پیشنهادهای ثبت‌شده و شواهد</summary>
        <ul className="space-y-2 pb-1">
          {s.offers.map((o) => (
            <li key={o.offerId} className="space-y-1 rounded-xl bg-surface-2 p-2.5">
              <p className="text-xs text-ink-2">عنوان خام فروشنده:</p>
              <p><bdi>{o.sellerTitle}</bdi></p>
              <p className="text-xs">{o.priceToman !== null ? <>قیمت ثبت‌شده: {formatToman(o.priceToman)}{UNIT[o.unitHint] ?? ""}</> : "بدون قیمت"} · {priceAgeLabel(o.priceChangedAt, null)}</p>
              <p className="text-xs text-ink-2">{VARIANT_LABEL[o.variantMatch].text} — {EVIDENCE_LABEL[o.variantEvidence]}</p>
              <p className="flex flex-wrap gap-1">{o.flags.filter((f) => FLAG_SHORT[f]).map((f) => <Badge key={f} tone={FLAG_SHORT[f]!.tone}>{FLAG_SHORT[f]!.text}</Badge>)}</p>
            </li>
          ))}
          {s.hiddenOfferCount > 0 ? <li className="text-xs text-ink-2">{toFaDigits(s.hiddenOfferCount)} پیشنهاد دیگر از این فروشگاه برای نسخه‌های دیگر ثبت شده و پنهان است.</li> : null}
        </ul>
        <p className="text-xs leading-6 text-ink-2">{s.locationEvidence.noteFa} {DISTANCE_NOTE}</p>
      </details>

      <div className="flex flex-wrap gap-2">
        <ButtonLink href={detailHref} variant="secondary" className="min-h-11 px-4 text-sm">جزئیات فروشگاه</ButtonLink>
        {onShowOnMap ? <button type="button" onClick={() => onShowOnMap(s.shopId)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-4 text-sm font-semibold text-brand hover:bg-brand-soft">نمایش روی نقشه</button> : null}
        <Link href={handoffHref} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand-hover">ادامه با این فروشنده</Link>
        {inquiryHref ? <Link href={inquiryHref} data-testid="card-inquiry" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold text-brand hover:bg-brand-soft">آماده‌سازی پرسش</Link> : null}
        {compare ? (
          <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold", compare.checked ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line", compare.disabled && !compare.checked && "cursor-not-allowed opacity-60")}>
            <input type="checkbox" className="size-5" data-testid="compare-checkbox" checked={compare.checked} disabled={compare.disabled && !compare.checked} onChange={() => compare.onToggle(s.shopId)} />
            <span>افزودن به مقایسه<span className="sr-only"> ({s.name})</span></span>
          </label>
        ) : null}
        {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-brand hover:underline"><ExternalLink aria-hidden size={14} />مکان در OpenStreetMap<span className="sr-only"> (پنجره‌ی جدید)</span></a> : null}
      </div>
    </li>
  );
}
