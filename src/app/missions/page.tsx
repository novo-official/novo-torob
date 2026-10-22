import type { Metadata } from "next";
import { MissionHub } from "@/components/mission/mission-hub";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "ماموریت‌های من" };

/** Missions live in THIS browser only (tab-temporary or explicitly saved on this device). The page itself holds no data, so it is static. */
export default function MissionsPage() {
  return (
    <>
      <PageHeader eyebrow="ادامه‌ی خرید پس از انتخاب فروشنده" title="ماموریت‌های من">
        هر ماموریت یک خرید حضوری است که بعد از انتخاب فروشنده هم ادامه پیدا می‌کند: پرسش، پاسخ شما، آمادگی مراجعه و راه جایگزین. چیزی به فروشنده ارسال نمی‌شود و موجودی هرگز تأییدشده فرض نمی‌شود.
      </PageHeader>
      <MissionHub />
    </>
  );
}
