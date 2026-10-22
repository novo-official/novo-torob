import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Info, Store, TriangleAlert } from "lucide-react";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { PriceLine } from "@/components/catalog/price-line";
import { ProductImage } from "@/components/catalog/product-image";
import { CompareToggle } from "@/components/catalog/compare-store";
import { ExternalEvidencePanel } from "@/components/product/external-evidence";
import { VariantPicker } from "@/components/product/variant-picker";
import { Badge, ButtonLink, Card, Ltr } from "@/components/ui";
import { safeBackHref } from "@/lib/advisor-url";
import { FLAG_SHORT } from "@/lib/flag-labels";
import { formatToman, toFaDigits } from "@/lib/format";
import { getProductDetail } from "@/server/catalog/detail";
import { getReadDbOrNull } from "@/server/db/safe";

export const dynamic = "force-dynamic";
const ID = /^product_[0-9a-f]{8,40}$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const REDACTED = "عنوان حذف‌شده برای انتشار";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = getReadDbOrNull();
  const d = db && ID.test(id) ? getProductDetail(db, id) : null;
  return { title: d && d.card.title !== REDACTED ? d.card.title.slice(0, 60) : "جزئیات محصول" };
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!ID.test(id)) notFound();
  const db = getReadDbOrNull();
  if (!db) return <DataUnavailable />;
  const d = getProductDetail(db, id);
  if (!d) notFound();

  const back = safeBackHref(first(sp.from));
  const variantId = first(sp.variant);
  const variant = d.variantGroups.find((g) => g.id === variantId) ?? null;
  const bmin = first(sp.bmin);
  const bmax = first(sp.bmax);
  const sellers = new URLSearchParams({ product: id });
  if (variant) sellers.set("variant", variant.id);
  if (bmin && /^\d{1,13}$/.test(bmin)) sellers.set("bmin", bmin);
  if (bmax && /^\d{1,13}$/.test(bmax)) sellers.set("bmax", bmax);
  if (back) sellers.set("back", back);

  const c = d.card;
  const redacted = c.title === REDACTED || !c.title;
  const sections = [...new Set(d.specs.map((s) => s.section || "مشخصات"))];
  const ex = c.price.excluded;
  const exTotal = Object.values(ex).reduce((n, v) => n + v, 0);

  return (
    <article className="space-y-6">
      {back ? <Link href={back} className="inline-flex min-h-11 items-center gap-1 text-sm text-brand hover:underline"><ArrowRight aria-hidden size={16} />بازگشت به نتایج (ترجیحات حفظ شده است)</Link> : null}

      <header className="grid gap-5 rounded-2xl border border-line bg-surface p-5 shadow-sm md:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="space-y-2">
          <ProductImage src={d.images[0] ?? null} alt={redacted ? "" : c.title} className="mx-auto aspect-square w-48 rounded-xl bg-surface-2 md:w-full" />
          {d.images.length > 1 ? <ul className="flex justify-center gap-2">{d.images.slice(1, 5).map((u) => <li key={u}><ProductImage src={u} className="size-16 rounded-lg border border-line" /></li>)}</ul> : null}
        </div>
        <div className="flex flex-col justify-between gap-3">
          <div className="space-y-2.5">
            <Badge tone="brand">{c.categoryName}</Badge>
            <h1 className="text-2xl font-extrabold leading-9 text-ink"><bdi>{redacted ? "عنوان این محصول در داده حذف شده است" : c.title}</bdi></h1>
            <p className="text-sm text-ink-2">
              {c.brandName ? <>برند: <strong className="text-ink">{c.brandName}</strong> · </> : "برند ثبت نشده · "}
              {c.model ? <>مدل: <Ltr className="font-semibold text-ink">{c.model}</Ltr></> : "مدل ثبت نشده"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <CompareToggle id={c.id} title={redacted ? c.categoryName : c.title} />
            <ButtonLink href={`/sellers?${sellers.toString()}`} className="min-h-11">
              <Store aria-hidden size={16} />
              مشاهده فروشنده‌های اطراف
            </ButtonLink>
          </div>
        </div>
      </header>

      <Card className="space-y-3" aria-labelledby="price-h">
        <h2 id="price-h" className="font-bold">قیمت ثبت‌شده</h2>
        <PriceLine price={c.price} detail className="text-lg" />
        <ul className="list-disc space-y-1 ps-5 text-sm leading-7 text-ink-2">
          <li>این‌ها قیمت‌های <strong>ثبت‌شده</strong> در دیتاست‌اند، نه قیمت امروز و نه تضمین موجودی.</li>
          {c.price.staleShare !== null && c.price.staleShare >= 0.5 ? <li>بیشتر این قیمت‌ها بیش از ۹۰ روز پیش از زمان داده ثبت شده‌اند.</li> : null}
          {exTotal > 0 ? <li>{toFaDigits(exTotal)} مورد از پیشنهادها (به‌دلیل پرت بودن، تکراری بودن یا احتمال نسخه‌ی دیگر) در این بازه حساب نشد.</li> : null}
          {c.price.pricedOffers < c.price.totalOffers ? <li>{toFaDigits(c.price.totalOffers - c.price.pricedOffers)} پیشنهاد اصلاً قیمت ندارد.</li> : null}
          {c.price.unitHint === "unknown" ? <li>واحد قیمت در عنوان فروشنده‌ها ذکر نشده؛ پیش از خرید واحد (عدد، متر، حلقه) را بپرسید.</li> : null}
        </ul>
      </Card>

      <section aria-labelledby="variant-h" className="space-y-3">
        <h2 id="variant-h" className="font-bold">نسخه‌ی دقیق</h2>
        {d.needsVariantConfirmation ? (
          <div role="alert" className="flex gap-2 rounded-2xl bg-warn-bg p-3 text-sm leading-7 text-warn-ink">
            <TriangleAlert aria-hidden size={18} className="mt-1 shrink-0" />
            <p>پیشنهادهای این محصول لزوماً یک کالای یکسان نیستند (کد مدل یا واحد قیمت متفاوت). پیش از مقایسه‌ی فروشنده‌ها نسخه‌ی مورد نظر را انتخاب کنید.</p>
          </div>
        ) : (
          <p className="flex items-start gap-2 text-sm text-ink-2"><Info aria-hidden size={16} className="mt-1 shrink-0" />بر پایه‌ی عنوان پیشنهادها، همه‌ی آن‌ها یک گروه نسخه هستند؛ این برداشت از عنوان است و تضمین نیست.</p>
        )}
        {d.variantGroups.length > 0 ? <VariantPicker groups={d.variantGroups} selected={variant?.id ?? null} /> : <p className="text-sm text-ink-2">برای این محصول پیشنهادی ثبت نشده است.</p>}
      </section>

      <Card className="space-y-3">
        <h2 className="font-bold">گام بعد: فروشنده‌های اطراف</h2>
        <p className="text-sm leading-7 text-ink-2">نسخه‌ی انتخابی{variant ? <> ( <bdi>{variant.label}</bdi> )</> : " (هنوز انتخاب نشده)"} به گام فروشنده‌ها منتقل می‌شود. فقط فروشگاه‌هایی نشان داده می‌شوند که برای همین محصول پیشنهاد ثبت کرده‌اند؛ موجودی هرگز تأیید‌شده نیست.</p>
        <ButtonLink href={`/sellers?${sellers.toString()}`}><Store aria-hidden size={18} />مشاهده فروشنده‌ها</ButtonLink>
      </Card>

      {d.specs.length > 0 ? (
        <section aria-labelledby="spec-h" className="space-y-3">
          <h2 id="spec-h" className="font-bold">مشخصات ثبت‌شده</h2>
          {sections.map((sec) => (
            <details key={sec} open={sections.length === 1 || sec === sections[0]} className="rounded-2xl border border-line bg-surface">
              <summary className="min-h-11 cursor-pointer px-4 py-2.5 font-semibold">{sec}</summary>
              <dl className="grid gap-x-4 px-4 pb-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
                {d.specs.filter((s) => (s.section || "مشخصات") === sec).slice(0, 40).flatMap((s, i) => [
                  <dt key={`k${i}`} className="border-t border-line pt-2 text-sm text-ink-2">{s.key}</dt>,
                  <dd key={`v${i}`} className="pb-2 text-sm sm:border-t sm:border-line sm:pt-2"><bdi>{s.value}</bdi></dd>,
                ])}
              </dl>
            </details>
          ))}
        </section>
      ) : <p className="text-sm text-ink-2">مشخصاتی برای این محصول ثبت نشده است.</p>}

      <ExternalEvidencePanel productId={id} />

      {d.offers.length > 0 ? (
        <section aria-labelledby="offers-h" className="space-y-3">
          <h2 id="offers-h" className="font-bold">نمونه‌ی پیشنهادهای ثبت‌شده <span className="text-sm font-normal text-ink-2">(عنوان خام فروشنده؛ {toFaDigits(d.offersShown)} مورد از {toFaDigits(c.offerCount)})</span></h2>
          <ul className="space-y-2">
            {d.offers.map((o) => (
              <li key={o.offerId} className="rounded-2xl border border-line bg-surface p-3 text-sm">
                <p className="leading-7"><bdi>{o.sellerTitle}</bdi></p>
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.priceToman !== null ? formatToman(o.priceToman) : o.priceRaw && o.priceRaw !== "null" ? `قیمت خام: ${o.priceRaw}` : "بدون قیمت"}</span>
                  {o.flags.filter((f) => FLAG_SHORT[f.code]).map((f) => <Badge key={f.code} tone={FLAG_SHORT[f.code]!.tone} title={f.reason}>{FLAG_SHORT[f.code]!.text}</Badge>)}
                  {o.comparisonEligible ? <Badge tone="ok">در بازه‌ی قابل مقایسه</Badge> : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
