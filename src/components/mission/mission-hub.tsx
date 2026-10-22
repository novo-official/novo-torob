"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquareText, ShieldCheck, Trash2 } from "lucide-react";
import { PHASE_FA, missionPhase } from "@/domain/mission";
import type { MissionFacts } from "@/domain/mission-recovery";
import { Badge, Button, Card } from "@/components/ui";
import { StorageBadge } from "@/components/mission/mission-ui";
import { getMissionStore, type ListResult } from "@/lib/mission-store";
import { buildMissionPageHref } from "@/lib/mission-url";
import { toFaDigits } from "@/lib/format";

const clearLegacyTabData = () => {
  try { for (const k of Object.keys(window.sessionStorage)) if (k.startsWith("hamghadam.inquiry.") || k.startsWith("hamghadam.agent.")) window.sessionStorage.removeItem(k); } catch { /* storage unavailable: nothing to clear */ }
};

export function MissionHub() {
  const store = getMissionStore();
  const [list, setList] = useState<ListResult | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [probe, setProbe] = useState<{ tab: boolean; device: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const askedRef = useRef(false);
  // Keyboard/SR: opening the confirmation moves focus into it (the «انصراف» button, the safe default); cancelling returns focus to the trigger.
  useEffect(() => {
    if (confirm) { askedRef.current = true; document.getElementById("hub-delete-cancel")?.focus(); }
    else if (askedRef.current) { askedRef.current = false; document.querySelector<HTMLElement>('[data-testid="hub-delete-all-start"]')?.focus(); }
  }, [confirm]);

  const refresh = useCallback(async () => {
    const [l, p] = await Promise.all([store.list(), store.probe()]);
    setList(l); setProbe(p);
    const ids = [...new Set(l.items.map((i) => i.mission.product?.productId).filter((x): x is string => !!x))].slice(0, 12);
    const entries = await Promise.all(ids.map(async (pid) => {
      try { const r = await fetch(`/api/missions/facts?product=${pid}`, { cache: "no-store" }); const j = (await r.json()) as MissionFacts; return [pid, j.product?.title ?? ""] as const; } catch { return [pid, ""] as const; }
    }));
    setTitles(Object.fromEntries(entries));
  }, [store]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="space-y-4" data-testid="mission-hub">
      <Card className="space-y-2" data-testid="hub-privacy">
        <h2 className="flex items-center gap-1.5 font-bold"><ShieldCheck aria-hidden size={16} className="text-ok-ink" />ماموریت‌های همین دستگاه</h2>
        <p className="text-sm leading-7 text-ink-2">ماموریت‌ها فقط در مرورگر شما هستند: «موقت» یعنی تا بستن تب، «ذخیره‌شده» یعنی فقط همین مرورگر و بعد از زدن «ذخیره روی این دستگاه». روی سرور چیزی نگه‌داری نمی‌شود، بین دستگاه‌ها هم‌گام نمی‌شود، و موقعیت دقیق، شماره‌ی تلفن یا پاسخ شبیه‌سازی‌شده هرگز ذخیره نمی‌شود.</p>
        {probe && !probe.device ? <p role="note" className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink" data-testid="device-unavailable">ذخیره‌سازی دائمی مرورگر در دسترس نیست (حالت خصوصی یا مسدود)؛ ماموریت‌ها موقت می‌مانند و خرید شما بدون آن هم ادامه دارد.</p> : null}
      </Card>

      {list === null ? <p role="status" className="text-sm text-ink-2" data-testid="hub-loading">در حال بارگذاری…</p> : list.items.length === 0 && list.unreadable.length === 0 ? (
        <Card className="space-y-2" data-testid="hub-empty"><p className="font-semibold">ماموریتی روی این دستگاه نیست.</p><p className="text-sm leading-7 text-ink-2">با انتخاب یک محصول و فروشگاه، از صفحه‌ی «پرسش از فروشنده» ماموریت بسازید.</p><div className="flex flex-wrap gap-2"><Link href="/discover" className="inline-flex min-h-11 items-center text-brand underline">شروع از مشاور</Link><Link href="/missions/new" className="inline-flex min-h-11 items-center text-brand underline"><MessageSquareText aria-hidden size={14} className="me-1" />پیش‌نویس سؤال بدون ماموریت</Link></div></Card>
      ) : (
        <ul className="space-y-2" data-testid="hub-list">
          {list.items.map(({ mission: m, where }) => (
            <li key={m.id}><Link href={buildMissionPageHref(m.id)} className="block min-h-11 rounded-2xl border border-line bg-surface p-4 hover:bg-surface-2" data-testid="hub-item" data-mission-id={m.id}>
              <span className="block font-semibold leading-7"><bdi>{m.product ? titles[m.product.productId] || "محصول انتخاب‌شده" : m.need.text ?? "ماموریت بدون محصول"}</bdi></span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5"><Badge tone="brand">{PHASE_FA[missionPhase(m, false)]}</Badge><StorageBadge where={where} /><span className="text-xs text-ink-2">{toFaDigits(new Date(m.updatedAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }))}</span></span>
            </Link></li>
          ))}
        </ul>
      )}

      {list && list.unreadable.length ? (
        <Card className="space-y-2" data-testid="hub-unreadable"><p className="text-sm font-semibold text-danger-ink">{toFaDigits(list.unreadable.length)} رکورد ذخیره‌شده خراب یا ناسازگار است و بارگذاری نمی‌شود.</p>
          <Button variant="secondary" onClick={async () => { for (const u of list.unreadable) await store.remove(u.id); await refresh(); setMsg("رکوردهای خراب حذف شد."); }} data-testid="hub-remove-unreadable">حذف رکوردهای خراب</Button></Card>
      ) : null}

      <Card className="space-y-2" data-testid="hub-danger">
        <h2 className="font-bold">حذف همه‌ی داده‌های ذخیره‌شده‌ی برنامه</h2>
        <p className="text-sm leading-7 text-ink-2">همه‌ی ماموریت‌های موقت و ذخیره‌شده‌ی این دستگاه، و پیش‌نویس‌ها و گفت‌وگوهای موقت این تب پاک می‌شود. برگشت‌پذیر نیست.</p>
        {!confirm ? <Button variant="secondary" onClick={() => setConfirm(true)} data-testid="hub-delete-all-start"><Trash2 aria-hidden size={16} />حذف همه</Button> : (
          <div className="space-y-2" role="alertdialog" aria-label="تأیید حذف همه">
            <p className="text-sm font-semibold text-danger-ink">مطمئنید؟</p>
            <div className="flex flex-wrap gap-2"><Button onClick={async () => { const r = await store.deleteAll(); clearLegacyTabData(); setConfirm(false); setMsg(r.ok ? "همه‌ی داده‌های ذخیره‌شده پاک شد." : "بخشی از حذف انجام نشد؛ دوباره تلاش کنید."); await refresh(); }} data-testid="hub-delete-all-confirm">بله، همه پاک شود</Button><Button id="hub-delete-cancel" variant="ghost" onClick={() => setConfirm(false)}>انصراف</Button></div>
          </div>
        )}
        <p role="status" aria-live="polite" className="min-h-6 text-sm text-ok-ink" data-testid="hub-msg">{msg ?? ""}</p>
      </Card>
      <p className="text-sm"><Link href="/missions/new" className="inline-flex min-h-11 items-center text-brand underline" data-testid="legacy-link">پیش‌نویس سؤال و ثبت پاسخ بدون ماموریت</Link></p>
    </div>
  );
}
