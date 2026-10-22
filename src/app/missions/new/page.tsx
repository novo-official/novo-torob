import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, SearchX } from "lucide-react";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { InquiryWorkspace } from "@/components/inquiry/inquiry-workspace";
import { SellerQa } from "@/components/seller-qa";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { CONTEXT_ERROR_FA } from "@/domain/inquiry";
import { buildMissionHref, buildMissionStartHref, parseMissionContext } from "@/lib/mission-url";
import { getReadDbOrNull } from "@/server/db/safe";
import { toTehranLocalInput } from "@/server/compare/time";
import { resolveInquiryContext } from "@/server/inquiry/context";

export const metadata: Metadata = { title: "پرسش از فروشنده" };
export const dynamic = "force-dynamic";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * Stage 4. With NO ids it is the generic local Q&A (Phase 1). With ids, every fact is re-derived on the server from the real DB
 * (the URL is untrusted) and the inquiry workspace is shown — or an honest error with recovery links. Nothing is ever sent anywhere.
 */
export default async function MissionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = parseMissionContext((k) => first(sp[k]));
  const hasIds = ["product", "shop", "offer", "variant"].some((k) => first(sp[k]));
  const header = (
    <PageHeader eyebrow="گام ۴ — پرسش و پیگیری از فروشنده" title="پرسش را بسازید، خودتان بپرسید و پاسخ را ثبت کنید">
      این‌جا پیام آماده می‌شود تا <strong>خودتان</strong> از راه معتبر بپرسید. هیچ پیامی به فروشنده فرستاده نمی‌شود؛ پاسخ‌ها را شما ثبت می‌کنید و تا تأیید مستقل، «گزارش شما» می‌مانند. حالت شبیه‌سازی جداگانه و فقط برای دمو است.
    </PageHeader>
  );
  if (!hasIds) return <>{header}<SellerQa /></>;

  const db = getReadDbOrNull();
  if (!db) return <>{header}<DataUnavailable /></>;
  const raw = (k: string) => first(sp[k]);
  const r = resolveInquiryContext(db, { product: raw("product"), variant: raw("variant"), shop: raw("shop"), offer: raw("offer"), visit: q.visit });
  if (!r.ok) {
    const m = CONTEXT_ERROR_FA[r.error];
    return (
      <>
        {header}
        <EmptyState icon={<SearchX size={22} />} title={m.title} action={<><ButtonLink href={r.recovery.sellersHref}>فروشگاه‌های اطراف</ButtonLink><ButtonLink href={r.recovery.compareHref} variant="secondary">مقایسه‌ی فروشنده‌ها</ButtonLink></>}>
          <p data-testid="inquiry-error" data-error={r.error}>{m.detail}</p>
          {r.error === "OFFER_REQUIRED" && r.candidates ? (
            <ul className="mx-auto mt-3 max-w-xl space-y-2 text-start" data-testid="offer-choices">
              {r.candidates.map((c) => (
                <li key={c.offerId}><Link className="block min-h-11 rounded-xl border border-line bg-surface p-3 text-sm text-brand hover:bg-brand-soft" href={buildMissionHref({ product: q.product, variant: q.variant, shop: q.shop, offer: c.offerId, visit: q.visit, back: q.back })}><bdi>{c.sellerTitle}</bdi><span className="block text-xs text-ink-2">سطح هویت {c.tier}</span></Link></li>
              ))}
            </ul>
          ) : null}
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {header}
      <nav aria-label="مسیر" className="mb-4 flex flex-wrap gap-x-4 text-sm">
        <Link href={q.back ?? r.context.routes.compareHref} className="inline-flex min-h-11 items-center gap-1 text-brand hover:underline"><ArrowRight aria-hidden size={14} />{q.back?.startsWith("/sellers") ? "بازگشت به فروشگاه‌های اطراف" : "بازگشت به مقایسه"}</Link>
        <Link href={r.context.routes.sellersHref} className="inline-flex min-h-11 items-center text-ink-2 hover:underline">فروشگاه‌های اطراف</Link>
      </nav>
      <section aria-label="ادامه به‌صورت ماموریت" className="mb-4 flex flex-col gap-3 rounded-2xl border border-brand/40 bg-brand-soft/40 p-4 sm:flex-row sm:items-center" data-testid="start-mission">
        <p className="min-w-0 flex-1 text-sm leading-7"><strong>می‌خواهید بعد از پرسش هم ادامه دهید؟</strong> یک ماموریت موقت بسازید تا فهرست آمادگی، زمان مراجعه و راه جایگزین در یک جا باشد (چیزی بدون اجازه‌ی شما ذخیره نمی‌شود).</p>
        <ButtonLink className="w-full sm:w-auto" href={buildMissionStartHref({ product: q.product, variant: q.variant, shop: q.shop, offer: r.context.offer.id, visit: q.visit })} data-testid="start-mission-cta">ساخت ماموریت از این انتخاب</ButtonLink>
      </section>
      <InquiryWorkspace ctx={r.context} visitDefault={toTehranLocalInput(new Date())} back={q.back} />
    </>
  );
}
