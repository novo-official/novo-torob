"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { Suggestions } from "@/domain/advisor";

/** Typeahead search. Suggestions come from /api/suggest (real catalog); empty/too-short states are explicit. */
export function SearchBox({ defaultValue = "", category }: { defaultValue?: string; category?: string | null }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [sug, setSug] = useState<Suggestions | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return; // nothing to fetch; stale suggestions are hidden at render time
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Suggestions;
        if (mine === seq.current) { setSug(data); setError(false); setActive(-1); }
      } catch {
        if (mine === seq.current) { setSug(null); setError(true); }
      }
    }, 180);
    return () => clearTimeout(t);
  }, [value]);

  const submit = (q: string) => {
    const sp = new URLSearchParams({ q: q.trim() });
    if (category) sp.set("cat", category);
    setOpen(false);
    router.push(`/search?${sp.toString()}`);
  };
  const live = value.trim().length >= 2 ? sug : null;
  const items = live ? [...live.products.map((p) => ({ kind: "p" as const, key: p.id, label: p.title, sub: p.categoryName, href: `/products/${p.id}` })), ...live.categories.map((c) => ({ kind: "c" as const, key: c.category, label: c.category, sub: `${new Intl.NumberFormat("fa-IR").format(c.count)} نتیجه`, href: `/search?q=${encodeURIComponent(value.trim())}&cat=${encodeURIComponent(c.category)}` }))] : [];

  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); if (value.trim()) submit(value); }} className="relative flex flex-col gap-2 sm:flex-row">
      <label htmlFor={`${id}-q`} className="sr-only">نام یا مدل کالا</label>
      <div className="relative flex-1">
        <Search aria-hidden size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-2" />
        <input
          id={`${id}-q`} name="q" type="search" value={value} autoComplete="off" maxLength={120} role="combobox" aria-expanded={open && items.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined}
          onChange={(e) => { setValue(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && items.length) { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
            else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
            else if (e.key === "Enter" && active >= 0 && items[active]) { e.preventDefault(); router.push(items[active]!.href); }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="مثلاً: دوربین داهوا ‏DH-HAC-HDW1200CLQP" dir="auto"
          className="min-h-12 w-full rounded-xl border border-line bg-surface ps-10 pe-3.5 text-[0.95rem] text-ink placeholder:text-ink-2/70"
        />
        {open && value.trim().length >= 2 ? (
          <div id={`${id}-list`} role="listbox" aria-label="پیشنهادهای جست‌وجو" className="absolute inset-x-0 top-[calc(100%+4px)] z-30 max-h-80 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
            {error ? <p role="status" className="p-3 text-sm text-danger-ink">دریافت پیشنهادها ممکن نشد؛ می‌توانید جست‌وجو را بزنید.</p> : null}
            {live?.tooShort ? <p role="status" className="p-3 text-sm text-ink-2">عبارت خیلی کلی است؛ نام کالا یا مدل را بنویسید.</p> : null}
            {live && !live.tooShort && items.length === 0 ? <p role="status" className="p-3 text-sm text-ink-2">پیشنهادی پیدا نشد. با زدن جست‌وجو تلاش بیشتری می‌شود.</p> : null}
            {live?.corrections.length ? <p className="px-3 pt-2 text-xs text-ink-2">منظورتان «{live.corrections.map((c) => c.to).join("، ")}» است؟</p> : null}
            {items.map((it, i) => (
              <a key={it.kind + it.key} id={`${id}-o${i}`} role="option" aria-selected={i === active} href={it.href} onMouseDown={(e) => { e.preventDefault(); router.push(it.href); }} className={`flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-brand-soft" : "hover:bg-surface-2"}`}>
                <span className="truncate"><bdi>{it.label}</bdi></span>
                <span className="shrink-0 text-xs text-ink-2">{it.kind === "c" ? `دسته · ${it.sub}` : it.sub}</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <button type="submit" disabled={!value.trim()} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 font-semibold text-brand-ink hover:bg-brand-hover disabled:opacity-60">جست‌وجوی کالا</button>
    </form>
  );
}
