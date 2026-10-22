"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, House, MessageSquareText, Scale, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

export const NAV_ITEMS = [
  { href: "/", label: "خانه", Icon: House },
  { href: "/assistant", label: "دستیار", Icon: Sparkles },
  { href: "/discover", label: "مشاور", Icon: Compass },
  { href: "/compare", label: "مقایسه", Icon: Scale },
  { href: "/missions", label: "ماموریت", Icon: MessageSquareText },
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
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
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold",
                  active ? "text-brand" : "text-ink-2",
                )}
              >
                <Icon aria-hidden size={22} strokeWidth={active ? 2.4 : 1.9} />
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
    ...NAV_ITEMS.filter((i) => i.href !== "/"),
    { href: "/search", label: "جست‌وجو" },
    { href: "/data", label: "درباره‌ی داده" },
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
              "rounded-lg px-3 py-2 text-sm font-semibold",
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
