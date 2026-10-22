import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn/wght.css";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { MotionProvider } from "@/components/motion-provider";
import { CompareTray } from "@/components/catalog/compare-store";

// Dynamic rendering for every route: a CSP nonce must be fresh per request (a prerendered page cannot carry one). See src/proxy.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "هم‌قدم — دستیار خرید حضوری تهران", template: "%s | هم‌قدم" },
  description: "انتخاب محصول، یافتن فروشنده‌ی نزدیک، مقایسه و پرسش از فروشنده برای خرید حضوری در بازار تهران.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1815" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <MotionProvider>
          <AppShell>{children}</AppShell>
          <CompareTray />
        </MotionProvider>
      </body>
    </html>
  );
}
