import type { Metadata } from "next";
import { GitCompareArrows } from "lucide-react";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { ProductsCompareView } from "@/components/compare/products-compare-view";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { compareProducts } from "@/server/advisor/compare";
import { getReadDbOrNull } from "@/server/db/safe";

export const metadata: Metadata = { title: "مقایسه‌ی محصولات" };
export const dynamic = "force-dynamic";
const IDS = /^product_[0-9a-f]{8,40}(,product_[0-9a-f]{8,40}){1,3}$/;

export default async function CompareProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.ids) ? sp.ids[0] : sp.ids;
  const db = getReadDbOrNull();
  const idsList = raw && IDS.test(raw) ? raw.split(",") : [];
  const res = db && idsList.length >= 2 ? compareProducts(db, idsList) : null;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="گام ۱ — مقایسه‌ی محصولات" title="مقایسه‌ی محصولات کنار هم">
        تفاوت‌ها فقط از مشخصات و قیمت ثبت‌شده در داده می‌آید؛ امتیاز کیفیت یا نظر کاربران وجود ندارد.
      </PageHeader>
      {!db ? <DataUnavailable /> : null}
      {db && !res ? (
        <EmptyState
          icon={<GitCompareArrows size={22} />}
          title="دو تا چهار محصول برای مقایسه انتخاب کنید"
          action={
            <>
              <ButtonLink href="/discover">کمکم کن انتخاب کنم</ButtonLink>
              <ButtonLink href="/search" variant="secondary">جست‌وجوی مدل</ButtonLink>
            </>
          }
        >
          <p>در فهرست نتایج روی «مقایسه» بزنید؛ انتخاب‌ها تا بستن تب حفظ می‌شود.</p>
        </EmptyState>
      ) : null}
      {res ? (
        <ProductsCompareView res={res} currentIds={idsList} />
      ) : null}
    </div>
  );
}
