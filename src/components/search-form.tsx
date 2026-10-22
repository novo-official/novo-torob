import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

/** Plain GET form: works without JavaScript and keeps the query in the URL. */
export function SearchForm({ defaultValue = "", id = "q", featured = false, labelId }: { defaultValue?: string; id?: string; featured?: boolean; labelId?: string }) {
  return (
    <form action="/search" method="get" role="search" className={cn("flex gap-2", featured ? "rounded-2xl border border-line bg-surface p-1.5 shadow-sm" : "flex-col sm:flex-row")}>
      {!labelId ? <label htmlFor={id} className="sr-only">
        نام یا مدل کالا
      </label> : null}
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-2" />
        <input
          id={id}
          aria-labelledby={labelId}
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder={featured ? "نام کالا یا مدل، مثلاً هدفون بی‌سیم" : "مثلاً: دوربین داهوا ‏DH-HAC-HDW1200CLQP"}
          autoComplete="off"
          maxLength={120}
          className={cn("ui-input min-h-12 w-full rounded-xl bg-surface ps-10 pe-2 text-base text-ink placeholder:text-ink-2", featured ? "border border-transparent" : "border border-line")}
        />
      </div>
      <button
        type="submit"
        className={cn("ui-button inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-brand font-semibold text-brand-ink hover:bg-brand-hover", featured ? "px-4 text-sm sm:px-6" : "px-6")}
      >
        {featured ? "جست‌وجو" : "جست‌وجوی کالا"}
      </button>
    </form>
  );
}
