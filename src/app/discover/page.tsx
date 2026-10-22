import type { Metadata } from "next";
import { AdvisorView } from "@/components/advisor/advisor-view";
import { DataUnavailable } from "@/components/catalog/data-unavailable";
import { PageHeader } from "@/components/ui";
import { buildAdvisorHref, parseAdvisorParams } from "@/lib/advisor-url";
import { adviseProducts } from "@/server/advisor/engine";
import { getReadDbOrNull } from "@/server/db/safe";

export const metadata: Metadata = { title: "کمکم کن انتخاب کنم" };
export const dynamic = "force-dynamic";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const flat = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") flat.set(k, v);
  const params = parseAdvisorParams(flat);
  const db = getReadDbOrNull();

  return (
    <>
      <PageHeader eyebrow="گام ۱ — انتخاب محصول" title="نمی‌دانید چه بخرید؟ با چند سؤال کوتاه پیدا می‌کنیم">
        پیشنهادها از کاتالوگ واقعی می‌آیند و دلیل هر کدام با شاهد نوشته می‌شود. هیچ امتیاز کیفیت یا نظر کاربران ساخته نمی‌شود.
      </PageHeader>
      {db ? (
        <AdvisorView
          key={buildAdvisorHref({ ...params, offset: 0 })}
          params={params}
          response={adviseProducts(db, { text: params.text, category: params.category, answers: params.answers, skipped: params.skipped, budget: { min: params.bmin, max: params.bmax }, brands: params.brands, show: params.show, ask: params.ask ?? undefined, offset: params.offset })}
        />
      ) : (
        <DataUnavailable />
      )}
    </>
  );
}
