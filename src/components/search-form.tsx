import { Search } from "lucide-react";

/** Plain GET form: works without JavaScript and keeps the query in the URL. */
export function SearchForm({ defaultValue = "", id = "q" }: { defaultValue?: string; id?: string }) {
  return (
    <form action="/search" method="get" role="search" className="flex flex-col gap-2 sm:flex-row">
      <label htmlFor={id} className="sr-only">
        نام یا مدل کالا
      </label>
      <div className="relative flex-1">
        <Search aria-hidden size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-2" />
        <input
          id={id}
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder="مثلاً: دوربین داهوا ‏DH-HAC-HDW1200CLQP"
          autoComplete="off"
          maxLength={120}
          className="min-h-12 w-full rounded-xl border border-line bg-surface ps-10 pe-3.5 text-[0.95rem] text-ink placeholder:text-ink-2/70"
        />
      </div>
      <button
        type="submit"
        className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 font-semibold text-brand-ink hover:bg-brand-hover"
      >
        جست‌وجوی کالا
      </button>
    </form>
  );
}
