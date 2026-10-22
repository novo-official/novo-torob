import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPinned, SearchX } from "lucide-react";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { AreaExplorer } from "@/components/sellers/area-explorer";
import { SellersExplorer } from "@/components/sellers/sellers-explorer";
import { ButtonLink, EmptyState, inputStyles, PageHeader } from "@/components/ui";
import { parseSellersParams } from "@/lib/sellers-url";
import { recommendShoppingAreas } from "@/server/areas/recommend";
import { getReadDbOrNull } from "@/server/db/safe";
import { findSellersForProduct } from "@/server/sellers/find";
import { getOriginPresets, resolveOrigin } from "@/server/sellers/origins";

export const metadata: Metadata = { title: "فروشنده‌های اطراف" };
export const dynamic = "force-dynamic";

function toUrlSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) { const x = Array.isArray(v) ? v[0] : v; if (x !== undefined) u.set(k, x); }
  return u;
}

export default async function SellersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseSellersParams(toUrlSearchParams(await searchParams));
  const db = getReadDbOrNull();
  const header = (
    <PageHeader eyebrow="گام ۲ — فروشنده‌های اطراف" title="فروشگاه‌هایی که برای همین محصول پیشنهاد ثبت کرده‌اند">
      فقط فروشگاه‌هایی نشان داده می‌شوند که در داده‌ی هکاتون برای همین محصول پیشنهاد دارند. «پیشنهاد ثبت‌شده» یعنی موجودی تأیید نشده؛ پیش از رفتن باید از فروشنده پرسید.
    </PageHeader>
  );
  if (!db) return <>{header}<DataUnavailable /></>;
  const presets = getOriginPresets(db);
  const origin = resolveOrigin(db, { preset: params.origin, point: params.origin === "gps" ? null : params.ll });

  // ---- product given → matched-offer sellers
  if (params.product) {
    const result = findSellersForProduct(db, {
      productId: params.product, variantGroupId: params.variant, origin, radiusMeters: params.radius, showUncertain: params.uncertain, sort: params.sort,
      openNow: params.open, reliablePriceOnly: params.reliable, paymentProvider: params.pay, page: 1, pageSize: 50,
    });
    if (result) {
      return (
        <>
          {header}
          <nav aria-label="مسیر" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {params.back ? <Link href={params.back} className="inline-flex items-center gap-1 text-brand hover:underline"><ArrowRight aria-hidden size={14} />بازگشت به نتایج</Link> : null}
            <Link href={`/products/${result.product!.id}${params.variant ? `?variant=${encodeURIComponent(params.variant)}` : ""}`} className="inline-flex min-h-11 items-center font-semibold hover:underline"><bdi>{result.product!.title}</bdi></Link>
          </nav>
          <SellersExplorer initial={result} params={params} presets={presets.map((p) => ({ id: p.id, label: p.label }))} />
        </>
      );
    }
  }

  // ---- no (valid) product → honest "not found" + area-only recovery when a category is known
  const area = params.category ? recommendShoppingAreas(db, { categoryHint: params.category, origin, limit: 4 }) : null;
  return (
    <>
      {header}
      {params.product ? (
        <EmptyState icon={<SearchX size={22} />} title="این محصول در داده پیدا نشد" action={<><ButtonLink href="/search">جست‌وجوی دوباره</ButtonLink><ButtonLink href="/discover" variant="secondary">کمکم کن انتخاب کنم</ButtonLink></>}>
          <p>شناسه‌ی محصول معتبر نیست یا در داده‌ی ما وجود ندارد؛ برای آن هیچ فروشنده‌ای ساخته نشده است.</p>
        </EmptyState>
      ) : null}
      {area && area.areas.length > 0 ? (
        <section aria-labelledby="area-only-h" className="mt-6 space-y-4">
          <h2 id="area-only-h" className="flex items-center gap-2 text-lg font-bold"><MapPinned aria-hidden size={20} />مناطق پیشنهادی برای «{area.category}»</h2>
          <p role="status" data-testid="area-only-note" className="rounded-xl bg-warn-bg p-3 text-sm leading-7 text-warn-ink">محصول مشخصی انتخاب نشده، پس هیچ فروشنده یا موجودی‌ای نمایش داده نمی‌شود؛ فقط محله‌هایی که برای این دسته ارزش گشتن دارند.</p>
          <AreaExplorer areas={area.areas} origin={{ lat: origin.lat, lon: origin.lon, label: origin.label }} />
        </section>
      ) : null}
      {area && area.areas.length === 0 ? (
        <EmptyState icon={<SearchX size={22} />} title="منطقه‌ی مبتنی بر شاهد پیدا نشد" action={<ButtonLink href="/search">جست‌وجوی محصول</ButtonLink>}>
          <p data-testid="no-area">{area.reason === "NO_CATEGORY" ? "دسته‌ی کالا را تشخیص ندادیم، پس منطقه‌ای پیشنهاد نمی‌کنیم." : "برای این دسته در داده یا منابع بررسی‌شده شاهد کافی برای معرفی یک منطقه نداریم؛ حدس نمی‌زنیم."}</p>
        </EmptyState>
      ) : null}
      {!params.product && !params.category ? (
        <EmptyState icon={<MapPinned size={22} />} title="ابتدا محصول را انتخاب کنید" action={<><ButtonLink href="/discover">کمکم کن انتخاب کنم</ButtonLink><ButtonLink href="/search" variant="secondary">جست‌وجوی مدل</ButtonLink></>}>
          <p>برای یافتن فروشگاه‌های دارای پیشنهاد ثبت‌شده، محصول (و نسخه‌ی دقیق) را انتخاب کنید. اگر فقط به دنبال محله‌ی خرید یک دسته‌اید، نام دسته را بنویسید:</p>
          <form method="get" action="/sellers" className="mx-auto mt-3 flex max-w-md gap-2">
            <label className="sr-only" htmlFor="cat">نام دسته یا کالا</label>
            <input id="cat" name="category" className={inputStyles} placeholder="مثلاً پاوربانک" maxLength={120} />
            <button type="submit" className="min-h-11 shrink-0 rounded-xl bg-brand px-5 font-semibold text-brand-ink">پیشنهاد منطقه</button>
          </form>
        </EmptyState>
      ) : null}
    </>
  );
}
