"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CornerDownLeft, LoaderCircle, Search, X } from "lucide-react";
import type { Suggestions } from "@/domain/advisor";
import { cn } from "@/lib/cn";

type Reply = { query: string; data: Suggestions | null; error: boolean };

/** Native GET fallback, enhanced with cancellable, query-bound catalog suggestions. */
export function SearchBox({ defaultValue = "", category, compact = false }: { defaultValue?: string; category?: string | null; compact?: boolean }) {
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [reply, setReply] = useState<Reply | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pending, startTransition] = useTransition();
  const query = value.trim();
  const resultsHref = `/search?${new URLSearchParams({ q: query, ...(category ? { cat: category } : {}) })}`;
  // /api/suggest accepts 80 characters; the full search accepts 120.
  const eligible = query.length >= 2 && query.length <= 80;
  const current = reply?.query === query ? reply : null;
  const live = eligible ? current?.data : null;
  const items = live ? [
    ...live.products.map((p) => ({ kind: "product", key: p.id, label: p.title, sub: p.categoryName, href: `/products/${p.id}?${new URLSearchParams({ from: resultsHref })}` })),
    ...live.categories.map((c) => ({ kind: "category", key: c.category, label: c.category, sub: `${new Intl.NumberFormat("fa-IR").format(c.count)} نتیجه`, href: `/search?${new URLSearchParams({ q: query, cat: c.category })}` })),
  ] : [];
  const listVisible = open && eligible && items.length > 0;
  const activeId = listVisible && active >= 0 && items[active] ? `${id}-o${active}` : undefined;

  useEffect(() => {
    if (!eligible || !open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as Suggestions;
        if (!controller.signal.aborted && data.query === query) setReply({ query, data, error: false });
      } catch {
        if (!controller.signal.aborted) setReply({ query, data: null, error: true });
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, eligible, open]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const close = () => { setOpen(false); setActive(-1); };
  const navigate = (href: string) => { close(); startTransition(() => router.push(href)); };
  const submit = () => {
    if (!query || pending) return;
    navigate(resultsHref);
  };

  return (
    <form action="/search" method="get" role="search" aria-label="جست‌وجوی کاتالوگ"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) close(); }}
      className="relative">
      <label htmlFor={`${id}-q`} className="mb-2 block text-sm font-semibold">نام یا مدل کالا</label>
      {category ? <input type="hidden" name="cat" value={category} /> : null}
      <div className="relative">
        <div className="flex gap-2 rounded-2xl border border-line bg-surface p-1.5 focus-within:border-brand">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden size={19} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-2" />
          <input ref={inputRef} id={`${id}-q`} name="q" type="search" required value={value} autoComplete="off" maxLength={120}
            role="combobox" aria-expanded={listVisible} aria-controls={listVisible ? `${id}-list` : undefined}
            aria-autocomplete="list" aria-activedescendant={activeId} aria-describedby={`${id}-hint`}
            onChange={(e) => { setValue(e.target.value); setActive(-1); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && items.length) { e.preventDefault(); setOpen(true); setActive((a) => open ? (a + 1) % items.length : 0); }
              else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); setOpen(true); setActive((a) => !open || a <= 0 ? items.length - 1 : a - 1); }
              else if (e.key === "Enter" && listVisible && active >= 0 && items[active]) { e.preventDefault(); navigate(items[active]!.href); }
              else if (e.key === "Escape") { e.preventDefault(); close(); }
            }}
            placeholder="مثلاً هدفون بی‌سیم یا کد مدل" dir="auto"
            className="min-h-12 w-full rounded-xl border-0 bg-surface px-11 text-base text-ink placeholder:text-ink-2 [&::-webkit-search-cancel-button]:appearance-none" />
          {value ? <button type="button" aria-label="پاک کردن عبارت" onClick={() => { setValue(""); setActive(-1); setOpen(true); inputRef.current?.focus(); }} className="absolute end-0 top-0 grid size-12 place-items-center rounded-xl text-ink-2 hover:bg-surface-2"><X aria-hidden size={17} /></button> : null}
        </div>
        <button type="submit" disabled={pending} className="ui-button inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-3 font-semibold text-brand-ink hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60 sm:px-5">
          {pending ? <LoaderCircle aria-hidden size={19} className="animate-spin" /> : <ArrowLeft aria-hidden size={19} />}
          <span className="sr-only sm:not-sr-only">جست‌وجوی کالا</span>
        </button>
      </div>
      {open && query.length >= 2 ? (
        <div className="absolute inset-x-0 top-[calc(100%+0.25rem)] z-30 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-floating)]">
          {!eligible ? <p role="status" className="p-4 text-sm leading-7 text-ink-2">برای عبارت بلند، دکمهٔ جست‌وجو را بزنید.</p> : !current ? <p role="status" className="flex items-center gap-2 p-4 text-sm text-ink-2"><LoaderCircle aria-hidden size={16} className="animate-spin" />در حال دریافت پیشنهادها…</p> : current.error ? <p role="status" className="p-4 text-sm leading-7 text-ink-2">پیشنهادها دریافت نشدند؛ با دکمهٔ جست‌وجو ادامه دهید.</p> : live?.tooShort ? <p role="status" className="p-4 text-sm leading-7 text-ink-2">عبارت خیلی کلی است؛ نام کالا یا مدل را بنویسید.</p> : items.length === 0 ? <p role="status" className="p-4 text-sm leading-7 text-ink-2">پیشنهاد مستقیمی پیدا نشد. با جست‌وجو نتیجه‌های بیشتری را بررسی کنید.</p> : null}
          {live?.corrections.length ? <p className="border-b border-line px-4 py-2 text-xs leading-6 text-ink-2">منظورتان «{live.corrections.map((c) => c.to).join("، ")}» است؟</p> : null}
          {listVisible ? <div id={`${id}-list`} role="listbox" aria-label="پیشنهادهای جست‌وجو" className="max-h-[min(20rem,45dvh)] overflow-y-auto p-1.5">
            {items.map((item, i) => <a key={item.kind + item.key} id={`${id}-o${i}`} role="option" aria-selected={i === active} tabIndex={-1} href={item.href}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); navigate(item.href); } }}
              className={cn("flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 text-sm", i === active ? "bg-brand-soft text-brand-soft-ink" : "hover:bg-surface-2")}>
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">{item.kind === "category" ? <Search size={15} /> : <CornerDownLeft size={15} />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate"><bdi>{item.label}</bdi></span><span className="mt-0.5 block text-xs text-ink-2">{item.kind === "category" ? `دسته · ${item.sub}` : item.sub}</span></span>
              <ArrowLeft aria-hidden size={14} className="shrink-0 text-ink-2" />
            </a>)}
          </div> : null}
        </div>
      ) : null}
      </div>
      <p id={`${id}-hint`} className={compact ? "sr-only" : "mt-2 text-xs leading-6 text-ink-2"}>نام فارسی، نام لاتین یا بخشی از کد مدل را بنویسید.</p>
      {pending ? <p role="status" className="mt-2 text-xs text-brand">در حال جست‌وجو…</p> : null}
    </form>
  );
}
