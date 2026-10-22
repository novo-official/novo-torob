import Link from "next/link";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
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
      <div role="note" className="border-b border-warn-line bg-warn-bg px-4 py-2 text-center text-[0.8rem] font-medium leading-6 text-warn-ink">
        <Info aria-hidden size={14} className="me-1 inline align-[-2px]" />
        فروشنده‌ها، قیمت و ساعت کاری از داده‌ی واقعی هکاتون‌اند؛ فاصله‌ها خط مستقیم‌اند. موجودی هرگز تأییدشده فرض نمی‌شود و هیچ پیامی به فروشنده ارسال نمی‌شود.
      </div>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-extrabold">
            <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-brand text-sm text-brand-ink">
              هق
            </span>
            هم‌قدم
          </Link>
          <TopNav />
        </div>
      </header>
      <main id="main" className="mx-auto min-h-[70vh] max-w-6xl px-4 pb-28 pt-6 md:pb-12 md:pt-10">
        {children}
      </main>
      <footer className="hidden border-t border-line py-6 text-center text-xs text-ink-2 md:block">
        هم‌قدم — دستیار خرید حضوری تهران. داده‌ها نمونه‌ی هکاتون‌اند؛ پوشش کل تهران ادعا نمی‌شود.
      </footer>
      <BottomNav />
    </>
  );
}
