"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, Check, GitCompareArrows, SlidersHorizontal, X } from "lucide-react";
import type { CompareResponse } from "@/domain/advisor";
import { PriceLine } from "@/components/catalog/price-line";
import { ProductImage } from "@/components/catalog/product-image";
import { Badge } from "@/components/ui";
import { toFaDigits } from "@/lib/format";

function shortTitle(title: string): string {
  const clean = title.replace(/^گوشی موبایل|^لپ‌تاپ|^هدفون و هندزفری|^دوربین/g, "").trim();
  const words = clean.split(/\s+/);
  return words.slice(0, 4).join(" ");
}

export function ProductsCompareView({ res, currentIds }: { res: CompareResponse; currentIds: string[] }) {
  const router = useRouter();
  const [onlyDiffs, setOnlyDiffs] = useState(false);

  const keyAttrRows = useMemo(() => {
    return (res.products[0]?.attributes ?? []).map((a, i) => {
      const values = res.products.map((p) => {
        const x = p.attributes[i];
        if (!x || x.value === null) return null;
        return x.confidence === "inferred" ? `${x.value} (استنباطی)` : x.value;
      });
      const known = values.filter((v): v is string => v !== null);
      const differs = new Set(known).size > 1 || (known.length > 0 && known.length < values.length);
      return { key: a.id, label: a.label, values, differs };
    });
  }, [res]);

  const visibleAttrRows = useMemo(() => {
    if (!onlyDiffs) return keyAttrRows;
    return keyAttrRows.filter((r) => r.differs);
  }, [keyAttrRows, onlyDiffs]);

  const visibleSpecRows = useMemo(() => {
    if (!onlyDiffs) return res.specRows;
    return res.specRows.filter((r) => r.differs);
  }, [res.specRows, onlyDiffs]);

  const totalDiffs = useMemo(() => {
    const attrDiffs = keyAttrRows.filter((r) => r.differs).length;
    const specDiffs = res.specRows.filter((r) => r.differs).length;
    return attrDiffs + specDiffs;
  }, [keyAttrRows, res.specRows]);

  const removeProduct = (id: string) => {
    const next = currentIds.filter((x) => x !== id);
    if (next.length >= 2) {
      router.push(`/compare/products?ids=${next.join(",")}`);
    } else {
      router.push("/compare/products");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/discover?show=1" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
          <ArrowRight aria-hidden size={16} />
          <span>بازگشت به انتخاب‌ها</span>
        </Link>
        <div className="flex items-center gap-2">
          {totalDiffs > 0 ? (
            <Badge tone="brand">
              {toFaDigits(totalDiffs)} مورد تفاوت در مشخصات
            </Badge>
          ) : null}
          <button
            type="button"
            aria-pressed={onlyDiffs}
            onClick={() => setOnlyDiffs((v) => !v)}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold transition-colors ${
              onlyDiffs
                ? "border-brand bg-brand-soft text-brand-soft-ink shadow-sm"
                : "border-line bg-surface text-ink-2 hover:bg-surface-2"
            }`}
          >
            <SlidersHorizontal aria-hidden size={14} />
            <span>فقط تفاوت‌ها</span>
            {onlyDiffs ? <Check aria-hidden size={14} className="text-brand" /> : null}
          </button>
        </div>
      </div>

      {/* Product Cards Row */}
      <ul
        className={`grid gap-4 ${res.products.length > 2 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`}
        aria-label="محصولات مقایسه‌شده"
      >
        {res.products.map((p, idx) => (
          <li
            key={p.card.id}
            className="relative flex flex-col justify-between space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-colors hover:border-brand"
          >
            <div className="space-y-2">
              <div className="relative">
                <ProductImage src={p.card.imageUrl} className="mx-auto size-28 rounded-xl object-contain" />
                <button
                  type="button"
                  aria-label={`حذف ${p.card.title} از مقایسه`}
                  onClick={() => removeProduct(p.card.id)}
                  className="absolute top-0 start-0 grid size-8 place-items-center rounded-full bg-surface-2 text-ink-2 hover:bg-danger-bg hover:text-danger-ink transition-colors"
                  title="حذف از مقایسه"
                >
                  <X aria-hidden size={16} />
                </button>
              </div>
              <p className="text-xs font-bold text-brand">
                محصول {toFaDigits(idx + 1)}
              </p>
              <h2 className="text-sm font-bold leading-6">
                <Link href={`/products/${p.card.id}`} className="hover:text-brand">
                  <bdi>{p.card.title}</bdi>
                </Link>
              </h2>
              <PriceLine price={p.card.price} className="text-sm" />
              <div className="flex flex-wrap gap-1">
                {p.card.variants.modelMismatch > 0 ? <Badge tone="warn">نسخه‌ی مشابه ولی متفاوت</Badge> : null}
                {p.card.variants.unitAmbiguous > 0 ? <Badge tone="warn">واحد قیمت نامشخص</Badge> : null}
                <Badge tone="neutral">{toFaDigits(p.card.distinctSellers)} فروشنده</Badge>
              </div>
            </div>
            <div className="pt-2 border-t border-line">
              <Link
                href={`/sellers?product=${p.card.id}`}
                className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-surface-2 text-xs font-semibold text-brand hover:bg-brand-soft transition-colors"
              >
                دیدن فروشندگان اطراف
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {/* Key Attributes */}
      {res.products.some((p) => p.attributes.length) ? (
        <section aria-labelledby="attr-h" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="attr-h" className="font-bold text-base flex items-center gap-2">
              <GitCompareArrows aria-hidden size={18} className="text-brand" />
              <span>ویژگی‌های کلیدی (با شاهد)</span>
            </h2>
            {onlyDiffs ? (
              <span className="text-xs text-ink-2">نمایش {toFaDigits(visibleAttrRows.length)} ویژگی متفاوت</span>
            ) : null}
          </div>
          {visibleAttrRows.length > 0 ? (
            <ComparisonTableComponent
              products={res.products}
              rows={visibleAttrRows}
            />
          ) : (
            <p className="rounded-xl border border-line bg-surface p-4 text-xs text-ink-2 text-center">
              هیچ تفاوتی در ویژگی‌های کلیدی این محصولات ثبت نشده است.
            </p>
          )}
        </section>
      ) : null}

      {/* Full Spec Rows */}
      <section aria-labelledby="spec-h" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="spec-h" className="font-bold text-base flex items-center gap-2">
            <GitCompareArrows aria-hidden size={18} className="text-brand" />
            <span>مشخصات ثبت‌شده در داده</span>
          </h2>
          {onlyDiffs ? (
            <span className="text-xs text-ink-2">نمایش {toFaDigits(visibleSpecRows.length)} مشخصه متفاوت</span>
          ) : null}
        </div>
        {visibleSpecRows.length > 0 ? (
          <ComparisonTableComponent
            products={res.products}
            rows={visibleSpecRows}
          />
        ) : (
          <p className="rounded-xl border border-line bg-surface p-4 text-xs text-ink-2 text-center">
            هیچ تفاوتی در مشخصات ثانویه این محصولات ثبت نشده است.
          </p>
        )}
      </section>

      {/* Disclaimers & Notes */}
      <ul className="list-disc space-y-1 ps-5 text-xs leading-7 text-ink-2">
        {res.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonTableComponent({
  products,
  rows,
}: {
  products: CompareResponse["products"];
  rows: Array<{ key: string; label: string; values: Array<string | null>; differs: boolean }>;
}) {
  return (
    <>
      {/* Mobile view: each spec is a card with clear product names (not just product numbers) */}
      <ul className="space-y-2.5 md:hidden">
        {rows.map((r) => (
          <li
            key={r.key}
            className={`rounded-2xl border p-3.5 text-sm transition-colors ${
              r.differs ? "border-brand/40 bg-brand-soft/25" : "border-line bg-surface"
            }`}
          >
            <div className="flex items-center justify-between gap-2 font-bold mb-2">
              <span>{r.label}</span>
              {r.differs ? <Badge tone="brand">متفاوت</Badge> : null}
            </div>
            <ol className="space-y-1.5 text-xs">
              {r.values.map((v, i) => (
                <li key={i} className="flex items-start gap-2 py-1 border-t border-line/60 first:border-t-0">
                  <span className="shrink-0 font-medium text-ink-2 min-w-24">
                    محصول {toFaDigits(i + 1)} ({shortTitle(products[i]?.card.title ?? "")}):
                  </span>
                  <span className="font-semibold text-ink">
                    {v === null ? <span className="text-ink-2 font-normal">ثبت نشده</span> : <bdi>{v}</bdi>}
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>

      {/* Desktop view: side-by-side table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block shadow-[var(--shadow-card)]">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">جدول مقایسه محصولات</caption>
          <thead>
            <tr className="bg-surface-2 border-b border-line">
              <th scope="col" className="p-3.5 text-start font-bold min-w-[10rem] sticky start-0 bg-surface-2 z-10">
                ویژگی
              </th>
              {products.map((p, i) => (
                <th key={p.card.id} scope="col" className="p-3.5 text-start font-semibold">
                  <span>محصول {toFaDigits(i + 1)}</span>
                  <span className="block max-w-[14rem] truncate text-xs font-normal text-ink-2">
                    <bdi>{p.card.title}</bdi>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={`border-t border-line ${r.differs ? "bg-brand-soft/20" : "hover:bg-surface-2/30"}`}>
                <th scope="row" className="p-3.5 text-start font-medium sticky start-0 bg-surface z-10 border-e border-line">
                  <span className="flex items-center gap-2">
                    <span>{r.label}</span>
                    {r.differs ? <Badge tone="brand" className="text-[10px]">متفاوت</Badge> : null}
                  </span>
                </th>
                {r.values.map((v, i) => (
                  <td key={i} className="p-3.5 text-ink leading-6">
                    {v === null ? <span className="text-ink-2">ثبت نشده</span> : <bdi>{v}</bdi>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
