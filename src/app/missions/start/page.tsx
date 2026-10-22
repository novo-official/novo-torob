import type { Metadata } from "next";
import { Suspense } from "react";
import { MissionStart } from "@/components/mission/mission-start";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "ساخت ماموریت" };

export default function MissionStartPage() {
  return (
    <>
      <PageHeader eyebrow="ماموریت جدید" title="ماموریت را می‌سازیم">فقط شناسه‌های داده و ترجیحات خودتان منتقل می‌شود؛ موقعیت دقیق، شماره‌ی تلفن یا پاسخ شبیه‌سازی‌شده هرگز.</PageHeader>
      <Suspense fallback={<p role="status" className="rounded-xl bg-surface-2 p-4 text-sm">در حال ساختن ماموریت…</p>}><MissionStart /></Suspense>
    </>
  );
}
