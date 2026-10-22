import Link from "next/link";
import { ArrowLeft, Clock, CreditCard, ExternalLink, FileQuestion, MapPin, MapPinned, Store, TriangleAlert } from "lucide-react";
import type { SellerMatch } from "@/domain/sellers";
import { Badge, ButtonLink } from "@/components/ui";
import { FLAG_SHORT } from "@/lib/flag-labels";
import { formatToman, toFaDigits } from "@/lib/format";
import { externalMapLink, formatDistance } from "@/lib/geo";
import { DISTANCE_NOTE, EVIDENCE_LABEL, hoursLabel, priceAgeLabel, VARIANT_LABEL } from "@/lib/seller-labels";
import { cn } from "@/lib/cn";
import styles from "./seller-card.module.css";

const UNIT: Record<string, string> = { per_metre: " (قیمت هر متر)", roll_or_pack: " (حلقه یا بسته)" };

export interface SellerCardProps {
  seller: SellerMatch;
  detailHref: string;
  handoffHref: string;
  /** Manual inquiry workspace for this shop's first recorded offer */
  inquiryHref?: string;
  selected: boolean;
  outside?: boolean;
  onShowOnMap?: (id: string) => void;
  /** Tick this shop for the side-by-side comparison */
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
      className={cn(styles.card, selected && styles.selected, outside && styles.outside)}
    >
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h3 className={styles.title}>
            <Store aria-hidden size={18} />
            <bdi className="truncate">{s.name}</bdi>
          </h3>
          <p className={styles.metaRow}>
            {s.locationLabel ? <Badge tone="neutral">{s.locationLabel}</Badge> : null}
            {s.distanceMeters !== null ? (
              <span data-testid="distance" className={styles.distance}>
                <MapPin aria-hidden size={14} className="text-brand" />
                حدود {formatDistance(s.distanceMeters)}
                {outside ? " (خارج از شعاع انتخابی)" : ""}
              </span>
            ) : null}
          </p>
        </div>
        <Badge tone={variant.tone === "danger" ? "danger" : variant.tone}>
          {s.offerCount === 1 ? "۱ پیشنهاد" : `${toFaDigits(s.offerCount)} پیشنهاد`}
        </Badge>
      </div>

      <p className={cn(styles.variantNote, variant.tone === "ok" ? "text-ok-ink" : "text-warn-ink")}>
        {variant.tone !== "ok" ? <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0" /> : null}
        <span>{variant.text}</span>
      </p>

      <div className={styles.priceSection} data-testid="price-block">
        {p.status === "recorded" && p.min !== null && p.max !== null ? (
          <>
            <p className={styles.priceValue}>
              {p.min === p.max ? formatToman(p.min) : `${formatToman(p.min)?.replace(" تومان", "")} تا ${formatToman(p.max)}`}
              <span className="text-xs font-normal text-ink-2">{unit}</span>
            </p>
            <p className={styles.priceMeta}>
              قیمت ثبت‌شده در داده، نه قیمت امروز · {priceAgeLabel(p.newestAt, p.newestAgeDays)}
              {p.stale ? " · قیمت قدیمی" : ""}
            </p>
          </>
        ) : (
          <p className="text-sm font-semibold text-warn-ink">{p.noteFa ?? "قیمت قابل‌اتکا ثبت نشده"}</p>
        )}
      </div>

      <ul className={styles.tagsList}>
        <li>
          <Badge tone={hours.tone === "ok" ? "ok" : hours.tone === "warn" ? "warn" : "neutral"}>
            <Clock aria-hidden size={12} />
            {hours.text}
          </Badge>
        </li>
        <li>
          <Badge tone="neutral">
            <CreditCard aria-hidden size={12} />
            {s.payment.declared ? (s.payment.providers.length ? s.payment.providers.slice(0, 3).join("، ") : "پرداخت: اعلام‌شده") : "پرداخت اعلام نشده"}
          </Badge>
        </li>
        <li>
          <Badge tone="warn">موجودی تأییدنشده</Badge>
        </li>
        {s.locationEvidence.sharedWithShops > 0 ? (
          <li>
            <Badge tone="neutral">{toFaDigits(s.locationEvidence.sharedWithShops + 1)} فروشگاه با مختصات یکسان (سطح پاساژ)</Badge>
          </li>
        ) : null}
      </ul>

      <details className={styles.details}>
        <summary className={styles.summary}>
          <span>پیشنهادهای ثبت‌شده و شواهد</span>
          <span className="text-xs font-normal text-ink-2">{toFaDigits(s.offers.length)} مورد</span>
        </summary>
        <ul className={styles.offersList}>
          {s.offers.map((o) => (
            <li key={o.offerId} className={styles.offerItem}>
              <p className="text-xs text-ink-2">عنوان خام فروشنده:</p>
              <p><bdi>{o.sellerTitle}</bdi></p>
              <p className="text-xs font-medium">
                {o.priceToman !== null ? <>قیمت ثبت‌شده: {formatToman(o.priceToman)}{UNIT[o.unitHint] ?? ""}</> : "بدون قیمت"} · {priceAgeLabel(o.priceChangedAt, null)}
              </p>
              <p className="text-xs text-ink-2">{VARIANT_LABEL[o.variantMatch].text} — {EVIDENCE_LABEL[o.variantEvidence]}</p>
              {o.flags.filter((f) => FLAG_SHORT[f]).length > 0 ? (
                <p className="mt-1 flex flex-wrap gap-1">
                  {o.flags.filter((f) => FLAG_SHORT[f]).map((f) => (
                    <Badge key={f} tone={FLAG_SHORT[f]!.tone}>{FLAG_SHORT[f]!.text}</Badge>
                  ))}
                </p>
              ) : null}
            </li>
          ))}
          {s.hiddenOfferCount > 0 ? (
            <li className="text-xs text-ink-2">
              {toFaDigits(s.hiddenOfferCount)} پیشنهاد دیگر از این فروشگاه برای نسخه‌های دیگر ثبت شده و پنهان است.
            </li>
          ) : null}
        </ul>
        <p className="mt-2 text-xs leading-6 text-ink-2">{s.locationEvidence.noteFa} {DISTANCE_NOTE}</p>
      </details>

      <div className={styles.actions}>
        <Link href={handoffHref} className={styles.primaryAction}>
          <span>ادامه با این فروشنده</span>
          <ArrowLeft aria-hidden size={14} />
        </Link>
        <ButtonLink href={detailHref} variant="secondary" className="min-h-11 px-3.5 text-xs">
          جزئیات فروشگاه
        </ButtonLink>
        {onShowOnMap ? (
          <button type="button" onClick={() => onShowOnMap(s.shopId)} className={styles.secondaryAction}>
            <MapPinned aria-hidden size={14} />
            <span>نمایش روی نقشه</span>
          </button>
        ) : null}
        {inquiryHref ? (
          <Link href={inquiryHref} data-testid="card-inquiry" className={styles.secondaryAction}>
            <FileQuestion aria-hidden size={14} />
            <span>آماده‌سازی پرسش</span>
          </Link>
        ) : null}
        {compare ? (
          <label className={cn(styles.compareLabel, compare.checked && styles.compareLabelActive, compare.disabled && !compare.checked && styles.compareLabelDisabled)}>
            <input
              type="checkbox"
              className="size-4.5 rounded text-brand focus:ring-brand"
              data-testid="compare-checkbox"
              checked={compare.checked}
              disabled={compare.disabled && !compare.checked}
              onChange={() => compare.onToggle(s.shopId)}
            />
            <span>افزودن به مقایسه<span className="sr-only"> ({s.name})</span></span>
          </label>
        ) : null}
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className={styles.mapLink}>
            <ExternalLink aria-hidden size={13} />
            <span>مکان در OpenStreetMap</span>
            <span className="sr-only"> (پنجره‌ی جدید)</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}
