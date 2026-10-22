import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { ProductCardView } from "@/components/catalog/product-card";
import { SearchBox } from "@/components/search/search-box";
import { Badge, ButtonLink, EmptyState, Ltr, PageHeader } from "@/components/ui";
import { clip, toFaDigits } from "@/lib/format";
import { getReadDbOrNull } from "@/server/db/safe";
import { searchCatalog } from "@/server/search/search";

export const metadata: Metadata = { title: "جست‌وجوی مدل" };
export const dynamic = "force-dynamic";
const PAGE = 12;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = clip(first(sp.q), 120);
  const cat = clip(first(sp.cat), 120) || null;
  const offset = Math.min(500, Math.max(0, Number(first(sp.offset)) || 0));
  const db = getReadDbOrNull();
  const res = db && q ? searchCatalog(db, { q, category: cat, limit: PAGE, offset, facets: offset === 0 }) : null;
  const href = (o: number, c: string | null = cat) => `/search?q=${encodeURIComponent(q)}${c ? `&cat=${encodeURIComponent(c)}` : ""}${o ? `&offset=${o}` : ""}`;

  return (
    <>
      <PageHeader eyebrow="مسیر سریع — مدل را می‌شناسم" title="جست‌وجوی مدل یا نام کالا">
        نام فارسی یا لاتین، مدل کامل یا بخشی از آن (مثل <Ltr>HDW1200CLQP</Ltr>) را بنویسید. نتیجه‌ها از کاتالوگ واقعی می‌آیند.
      </PageHeader>
      <div className="mb-6 max-w-2xl"><SearchBox defaultValue={q} category={cat} /></div>

      {!db ? <DataUnavailable /> : null}

      {db && !q ? (
        <EmptyState icon={<Search size={22} />} title="نام یا مدل کالا را بنویسید">
          <p>نمی‌دانید چه مدلی بخرید؟ از مشاور استفاده کنید.</p>
          <div className="mt-2"><ButtonLink href="/discover">کمکم کن انتخاب کنم</ButtonLink></div>
        </EmptyState>
      ) : null}

      {res ? (
        <section aria-live="polite" aria-label="نتایج جست‌وجو" className="space-y-4">
          {res.corrections.length ? <p className="rounded-xl bg-brand-soft p-3 text-sm text-brand-soft-ink">املای «{res.corrections.map((c) => c.from).join("، ")}» اصلاح شد و با «{res.corrections.map((c) => c.to).join("، ")}» هم جست‌وجو شد.</p> : null}
          {res.expansions.length ? <p className="text-xs text-ink-2">با کلمه‌های هم‌معنی هم جست‌وجو شد: {res.expansions.map((e) => `${e.from} ⇢ ${e.to.slice(0, 3).join("، ")}`).join(" ؛ ")}</p> : null}
          {res.droppedStopWords.length ? <p className="text-xs text-ink-2">کلمه‌های عمومی نادیده گرفته شد: {res.droppedStopWords.join("، ")}</p> : null}
          {res.strategy === "partial" ? <p role="status" className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">محصولی با همه‌ی کلمه‌ها پیدا نشد؛ نتایج زیر فقط بخشی از کلمه‌ها را دارند.</p> : null}

          {offset === 0 && res.categoryFacets.length > 1 && !cat ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-2">محدود به دسته:</span>
              {res.categoryFacets.slice(0, 5).map((f) => <Link key={f.category} href={href(0, f.category)} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-3 hover:border-brand">{f.category} <span className="ms-1 text-xs text-ink-2">({toFaDigits(f.count)})</span></Link>)}
            </div>
          ) : null}
          {cat ? <p className="text-sm"><Badge tone="brand">دسته: {cat}</Badge> <Link href={href(0, null)} className="ms-2 text-brand underline underline-offset-2">همه‌ی دسته‌ها</Link></p> : null}

          {res.items.length === 0 ? (
            <EmptyState icon={<Search size={22} />} title={res.valid ? "نتیجه‌ای پیدا نشد" : "عبارت کافی نیست"}>
              <p>{res.recovery?.message}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {cat ? <ButtonLink href={href(0, null)} variant="secondary">جست‌وجو در همه‌ی دسته‌ها</ButtonLink> : null}
                <ButtonLink href={q ? `/discover?text=${encodeURIComponent(q)}` : "/discover"}>کمکم کن انتخاب کنم</ButtonLink>
                {res.valid && q ? <ButtonLink href={`/sellers?category=${encodeURIComponent(q)}`} variant="secondary" data-testid="area-recovery-link">مناطق خرید پیشنهادی برای «{clip(q, 40)}»</ButtonLink> : null}
              </div>
            </EmptyState>
          ) : (
            <ol className="space-y-4">
              {res.items.map((it) => (
                <li key={it.card.id}>
                  <ProductCardView card={it.card} href={`/products/${it.card.id}?from=${encodeURIComponent(href(offset))}`} matchNote={it.match === "exact_model" ? "تطبیق مدل" : it.match === "offer_model" ? "مدل فقط در عنوان پیشنهادها" : it.match === "partial" ? "تطبیق جزئی" : undefined} />
                </li>
              ))}
            </ol>
          )}
          <nav aria-label="صفحه‌بندی" className="flex justify-between gap-3">
            {offset > 0 ? <ButtonLink href={href(Math.max(0, offset - PAGE))} variant="secondary">قبلی</ButtonLink> : <span />}
            {res.hasMore ? <ButtonLink href={href(offset + PAGE)} variant="secondary">بعدی</ButtonLink> : null}
          </nav>
        </section>
      ) : null}
    </>
  );
}
