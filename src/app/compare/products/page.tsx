import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, GitCompareArrows } from "lucide-react";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { PriceLine } from "@/components/catalog/price-line";
import { ProductImage } from "@/components/catalog/product-image";
import { Badge, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { toFaDigits } from "@/lib/format";
import { compareProducts } from "@/server/advisor/compare";
import { getReadDbOrNull } from "@/server/db/safe";

export const metadata: Metadata = { title: "مقایسه‌ی محصولات" };
export const dynamic = "force-dynamic";
const IDS = /^product_[0-9a-f]{8,40}(,product_[0-9a-f]{8,40}){1,3}$/;

export default async function CompareProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.ids) ? sp.ids[0] : sp.ids;
  const db = getReadDbOrNull();
  const res = db && raw && IDS.test(raw) ? compareProducts(db, raw.split(",")) : null;

  return (
    <>
      <PageHeader eyebrow="گام ۱ — مقایسه‌ی محصولات" title="مقایسه‌ی محصولات کنار هم">تفاوت‌ها فقط از مشخصات و قیمت ثبت‌شده در داده می‌آید؛ امتیاز کیفیت یا نظر کاربران وجود ندارد.</PageHeader>
      {!db ? <DataUnavailable /> : null}
      {db && !res ? (
        <EmptyState icon={<GitCompareArrows size={22} />} title="دو تا چهار محصول برای مقایسه انتخاب کنید" action={<><ButtonLink href="/discover">کمکم کن انتخاب کنم</ButtonLink><ButtonLink href="/search" variant="secondary">جست‌وجوی مدل</ButtonLink></>}>
          <p>در فهرست نتایج روی «مقایسه» بزنید؛ انتخاب‌ها تا بستن تب حفظ می‌شود.</p>
        </EmptyState>
      ) : null}
      {res ? (
        <div className="space-y-6">
          <Link href="/discover?show=1" className="inline-flex min-h-11 items-center gap-1 text-sm text-brand hover:underline"><ArrowRight aria-hidden size={16} />بازگشت</Link>
          <ul className={`grid gap-3 ${res.products.length > 2 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`} aria-label="محصولات مقایسه‌شده">
            {res.products.map((p) => (
              <li key={p.card.id} className="space-y-2 rounded-2xl border border-line bg-surface p-3">
                <ProductImage src={p.card.imageUrl} className="mx-auto size-24" />
                <h2 className="text-sm font-bold leading-6"><Link href={`/products/${p.card.id}`} className="hover:text-brand"><bdi>{p.card.title}</bdi></Link></h2>
                <PriceLine price={p.card.price} className="text-sm" />
                <div className="flex flex-wrap gap-1">
                  {p.card.variants.modelMismatch > 0 ? <Badge tone="warn">نسخه‌ی مشابه ولی متفاوت</Badge> : null}
                  {p.card.variants.unitAmbiguous > 0 ? <Badge tone="warn">واحد قیمت نامشخص</Badge> : null}
                  <Badge>{toFaDigits(p.card.distinctSellers)} فروشنده</Badge>
                </div>
              </li>
            ))}
          </ul>

          {res.products.some((p) => p.attributes.length) ? (
            <section aria-labelledby="attr-h" className="space-y-3">
              <h2 id="attr-h" className="font-bold">ویژگی‌های کلیدی (با شاهد)</h2>
              <ComparisonTable heads={res.products.map((p) => p.card.title)} rows={(res.products[0]?.attributes ?? []).map((a, i) => ({ key: a.id, label: a.label, values: res.products.map((p) => { const x = p.attributes[i]!; return x.value === null ? null : x.confidence === "inferred" ? `${x.value} (استنباطی)` : x.value; }), differs: new Set(res.products.map((p) => p.attributes[i]?.value ?? "؟")).size > 1 }))} />
            </section>
          ) : null}

          <section aria-labelledby="spec-h" className="space-y-3">
            <h2 id="spec-h" className="font-bold">مشخصات ثبت‌شده</h2>
            <ComparisonTable heads={res.products.map((p) => p.card.title)} rows={res.specRows} />
          </section>
          <ul className="list-disc space-y-1 ps-5 text-sm leading-7 text-ink-2">{res.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      ) : null}
    </>
  );
}

function ComparisonTable({ heads, rows }: { heads: string[]; rows: Array<{ key: string; label: string; values: Array<string | null>; differs: boolean }> }) {
  return (
    <>
      {/* narrow screens: one block per row, values labelled by product number (no horizontal page scroll) */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.key} className={`rounded-xl border p-3 text-sm ${r.differs ? "border-brand bg-brand-soft/40" : "border-line bg-surface"}`}>
            <p className="font-semibold">{r.label}{r.differs ? <Badge tone="brand" className="ms-2">متفاوت</Badge> : null}</p>
            <ol className="mt-1 space-y-0.5">{r.values.map((v, i) => <li key={i} className="flex gap-2"><span className="shrink-0 text-ink-2">محصول {toFaDigits(i + 1)}:</span><span>{v === null ? <span className="text-ink-2">ثبت نشده</span> : <bdi>{v}</bdi>}</span></li>)}</ol>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-2xl border border-line md:block">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">جدول مقایسه</caption>
          <thead><tr className="bg-surface-2"><th scope="col" className="p-3 text-start">ویژگی</th>{heads.map((h, i) => <th key={i} scope="col" className="p-3 text-start font-semibold">محصول {toFaDigits(i + 1)}<span className="block max-w-[14rem] truncate text-xs font-normal text-ink-2"><bdi>{h}</bdi></span></th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key} className={r.differs ? "bg-brand-soft/40" : ""}><th scope="row" className="border-t border-line p-3 text-start font-medium">{r.label}</th>{r.values.map((v, i) => <td key={i} className="border-t border-line p-3">{v === null ? <span className="text-ink-2">ثبت نشده</span> : <bdi>{v}</bdi>}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
