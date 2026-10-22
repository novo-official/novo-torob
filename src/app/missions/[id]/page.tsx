import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MissionView } from "@/components/mission/mission-view";
import { PageHeader } from "@/components/ui";
import { MISSION_ID_RE } from "@/domain/mission";
import { seedEvents } from "@/lib/mission-seed";
import { parseMissionSeed } from "@/lib/mission-url";
import { toTehranLocalInput } from "@/server/compare/time";

export const metadata: Metadata = { title: "ماموریت مراجعه" };
export const dynamic = "force-dynamic";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * The server holds NO missions: the id only selects a record in THIS browser. A malformed id is a 404; a well-formed but unknown id
 * renders "not found on this device". The URL may carry non-sensitive dataset ids so a refresh can rebuild a mission when browser storage is blocked.
 */
export default async function MissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!MISSION_ID_RE.test(id)) notFound();
  const sp = await searchParams;
  const events = seedEvents(parseMissionSeed((k) => first(sp[k])));
  return (
    <>
      <PageHeader eyebrow="گام ۴ و بعد از آن — ماموریت مراجعه" title="ماموریت مراجعه">
        برنامه‌ی خودتان برای رفتن به فروشگاه: پرسش، پاسخ ثبت‌شده توسط شما، فهرست آمادگی و راه جایگزین. «آماده مراجعه» یعنی بررسی‌ها را مرور کرده‌اید، نه اینکه موجودی تأیید شده است.
      </PageHeader>
      <Suspense fallback={<p role="status" className="rounded-xl bg-surface-2 p-4 text-sm">در حال بارگذاری ماموریت…</p>}>
        <MissionView id={id} seed={events.length ? events : null} visitDefault={toTehranLocalInput(new Date())} />
      </Suspense>
    </>
  );
}
