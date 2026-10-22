import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Compass, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { ProductCardView } from "@/components/catalog/product-card";
import { SearchBox } from "@/components/search/search-box";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { QUICK_STARTS } from "@/lib/constants";
import { clip, toFaDigits } from "@/lib/format";
import { getReadDbOrNull } from "@/server/db/safe";
import { SEARCH_LIMITS, searchCatalog } from "@/server/search/search";
import styles from "./search.module.css";

export const metadata: Metadata = { title: "جست‌وجوی مدل" };
// Keep the initial catalog in server HTML: route-level loading would hide streamed results without JavaScript.
// Subsequent searches expose pending state through SearchBox.useTransition.
export const dynamic = "force-dynamic";
const PAGE = 12;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = clip(first(sp.q), 120);
  const cat = clip(first(sp.cat), 120) || null;
  const offset = Math.min(SEARCH_LIMITS.offsetMax, Math.max(0, Math.trunc(Number(first(sp.offset)) || 0)));
  const db = getReadDbOrNull();
  const res = db && q ? searchCatalog(db, { q, category: cat, limit: PAGE, offset, facets: true }) : null;
  const href = (o: number, c: string | null = cat) => `/search?${new URLSearchParams({ q, ...(c ? { cat: c } : {}), ...(o ? { offset: String(o) } : {}) })}`;

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={!q ? "گام اول · پیدا کردن محصول" : undefined} title="جست‌وجوی مدل یا نام کالا">
        {!q ? "از نام کالا یا کد مدل شروع کنید؛ سپس نسخهٔ دقیق و فروشنده‌ها را بررسی کنید." : null}
      </PageHeader>
      <div className={`${styles.searchPanel} ${q ? styles.withResults : ""}`}>
        <SearchBox key={JSON.stringify([q, cat])} defaultValue={q} category={cat} compact={!!q} />
        <aside className={styles.guide} aria-label="کمک برای انتخاب محصول">
          <span className={styles.guideIcon}><Compass aria-hidden size={21} /></span>
          <div><p>هنوز مدل را انتخاب نکرده‌اید؟</p><Link href={q ? `/discover?text=${encodeURIComponent(q)}` : "/discover"}>با نیازتان شروع کنید<ArrowLeft aria-hidden size={15} /></Link></div>
        </aside>
      </div>

      {!db ? <DataUnavailable /> : null}
      {db && !q ? <section aria-labelledby="search-start-title" className={styles.start}>
        <div className={styles.startHeading}><Search aria-hidden size={23} /><h2 id="search-start-title">چه چیزی را می‌خواهید پیدا کنید؟</h2><p>اسم کالا را بنویسید یا یکی از مثال‌ها را امتحان کنید.</p></div>
        <ul className={styles.examples}>{QUICK_STARTS.map((item) => <li key={item.q}><Link href={`/search?q=${encodeURIComponent(item.q)}`}><Search aria-hidden size={15} />{item.label}<ArrowLeft aria-hidden size={14} /></Link></li>)}</ul>
        <p className={styles.startHint}>برای انتخاب بر اساس کاربرد و بودجه، <Link href="/discover">از راهنمای انتخاب کمک بگیرید.</Link></p>
      </section> : null}

      {res ? <section aria-labelledby="search-results-title" className={styles.results}>
        <header className={styles.resultsHeader}>
          <div><h2 id="search-results-title">نتیجه‌های «<bdi>{clip(q, 70)}</bdi>»</h2>
            <p role="status">{res.items.length ? `نمایش ${toFaDigits(offset + 1)} تا ${toFaDigits(offset + res.items.length)} · بر اساس ارتباط با عبارت` : "نتیجه‌ای در این صفحه نمایش داده نمی‌شود"}</p>
          </div>
          {cat ? <Link href={href(0, null)} className={styles.activeFilter} aria-label={`دسته: ${cat}؛ حذف فیلتر دسته`}><SlidersHorizontal aria-hidden size={14} />دسته: {cat}<X aria-hidden size={14} /></Link> : null}
        </header>

        {res.corrections.length ? <p className={styles.correction}>املای «{res.corrections.map((c) => c.from).join("، ")}» اصلاح شد و با «{res.corrections.map((c) => c.to).join("، ")}» هم جست‌وجو شد.</p> : null}
        {res.strategy === "partial" ? <p role="status" className={styles.partial}>محصولی با همهٔ کلمه‌ها پیدا نشد؛ نتایج زیر فقط بخشی از کلمه‌ها را دارند.</p> : null}

        {res.categoryFacets.length > 1 ? <nav aria-label="فیلتر دسته‌های جست‌وجو" className={styles.filters}>
          <span><SlidersHorizontal aria-hidden size={15} />دسته‌های مرتبط:</span>
          {res.categoryFacets.slice(0, 5).map((facet) => <Link key={facet.category} href={href(0, facet.category)} aria-current={cat === facet.category ? "true" : undefined} className={cat === facet.category ? styles.selectedCategory : undefined}>{facet.category}<span>{toFaDigits(facet.count)}</span></Link>)}
        </nav> : null}

        {res.items.length === 0 ? <EmptyState icon={<SearchX size={24} />} title={offset > 0 ? "در این صفحه نتیجه‌ای نیست" : res.valid ? "نتیجه‌ای پیدا نشد" : "عبارت کافی نیست"}
          action={<>
            {offset > 0 ? <ButtonLink href={href(0)}>برگشت به اولین نتایج</ButtonLink> : null}
            {cat ? <ButtonLink href={href(0, null)} variant="secondary">جست‌وجو در همه‌ی دسته‌ها</ButtonLink> : null}
            <ButtonLink href={`/discover?text=${encodeURIComponent(q)}`} variant={offset > 0 ? "secondary" : "primary"}>کمکم کن انتخاب کنم</ButtonLink>
            {res.valid && offset === 0 ? <ButtonLink href={`/sellers?category=${encodeURIComponent(q)}`} variant="secondary" data-testid="area-recovery-link">مناطق خرید پیشنهادی برای «{clip(q, 40)}»</ButtonLink> : null}
          </>}>
          <p>{offset > 0 ? "ممکن است به انتهای نتایج رسیده باشید. عبارت و دستهٔ شما حفظ می‌شود." : res.recovery?.message}</p>
          {offset === 0 && res.valid ? <p className="mt-2">پیدا نشدن در این کاتالوگ، به معنی نبودن کالا در بازار نیست.</p> : null}
        </EmptyState> : <>
          <ol className={styles.list} aria-label="محصولات پیدا‌شده">
            {res.items.map((item) => <li key={item.card.id}><ProductCardView card={item.card} href={`/products/${item.card.id}?from=${encodeURIComponent(href(offset))}`} matchNote={item.match === "exact_model" ? "تطبیق مدل" : item.match === "offer_model" ? "مدل فقط در عنوان پیشنهادها" : item.match === "partial" ? "تطبیق جزئی" : undefined} /></li>)}
          </ol>
          <nav aria-label="صفحه‌بندی" className={styles.pagination}>
            {offset > 0 ? <ButtonLink href={href(Math.max(0, offset - PAGE))} variant="secondary"><ArrowRight aria-hidden size={16} />قبلی</ButtonLink> : <span />}
            <p>صفحهٔ {toFaDigits(Math.floor(offset / PAGE) + 1)}{res.hasMore ? <span>نتایج بیشتری هم هست</span> : null}</p>
            {res.hasMore ? <ButtonLink href={href(offset + PAGE)} variant="secondary">بعدی<ArrowLeft aria-hidden size={16} /></ButtonLink> : <span />}
          </nav>
          <p className={styles.footnote}>قیمت‌ها ثبت‌شده‌اند و تضمین قیمت امروز یا موجودی نیستند؛ نسخهٔ دقیق را پیش از مقایسه بررسی کنید.</p>
        </>}

        {res.expansions.length || res.droppedStopWords.length ? <details className={styles.matchDetails}>
          <summary>نحوهٔ تطبیق عبارت جست‌وجو</summary>
          {res.expansions.length ? <p>با کلمه‌های هم‌معنی هم جست‌وجو شد: {res.expansions.map((e) => `${e.from} ← ${e.to.slice(0, 3).join("، ")}`).join("؛ ")}</p> : null}
          {res.droppedStopWords.length ? <p>کلمه‌های عمومی نادیده گرفته شد: {res.droppedStopWords.join("، ")}</p> : null}
        </details> : null}
      </section> : null}
    </div>
  );
}
