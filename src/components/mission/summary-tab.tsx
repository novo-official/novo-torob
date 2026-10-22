"use client";

import Link from "next/link";
import { ArrowLeft, CalendarClock, Info, Store, TriangleAlert } from "lucide-react";
import { STATUS_FA } from "@/domain/inquiry";
import { activeInquiry, MISSION_LIMITS, RECOVERY_TRIGGER_FA, type ShoppingMissionV1 } from "@/domain/mission";
import type { MissionFacts } from "@/domain/mission-recovery";
import { TIER_META } from "@/domain/comparison";
import { Badge, Card } from "@/components/ui";
import { ProvenanceBadge } from "@/components/inquiry/provenance-badge";
import { formatToman, toFaDigits } from "@/lib/format";
import type { MissionView } from "@/lib/mission-derive";
import { missionLinks } from "@/lib/mission-links";
import type { MissionTab } from "@/lib/mission-url";

const TL_FA = { DATASET_RECORDED: "داده", USER_REPORTED: "گزارش شما (تأییدنشده)", USER_ACTION: "اقدام شما", SYSTEM: "سیستم" } as const;
const TIER_TONE = { A: "ok", B: "brand", C: "danger", D: "warn" } as const;

export function SummaryTab({ m, facts, view, onTab, failed }: { m: ShoppingMissionV1; facts: MissionFacts | null; view: MissionView; onTab: (t: MissionTab) => void; failed: boolean }) {
  const ctx = facts?.context ?? null;
  const inq = activeInquiry(m);
  return (
    <div className="space-y-3" data-testid="tab-summary">
      {failed ? <p role="alert" className="rounded-xl bg-danger-bg p-3 text-sm text-danger-ink" data-testid="facts-failed">دریافت اطلاعات داده ممکن نشد؛ هیچ قیمت یا ساعتی نمایش داده نمی‌شود. دوباره تلاش کنید.</p> : null}
      {facts?.error && facts.error !== "PRODUCT_NOT_FOUND" ? (
        <p role="alert" data-testid="facts-mismatch" className="flex gap-2 rounded-xl bg-danger-bg p-3 text-sm leading-7 text-danger-ink"><TriangleAlert aria-hidden size={16} className="mt-1 shrink-0" />شناسه‌های فروشگاه، پیشنهاد و محصول این ماموریت در داده با هم نمی‌خوانند ({facts.error}). چیزی به‌عنوان واقعیت نشان داده نمی‌شود؛ فروشگاه را دوباره انتخاب کنید.</p>
      ) : null}
      {facts?.error === "PRODUCT_NOT_FOUND" ? <p role="alert" data-testid="facts-mismatch" className="rounded-xl bg-danger-bg p-3 text-sm text-danger-ink">این محصول در داده پیدا نشد؛ ماموریت را از جست‌وجو دوباره شروع کنید.</p> : null}

      <Card className="space-y-2" data-testid="mission-product">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-ink-2">محصول</h2><ProvenanceBadge kind="DATASET_RECORDED" short /></div>
        {m.product ? (
          <>
            <p className="font-semibold leading-7"><bdi>{facts?.product?.title ?? "در حال بارگذاری…"}</bdi></p>
            <p className="text-xs text-ink-2">{ctx?.variant.label ? <>نسخه‌ی انتخابی: <bdi>{ctx.variant.label}</bdi></> : m.product.variantGroupId ? "نسخه‌ی انتخاب‌شده" : "نسخه‌ی دقیق هنوز تأیید نشده"}</p>
            {facts?.product ? <Link href={facts.product.productHref} className="inline-flex min-h-11 items-center text-sm text-brand hover:underline">مشخصات و نسخه‌ها</Link> : null}
          </>
        ) : (
          <p className="text-sm leading-7 text-ink-2">{m.need.text ? <>نیاز ثبت‌شده: <bdi>{m.need.text}</bdi>. </> : null}هنوز محصولی انتخاب نشده؛ از مشاور یا جست‌وجو یک محصول انتخاب کنید.</p>
        )}
      </Card>

      {m.product ? (
        <Card className="space-y-2" data-testid="mission-shop">
          <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-1.5 text-sm font-bold text-ink-2"><Store aria-hidden size={14} />فروشگاه و پیشنهاد</h2><ProvenanceBadge kind="DATASET_RECORDED" short /></div>
          {ctx ? (
            <>
              <p className="font-semibold"><bdi>{ctx.shop.name}</bdi>{ctx.shop.locationLabel ? <span className="font-normal text-ink-2"> · {ctx.shop.locationLabel}</span> : null}</p>
              <p className="text-lg font-bold" data-testid="mission-price">{ctx.offer.priceToman !== null ? formatToman(ctx.offer.priceToman) : "قیمتی ثبت نشده — نیازمند استعلام"}</p>
              <p className="text-xs leading-6 text-ink-2">{ctx.offer.recordedAtLabel ?? "زمان ثبت نامعلوم"}{ctx.offer.ageDaysToday !== null ? ` (${toFaDigits(ctx.offer.ageDaysToday)} روز پیش از امروز)` : ""} — <strong>قیمت امروز نیست</strong>.</p>
              <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="وضعیت پیشنهاد">
                <li><Badge tone={TIER_TONE[ctx.offer.tier]}>{TIER_META[ctx.offer.tier].labelFa}</Badge></li>
                <li><Badge tone="warn" title="وجود پیشنهاد در داده به معنی موجودی نیست">موجودی تأییدنشده</Badge></li>
                <li><Badge tone={ctx.hours.state === "WITHIN_DECLARED" ? "ok" : ctx.hours.state === "OUTSIDE_DECLARED" ? "danger" : "warn"} data-testid="mission-hours"><CalendarClock aria-hidden size={12} />{ctx.hours.labelFa}</Badge></li>
              </ul>
              {ctx.offer.outsideSelectedVariant ? <p role="note" className="flex gap-1 text-xs leading-6 text-danger-ink"><TriangleAlert aria-hidden size={12} className="mt-1 shrink-0" />این پیشنهاد در نسخه‌ی انتخابی شما نیست؛ جایگزین نمی‌شود.</p> : null}
            </>
          ) : m.shop ? <p className="text-sm text-ink-2">{facts?.error ? "اطلاعات این پیشنهاد قابل‌اتکا نیست." : "در حال بارگذاری از داده…"}</p> : (
            <p className="text-sm leading-7 text-ink-2">هنوز فروشگاهی انتخاب نشده.{m.shortlist.length ? ` ${toFaDigits(m.shortlist.length)} فروشگاه برای مقایسه علامت خورده است.` : ""}</p>
          )}
        </Card>
      ) : null}

      {m.shop ? (
        <Card className="space-y-1.5" data-testid="mission-inquiry-status">
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-ink-2">پرسش از فروشنده</h2><ProvenanceBadge kind={inq?.replies.length ? "USER_REPORTED" : "UNKNOWN"} short /></div>
          <p className="text-sm">{STATUS_FA[inq?.status ?? "DRAFT"]}</p>
          {view.outcome && inq?.replies.length ? <p className="text-sm leading-7" data-testid="mission-outcome">{view.outcome.headlineFa}. <span className="text-ink-2">{view.outcome.claimFa}</span></p> : <p className="text-xs leading-6 text-ink-2">هیچ پرسشی از طرف برنامه ارسال نمی‌شود؛ متن را خودتان می‌پرسید و پاسخ را ثبت می‌کنید.</p>}
          <button type="button" className="min-h-11 text-sm text-brand underline" onClick={() => onTab("inquiry")}>باز کردن پرسش و پاسخ</button>
        </Card>
      ) : null}

      <Card className="space-y-2" data-testid="mission-risks">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink-2"><Info aria-hidden size={14} />ریسک‌ها و نامعلوم‌ها</h2>
        {view.triggers.length ? <ul className="space-y-1 text-sm text-danger-ink" data-testid="mission-triggers">{view.triggers.map((t) => <li key={t} className="flex gap-1.5"><TriangleAlert aria-hidden size={14} className="mt-1 shrink-0" />{RECOVERY_TRIGGER_FA[t]}</li>)}</ul> : null}
        {view.readiness.blockers.length ? <ul className="list-disc space-y-1 ps-5 text-sm leading-7" data-testid="mission-blockers">{view.readiness.blockers.map((b) => <li key={b.code}>{b.textFa}</li>)}</ul> : <p className="text-sm text-ok-ink" data-testid="mission-ready-note">همه‌ی بررسی‌های لازم مرور شده‌اند.</p>}
        <ul className="list-disc space-y-1 ps-5 text-xs leading-6 text-ink-2">{view.readiness.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
      </Card>

      {m.timeline.length ? (
        <details className="rounded-2xl border border-line bg-surface p-4" data-testid="mission-timeline">
          <summary className="min-h-11 cursor-pointer text-sm font-bold">سابقه‌ی ماموریت ({toFaDigits(Math.min(m.timeline.length, MISSION_LIMITS.timeline))})</summary>
          <ol className="mt-2 space-y-2 text-sm">
            {[...m.timeline].reverse().slice(0, 30).map((t) => (
              <li key={t.rev} className="flex flex-wrap items-start gap-2 border-t border-line pt-2 first:border-0 first:pt-0" data-provenance={t.provenance}><Badge tone={t.provenance === "USER_REPORTED" ? "brand" : "neutral"}>{TL_FA[t.provenance]}</Badge><span className="min-w-0 flex-1 leading-7">{t.textFa}<span className="block text-xs text-ink-2">{toFaDigits(new Date(t.at).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }))}{t.nextFa ? ` · گام بعد: ${t.nextFa}` : ""}</span></span></li>
            ))}
          </ol>
        </details>
      ) : null}
      {m.product ? (
        <nav aria-label="بازگشت به مراحل قبل با حفظ انتخاب‌ها" className="flex flex-wrap gap-x-4 text-sm" data-testid="mission-links">
          <Link href={missionLinks(m).sellers} className="inline-flex min-h-11 items-center gap-1 text-brand hover:underline"><ArrowLeft aria-hidden size={14} className="rtl:rotate-0" />فروشگاه‌های اطراف</Link>
          <Link href={missionLinks(m).compare} className="inline-flex min-h-11 items-center text-brand hover:underline">مقایسه‌ی فروشنده‌ها</Link>
          {facts?.product ? <Link href={facts.product.productHref} className="inline-flex min-h-11 items-center text-brand hover:underline">صفحه‌ی محصول</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
