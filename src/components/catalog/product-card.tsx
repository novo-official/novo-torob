import Link from "next/link";
import type { ReactNode } from "react";
import type { ProductCard as Card } from "@/domain/advisor";
import { Badge, Ltr } from "@/components/ui";
import { toFaDigits } from "@/lib/format";
import { CompareToggle } from "./compare-store";
import { PriceLine } from "./price-line";
import { ProductImage } from "./product-image";

export const REDACTED_TITLE = "عنوان حذف‌شده برای انتشار";

/** Catalog card used by search, advisor and compare. Every number comes from the database DTO. */
export function ProductCardView({ card, href, badge, children, matchNote }: { card: Card; href: string; badge?: ReactNode; matchNote?: string; children?: ReactNode }) {
  const redacted = card.title === REDACTED_TITLE || !card.title;
  const title = redacted ? "عنوان این محصول در داده حذف شده است" : card.title;
  const v = card.variants;
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,34,42,0.04)]">
      <div className="flex gap-3">
        <Link href={href} tabIndex={-1} aria-hidden className="shrink-0">
          <ProductImage src={card.imageUrl} className="size-20 sm:size-24" />
        </Link>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {badge}
            <Badge>{card.categoryName}</Badge>
            {matchNote ? <Badge tone="brand">{matchNote}</Badge> : null}
          </div>
          <h3 className="text-[0.95rem] font-bold leading-7">
            <Link href={href} className="hover:text-brand">
              <bdi>{title}</bdi>
            </Link>
          </h3>
          {card.brandName || card.model ? (
            <p className="text-xs text-ink-2">
              {card.brandName ? <span>برند: {card.brandName}</span> : null}
              {card.brandName && card.model ? " · " : null}
              {card.model ? <span>مدل: <Ltr>{card.model}</Ltr></span> : null}
            </p>
          ) : (
            <p className="text-xs text-ink-2">برند و مدل در داده ثبت نشده</p>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <PriceLine price={card.price} />
          <div className="flex flex-wrap gap-1.5">
            {v.modelMismatch > 0 ? <Badge tone="warn">{toFaDigits(v.modelMismatch)} پیشنهاد با کد مدل شبیه ولی متفاوت</Badge> : null}
            {v.unitAmbiguous > 0 ? <Badge tone="warn">واحد قیمت نامشخص</Badge> : null}
            {v.modelUnconfirmed > 0 ? <Badge>{toFaDigits(v.modelUnconfirmed)} پیشنهاد با مدل تأییدنشده</Badge> : null}
            {card.distinctSellers > 0 ? <Badge>{toFaDigits(card.distinctSellers)} فروشنده با پیشنهاد ثبت‌شده · موجودی تأییدنشده</Badge> : <Badge tone="warn">پیشنهادی ثبت نشده</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CompareToggle id={card.id} title={redacted ? card.categoryName : card.title} />
          <Link href={href} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold text-brand hover:bg-brand-soft">
            مشاهده‌ی جزئیات
          </Link>
        </div>
      </div>
      {children}
    </article>
  );
}
