import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Scale, SearchX } from "lucide-react";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { CompareView } from "@/components/compare/compare-view";
import { Badge, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { parseCompareParams } from "@/lib/compare-url";
import { getReadDbOrNull } from "@/server/db/safe";
import { toTehranLocalInput } from "@/server/compare/time";
import { compareSellersForProduct } from "@/server/compare/service";
import { getOriginPresets, resolveOrigin } from "@/server/sellers/origins";

export const metadata: Metadata = { title: "مقایسه‌ی فروشنده‌ها" };
export const dynamic = "force-dynamic";

function toUrlSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) { const x = Array.isArray(v) ? v[0] : v; if (x !== undefined) u.set(k, x); }
  return u;
}

/**
 * Seller comparison (stage 3). Contract: /compare?product&variant&shop|shops[&o&ll&r&visit&bmin&bmax&strict&prio].
 * Product-to-product comparison stays at /compare/products. Nothing here contacts a seller or confirms stock.
 */
export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseCompareParams(toUrlSearchParams(await searchParams));
  const db = getReadDbOrNull();
  const header = (
    <PageHeader eyebrow="گام ۳ — مقایسه‌ی فروشنده‌ها" title="مقایسه‌ی شفاف فروشنده‌ها">
      فقط پیشنهادهای ثبت‌شده در داده با شاهدشان کنار هم گذاشته می‌شوند. اگر مدل، واحد یا قیمت قابل‌اتکا نباشد، «برنده» اعلام نمی‌کنیم. موجودی هرگز تأییدشده نیست.
    </PageHeader>
  );

  if (!params.product) {
    return (
      <>
        {header}
        <EmptyState icon={<Scale size={22} />} title="هنوز محصولی برای مقایسه‌ی فروشنده انتخاب نشده" action={<><ButtonLink href="/discover">کمکم کن انتخاب کنم</ButtonLink><ButtonLink href="/search" variant="secondary">جست‌وجوی مدل</ButtonLink></>}>
          <p>ابتدا محصول (و نسخه‌ی دقیق) را انتخاب و از «فروشگاه‌های اطراف» ۲ تا ۴ فروشگاه را برای مقایسه تیک بزنید.</p>
          <p className="mt-2"><Badge>مقایسه‌ی خود محصولات از <Link href="/compare/products" className="underline">این‌جا</Link> ممکن است.</Badge></p>
        </EmptyState>
      </>
    );
  }
  if (!db) return <>{header}<DataUnavailable /></>;

  const origin = params.origin && params.origin !== "gps" || params.ll ? resolveOrigin(db, { preset: params.origin, point: params.ll }) : null;
  const res = compareSellersForProduct(db, {
    productId: params.product, variantGroupId: params.variant, shopIds: params.shops,
    origin: origin ? { lat: origin.lat, lon: origin.lon, source: origin.source, label: origin.label } : null,
    radiusMeters: params.radius, visit: params.visit, budget: { min: params.bmin, max: params.bmax }, strictBudget: params.strict, priority: params.prio,
  });
  if (!res) {
    return (
      <>
        {header}
        <EmptyState icon={<SearchX size={22} />} title="این محصول در داده پیدا نشد" action={<ButtonLink href="/search">جست‌وجوی دوباره</ButtonLink>}>
          <p data-testid="compare-not-found">شناسه‌ی محصول معتبر نیست یا در داده‌ی ما وجود ندارد؛ برای آن هیچ مقایسه‌ای ساخته نشده است.</p>
        </EmptyState>
      </>
    );
  }
  const presets = getOriginPresets(db).map((p) => ({ id: p.id, label: p.label }));
  return (
    <>
      {header}
      <nav aria-label="مسیر" className="mb-4 flex flex-wrap gap-x-4 text-sm">
        <Link href={params.back ?? `/sellers?product=${params.product}${params.variant ? `&variant=${encodeURIComponent(params.variant)}` : ""}`} className="inline-flex min-h-11 items-center gap-1 text-brand hover:underline"><ArrowRight aria-hidden size={14} />بازگشت به فروشگاه‌های اطراف</Link>
        <Link href="/compare/products" className="inline-flex min-h-11 items-center text-ink-2 hover:underline">مقایسه‌ی خود محصولات</Link>
      </nav>
      <CompareView initial={res} params={params} presets={presets} visitDefault={toTehranLocalInput(new Date())} />
    </>
  );
}
