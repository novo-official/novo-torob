import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Clock, CreditCard, ExternalLink, Info, MapPin, TriangleAlert } from "lucide-react";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { SellerCard } from "@/components/sellers/seller-card";
import { ShopMiniMap } from "@/components/sellers/shop-mini-map";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { toFaDigits } from "@/lib/format";
import { externalMapLink } from "@/lib/geo";
import { hoursTable, safeShopLink } from "@/lib/hours-table";
import { buildMissionHref } from "@/lib/mission-url";
import { buildShopHref, safeSellersBack } from "@/lib/sellers-url";
import { hoursLabel } from "@/lib/seller-labels";
import { getReadDbOrNull } from "@/server/db/safe";
import { getShop } from "@/server/repositories/shops";
import { evaluateHours } from "@/server/domain/hours";
import { findSellersForProduct } from "@/server/sellers/find";

export const dynamic = "force-dynamic";
const SHOP_ID = /^shop_[0-9a-f]{8,40}$/;
const PRODUCT_ID = /^product_[0-9a-f]{8,40}$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = getReadDbOrNull();
  const s = db && SHOP_ID.test(id) ? getShop(db, id) : null;
  return { title: s ? s.shop.name.slice(0, 60) : "جزئیات فروشگاه" };
}

export default async function ShopPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!SHOP_ID.test(id)) notFound();
  const db = getReadDbOrNull();
  if (!db) return <DataUnavailable />;
  const found = getShop(db, id);
  if (!found) notFound();
  const { shop } = found;

  const back = safeSellersBack(first(sp.back));
  const productId = PRODUCT_ID.test(first(sp.product) ?? "") ? first(sp.product) : null;
  const variantId = first(sp.variant);
  const match = productId ? findSellersForProduct(db, { productId, variantGroupId: variantId, origin: null, showUncertain: true, onlyShopId: id, pageSize: 1 }) : null;
  const seller = match?.sellers[0] ?? null;

  const status = hoursLabel(evaluateHours(shop.hours, new Date()).status);
  const rows = hoursTable(shop.hours);
  const website = safeShopLink("website", shop.contactChannels.find((c) => c.kind === "website")?.value);
  const instagram = safeShopLink("instagram", shop.contactChannels.find((c) => c.kind === "instagram")?.value);
  const mapLink = Number.isFinite(shop.location.lat) ? externalMapLink(shop.location.lat, shop.location.lon) : null;

  return (
    <>
      <PageHeader eyebrow="فروشگاه" title={shop.name}>
        {shop.locationLabel ? `محله‌ی ثبت‌شده در داده: ${shop.locationLabel}. ` : ""}همه‌ی اطلاعات زیر از داده‌ی هکاتون است و اعلام‌شده‌ی خود فروشگاه حساب می‌شود، نه تأییدشده.
      </PageHeader>
      <nav aria-label="مسیر" className="mb-4 flex flex-wrap gap-3 text-sm">
        {back ? <Link href={back} className="inline-flex items-center gap-1 text-brand hover:underline"><ArrowRight aria-hidden size={14} />{back.startsWith("/compare") ? "بازگشت به مقایسه" : "بازگشت به فروشنده‌های اطراف"}</Link> : null}
        {productId ? <Link href={`/products/${productId}`} className="text-brand hover:underline">صفحه‌ی محصول</Link> : null}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-5">
          {productId ? (
            seller ? (
              <section aria-labelledby="prod-h" className="space-y-3" data-testid="shop-product-offers">
                <h2 id="prod-h" className="font-bold">پیشنهادهای ثبت‌شده‌ی این فروشگاه برای همین محصول</h2>
                <ul><SellerCard seller={seller} detailHref={buildShopHref(id, { product: productId, variant: variantId })} handoffHref={`/compare?${new URLSearchParams({ product: productId, ...(variantId ? { variant: variantId } : {}), shop: id }).toString()}`} selected={false} inquiryHref={buildMissionHref({ product: productId, variant: variantId, shop: id, offer: seller.offerIds.length === 1 ? seller.offerIds[0] : null })} /></ul>
              </section>
            ) : (
              <p role="status" data-testid="shop-no-offer" className="flex gap-2 rounded-2xl bg-warn-bg p-3 text-sm leading-7 text-warn-ink"><TriangleAlert aria-hidden size={18} className="mt-1 shrink-0" />این فروشگاه برای محصول انتخابی هیچ پیشنهاد ثبت‌شده‌ای ندارد؛ نمایش آن فقط به‌خاطر فعالیت در همین دسته است.</p>
            )
          ) : null}

          <Card className="space-y-3" aria-labelledby="hours-h">
            <h2 id="hours-h" className="flex items-center gap-2 font-bold"><Clock aria-hidden size={18} />ساعت کاری اعلام‌شده</h2>
            <p className="text-sm"><Badge tone={status.tone === "ok" ? "ok" : status.tone === "warn" ? "warn" : "neutral"}>{status.text}</Badge></p>
            <table className="w-full text-sm" data-testid="hours-table">
              <caption className="sr-only">ساعت کاری هفتگی طبق اعلام فروشگاه (به وقت تهران)</caption>
              <tbody>{rows.map((r) => (
                <tr key={r.day} className="border-t border-line"><th scope="row" className="py-2 pe-3 text-start font-medium">{r.label}</th><td className={r.known ? "" : "text-ink-2"}>{r.text}</td></tr>
              ))}</tbody>
            </table>
            <p className="text-xs leading-6 text-ink-2">ساعت‌ها به وقت تهران و طبق اعلام فروشگاه‌اند. «اعلام نشده» به معنی بسته بودن نیست؛ ساعت <bdi dir="ltr">۰۰:۰۰ تا ۰۰:۰۰</bdi> در داده جای‌نگهدار است و باز بودن شبانه‌روزی حساب نمی‌شود.</p>
          </Card>

          <Card className="space-y-3" aria-labelledby="pay-h">
            <h2 id="pay-h" className="flex items-center gap-2 font-bold"><CreditCard aria-hidden size={18} />پرداخت</h2>
            {shop.payment.declared && shop.payment.providers.length > 0 ? (
              <ul className="flex flex-wrap gap-2">{shop.payment.providers.map((p) => <li key={p.providerName}><Badge tone="neutral">{p.providerName}{p.channel === "in_person" ? " (حضوری)" : p.channel === "online" ? " (آنلاین)" : ""}</Badge></li>)}</ul>
            ) : <p className="text-sm text-ink-2">روش پرداخت اعلام نشده است (اعلام‌نشده به معنی پشتیبانی‌نشده نیست).</p>}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card className="space-y-3" aria-labelledby="loc-h">
            <h2 id="loc-h" className="flex items-center gap-2 font-bold"><MapPin aria-hidden size={18} />نشانی و موقعیت</h2>
            <p className="text-sm leading-7" data-testid="shop-address">{shop.address ? <bdi>{shop.address}</bdi> : "نشانی ثبت نشده است."}</p>
            {Number.isFinite(shop.location.lat) ? <ShopMiniMap shop={{ id, name: shop.name, lat: shop.location.lat, lon: shop.location.lon }} /> : <p className="text-sm text-ink-2">مختصات معتبری برای نقشه ثبت نشده است.</p>}
            <p className="flex gap-2 text-xs leading-6 text-ink-2"><Info aria-hidden size={14} className="mt-1 shrink-0" />مختصات از داده‌ی هکاتون است و ممکن است در سطح پاساژ یا ساختمان باشد، نه دقیقاً واحد این فروشگاه.</p>
            {mapLink ? <a href={mapLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-brand hover:underline"><ExternalLink aria-hidden size={14} />باز کردن در OpenStreetMap<span className="sr-only"> (پنجره‌ی جدید)</span></a> : null}
          </Card>

          <Card className="space-y-3" aria-labelledby="contact-h">
            <h2 id="contact-h" className="font-bold">راه‌های عمومی (اعلام‌شده)</h2>
            {website || instagram ? (
              <ul className="space-y-1 text-sm">
                {website ? <li><a href={website.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-1.5 text-brand hover:underline" dir="ltr"><ExternalLink aria-hidden size={14} />وب‌سایت: {website.label}</a></li> : null}
                {instagram ? <li><a href={instagram.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-1.5 text-brand hover:underline" dir="ltr"><ExternalLink aria-hidden size={14} />Instagram: {instagram.label}</a></li> : null}
              </ul>
            ) : <p className="text-sm text-ink-2">وب‌سایت یا اینستاگرام معتبری ثبت نشده است.</p>}
            <Badge tone="warn">راه ارتباطی تأییدشده در داده‌ها موجود نیست</Badge>
            <p className="text-xs leading-6 text-ink-2">شماره‌ی تلفن‌های دیتاست ساختگی‌اند، پس نمایش یا تماس داده نمی‌شوند. پیام‌رسانی با فروشنده در این نسخه فقط پیش‌نویس است و چیزی ارسال نمی‌شود.</p>
          </Card>

          <Card className="space-y-2">
            <h2 className="font-bold">دسته‌های اعلام‌شده</h2>
            {shop.categoryNames.length ? <ul className="flex flex-wrap gap-1.5">{shop.categoryNames.slice(0, 12).map((c) => <li key={c}><Badge tone="neutral">{c}</Badge></li>)}</ul> : <p className="text-sm text-ink-2">دسته‌ای ثبت نشده است.</p>}
            <p className="text-xs leading-6 text-ink-2">{shop.hasAnyOffer ? "این فروشگاه در داده پیشنهاد ثبت‌شده دارد." : "این فروشگاه در داده هیچ پیشنهادی ثبت نکرده است."} فعال بودن در یک دسته به معنی داشتن کالای مشخص نیست{shop.categoryNames.length > 12 ? ` (${toFaDigits(shop.categoryNames.length - 12)} دسته‌ی دیگر نمایش داده نشد)` : ""}.</p>
          </Card>
          {!productId ? <ButtonLink href="/discover" variant="secondary">انتخاب محصول</ButtonLink> : null}
        </div>
      </div>
    </>
  );
}
