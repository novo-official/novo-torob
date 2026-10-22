import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpLeft, Footprints, MapPin, ShieldCheck } from "lucide-react";
import { BottomNav, TopNav } from "./bottom-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-ink"
      >
        پرش به محتوا
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="هم‌قدم — خانه" className="flex min-h-11 shrink-0 items-center gap-2.5">
            <span aria-hidden className="grid size-10 place-items-center rounded-2xl bg-brand text-brand-ink">
              <Footprints size={23} strokeWidth={1.8} />
            </span>
            <span>
              <span className="block text-xl font-extrabold leading-7">هم‌قدم</span>
              <span className="hidden text-[0.625rem] leading-5 text-ink-2 lg:block">دستیار خرید حضوری</span>
            </span>
          </Link>
          <TopNav />
          <span className="flex items-center gap-1 text-xs font-medium text-ink-2 md:hidden"><MapPin aria-hidden size={14} />بازار تهران</span>
        </div>
      </header>
      <div role="note" className="border-b border-line bg-surface-2/60">
        <div className="mx-auto flex min-h-11 max-w-6xl items-center justify-between gap-2 px-4 py-1.5 text-[0.6875rem] leading-5 text-ink-2 sm:px-6 sm:text-xs">
          <p className="flex items-start gap-2"><ShieldCheck aria-hidden size={15} className="mt-0.5 shrink-0 text-brand" /><span>پیشنهاد ثبت‌شده، موجودی تأییدشده نیست. <span className="hidden sm:inline">هیچ پیامی به فروشنده ارسال نمی‌شود.</span></span></p>
          <Link href="/data" className="inline-flex min-h-8 shrink-0 items-center gap-1 font-semibold text-brand hover:underline">دربارهٔ داده‌ها<ArrowUpLeft aria-hidden size={12} /></Link>
        </div>
      </div>
      <main id="main" tabIndex={-1} className="app-main mx-auto min-h-[70vh] max-w-6xl px-4 pt-5 sm:px-6 md:pt-8">
        {children}
      </main>
      <footer className="border-t border-line bg-surface px-4 pt-7 pb-[calc(var(--action-bottom)+var(--compare-tray-height)+2rem)] text-xs leading-6 text-ink-2">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p><strong className="text-sm text-ink">هم‌قدم</strong><br />برای خرید حضوری، با آمادگی بیشتر.<br /><span>داده‌های هکاتون؛ پوشش کامل تهران ادعا نمی‌شود.</span></p>
          <nav aria-label="پیوندهای تکمیلی" className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/data" className="inline-flex min-h-11 items-center hover:text-brand">دربارهٔ داده‌ها</Link>
            <Link href="/compare/products" className="inline-flex min-h-11 items-center hover:text-brand">مقایسهٔ محصولات</Link>
            <Link href="/compare" className="inline-flex min-h-11 items-center hover:text-brand">مقایسهٔ فروشنده‌ها</Link>
          </nav>
        </div>
      </footer>
      <BottomNav />
    </>
  );
}
