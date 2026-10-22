"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, ExternalLink, Globe, Info, MapPin, Store, TriangleAlert } from "lucide-react";
import { TIER_META } from "@/domain/comparison";
import type { InquiryContext } from "@/domain/inquiry";
import { cn } from "@/lib/cn";
import { ProvenanceBadge } from "@/components/inquiry/provenance-badge";
import { Badge, Card } from "@/components/ui";
import { formatToman, toFaDigits } from "@/lib/format";

const TIER_TONE = { A: "ok", B: "brand", C: "danger", D: "warn" } as const;

/** Evidence hierarchy: what was recorded (dataset) vs what is unknown. Renders ONLY server-resolved facts. */
export function ContextCard({ ctx, children }: { ctx: InquiryContext; children?: React.ReactNode }) {
  const o = ctx.offer;
  // on phones the secondary lines are one tap away (nothing is removed; desktop always shows everything)
  const [more, setMore] = useState(false);
  const sec = cn(!more && "max-lg:hidden");
  return (
    <Card className="space-y-4" aria-labelledby="ctx-h" data-testid="inquiry-context">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ctx-h" className="font-bold">محصول و پیشنهاد انتخاب‌شده</h2>
        <ProvenanceBadge kind="DATASET_RECORDED" />
      </div>
      <div className="space-y-1">
        <p className="font-semibold leading-7"><Link href={ctx.product.productHref} className="text-brand hover:underline"><bdi>{ctx.product.title}</bdi></Link></p>
        <p className="text-xs text-ink-2">{ctx.variant.label ? <>نسخه‌ی انتخابی: <bdi>{ctx.variant.label}</bdi></> : "نسخه‌ی دقیق هنوز انتخاب نشده"}</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="space-y-0.5">
          <dt className="flex items-center gap-1.5 text-ink-2"><Store aria-hidden size={14} />فروشگاه</dt>
          <dd className="font-semibold"><Link href={ctx.shop.shopHref} className="text-brand hover:underline"><bdi>{ctx.shop.name}</bdi></Link>{ctx.shop.locationLabel ? <span className="font-normal text-ink-2"> · {ctx.shop.locationLabel}</span> : null}</dd>
          <dd className={cn("flex items-start gap-1 text-xs leading-6 text-ink-2", sec)}><Info aria-hidden size={12} className="mt-1 shrink-0" />{ctx.shop.pseudonymNoteFa}</dd>
        </div>
        <div className={cn("space-y-0.5", sec)}>
          <dt className="text-ink-2">عنوان پیشنهاد (خام، از فروشنده)</dt>
          <dd data-testid="ctx-offer-title"><bdi>{o.sellerTitle}</bdi></dd>
          <dd className="text-xs text-ink-2" dir="ltr">{o.id}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-ink-2">قیمت ثبت‌شده</dt>
          <dd className="text-base font-bold" data-testid="ctx-price">{o.priceToman !== null ? formatToman(o.priceToman) : "قیمتی ثبت نشده"}</dd>
          <dd className="text-xs leading-6 text-ink-2">{o.recordedAtLabel ?? "زمان ثبت نامعلوم"}{o.ageDaysToday !== null ? ` (${toFaDigits(o.ageDaysToday)} روز پیش از امروز)` : ""} — <strong>قیمت امروز نیست</strong>. {o.comparabilityFa}.</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-ink-2">هویت نسخه</dt>
          <dd><Badge tone={TIER_TONE[o.tier]}>{TIER_META[o.tier].labelFa}</Badge></dd>
          {o.identityEvidenceFa.length ? <dd className={cn("text-xs leading-6 text-ink-2", sec)}>{o.identityEvidenceFa[0]}</dd> : null}
          {o.outsideSelectedVariant ? <dd role="note" className="flex gap-1 text-xs leading-6 text-danger-ink"><TriangleAlert aria-hidden size={12} className="mt-1 shrink-0" />این پیشنهاد در نسخه‌ی انتخابی شما نیست؛ جایگزین نمی‌شود و باید مدل دقیق پرسیده شود.</dd> : null}
        </div>
      </dl>
      <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="اطلاعات ثبت‌شده و نامعلوم">
        <li><Badge tone="warn" title="وجود پیشنهاد در داده به معنی موجودی نیست">موجودی تأییدنشده</Badge></li>
        <li><Badge tone="neutral">{o.warranty.labelFa}</Badge></li>
        <li><Badge tone="neutral">{ctx.payment.labelFa}</Badge></li>
        <li><Badge tone={ctx.hours.state === "WITHIN_DECLARED" ? "ok" : ctx.hours.state === "OUTSIDE_DECLARED" ? "neutral" : "warn"}><CalendarClock aria-hidden size={12} />{ctx.hours.labelFa}</Badge></li>
        {ctx.shop.sharedCoordinates > 0 ? <li><Badge tone="neutral"><MapPin aria-hidden size={12} />مختصات مشترک با {toFaDigits(ctx.shop.sharedCoordinates)} فروشگاه دیگر (سطح پاساژ)</Badge></li> : null}
      </ul>
      <button type="button" className="min-h-11 text-start text-sm font-semibold text-brand underline lg:hidden" aria-expanded={more} onClick={() => setMore((v) => !v)} data-testid="ctx-more">{more ? "جزئیات کمتر" : "جزئیات بیشتر پیشنهاد"}</button>
      {ctx.unknownsFa.length ? (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand">چه چیزهایی هنوز نامعلوم است؟ ({toFaDigits(ctx.unknownsFa.length)})</summary>
          <ul className="list-disc space-y-1 ps-5 leading-7 text-ink-2">{ctx.unknownsFa.map((u) => <li key={u}>{u}</li>)}</ul>
        </details>
      ) : null}
      {children}
    </Card>
  );
}

/** Public profile links only (validated https). A link is NOT a verified messaging channel and nothing is opened automatically. */
export function PublicLinks({ ctx }: { ctx: InquiryContext }) {
  const links = [ctx.shop.website && { ...ctx.shop.website, kind: "وب‌سایت" }, ctx.shop.instagram && { ...ctx.shop.instagram, kind: "اینستاگرام" }].filter(Boolean) as Array<{ href: string; label: string; kind: string }>;
  return (
    <div className="space-y-2" data-testid="public-links">
      <h3 className="text-sm font-bold">راه‌های عمومی ثبت‌شده در داده</h3>
      {links.length ? (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-brand hover:underline" dir="ltr">
                <Globe aria-hidden size={14} />{l.kind}: {l.label}<ExternalLink aria-hidden size={12} /><span className="sr-only"> (پنجره‌ی جدید)</span>
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-2" data-testid="no-channel">وب‌سایت یا اینستاگرام معتبری برای این فروشگاه ثبت نشده است.</p>}
      <p className="rounded-xl bg-warn-bg p-3 text-xs leading-6 text-warn-ink">
        <strong>راه ارتباطی تأییدشده‌ای وجود ندارد.</strong> شماره‌های دیتاست ساختگی‌اند و نمایش یا تماس داده نمی‌شوند. لینک بالا فقط پروفایل عمومی است و با کلیک شما باز می‌شود؛ وجود آن نشان نمی‌دهد که پیام‌رسانی ممکن یا مجاز است. هر پرسشی را خودتان از راه مستقل می‌پرسید.
      </p>
    </div>
  );
}
