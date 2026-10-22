"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Compass, House, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

export const NAV_ITEMS = [
  { href: "/", label: "خانه", Icon: House },
  { href: "/search", label: "جست‌وجو", Icon: Search },
  { href: "/discover", label: "راهنما", Icon: Compass },
  { href: "/assistant", label: "دستیار", Icon: Sparkles },
  { href: "/missions", label: "خریدهای من", Icon: Bookmark },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  const base = href.startsWith("/missions") ? "/missions" : href;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="ناوبری اصلی (موبایل)"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_24px_rgb(20_52_40/0.04)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[var(--mobile-nav-height)] flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold transition-colors",
                  active ? "text-brand" : "text-ink-2",
                )}
              >
                <span className={cn("grid h-7 w-12 place-items-center rounded-xl transition-colors", active && "bg-brand-soft")}>
                  <Icon aria-hidden size={20} strokeWidth={active ? 2.4 : 1.8} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const items = [
    ...NAV_ITEMS.filter((i) => i.href !== "/").map((i) => ({ ...i, label: i.href === "/discover" ? "راهنمای انتخاب" : i.label })),
    { href: "/compare", label: "مقایسه" },
  ];
  return (
    <nav aria-label="ناوبری اصلی" className="hidden items-center gap-1 md:flex">
      {items.map((i) => {
        const active = isActive(pathname, i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-2.5 py-2 text-[0.8125rem] font-semibold transition-colors lg:px-4 lg:text-sm",
              active ? "bg-brand-soft text-brand-soft-ink" : "text-ink-2 hover:bg-surface-2",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
