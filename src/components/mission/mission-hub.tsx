"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, MessageSquareText, ShieldCheck, Trash2 } from "lucide-react";
import { PHASE_FA, missionPhase } from "@/domain/mission";
import type { MissionFacts } from "@/domain/mission-recovery";
import { Badge, Button, Card } from "@/components/ui";
import { StorageBadge } from "@/components/mission/mission-ui";
import { getMissionStore, type ListResult } from "@/lib/mission-store";
import { buildMissionPageHref } from "@/lib/mission-url";
import { toFaDigits } from "@/lib/format";
import styles from "./mission.module.css";

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
    <div className={styles.hubContainer} data-testid="mission-hub">
      <div className={styles.privacyCard} data-testid="hub-privacy">
        <h2 className={styles.privacyHeader}>
          <ShieldCheck aria-hidden size={18} className="text-ok-ink" />
          <span>ماموریت‌های خرید همین دستگاه</span>
        </h2>
        <p className={styles.privacyText}>
          ماموریت‌ها فقط در مرورگر شما هستند: «موقت» یعنی تا بستن تب، «ذخیره‌شده» یعنی فقط همین مرورگر و بعد از زدن «ذخیره روی این دستگاه». روی سرور چیزی نگه‌داری نمی‌شود، بین دستگاه‌ها هم‌گام نمی‌شود، و موقعیت دقیق، شماره‌ی تلفن یا پاسخ شبیه‌سازی‌شده هرگز ذخیره نمی‌شود.
        </p>
        {probe && !probe.device ? (
          <p role="note" className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink border border-warn-line" data-testid="device-unavailable">
            ذخیره‌سازی دائمی مرورگر در دسترس نیست (حالت خصوصی یا مسدود)؛ ماموریت‌ها موقت می‌مانند و خرید شما بدون آن هم ادامه دارد.
          </p>
        ) : null}
      </div>

      {list === null ? (
        <p role="status" className="text-sm text-ink-2 py-4" data-testid="hub-loading">در حال بارگذاری…</p>
      ) : list.items.length === 0 && list.unreadable.length === 0 ? (
        <Card className="space-y-3 p-6" data-testid="hub-empty">
          <p className="font-bold text-base">ماموریتی روی این دستگاه نیست.</p>
          <p className="text-sm leading-7 text-ink-2">با انتخاب یک محصول و فروشگاه، از صفحه‌ی «پرسش از فروشنده» ماموریت بسازید.</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/discover" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand-hover transition-colors">
              شروع از راهنما
            </Link>
            <Link href="/missions/new" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2 transition-colors">
              <MessageSquareText aria-hidden size={14} />
              پیش‌نویس سؤال بدون ماموریت
            </Link>
          </div>
        </Card>
      ) : (
        <ul className={styles.missionsList} data-testid="hub-list">
          {list.items.map(({ mission: m, where }) => (
            <li key={m.id}>
              <Link
                href={buildMissionPageHref(m.id)}
                className={styles.missionCard}
                data-testid="hub-item"
                data-mission-id={m.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={styles.missionTitle}>
                    <bdi>{m.product ? titles[m.product.productId] || "محصول انتخاب‌شده" : m.need.text ?? "ماموریت بدون محصول"}</bdi>
                  </span>
                  <ChevronLeft aria-hidden size={18} className="text-ink-2 mt-1 shrink-0" />
                </div>
                <div className={styles.missionMetaRow}>
                  <Badge tone="brand">{PHASE_FA[missionPhase(m, false)]}</Badge>
                  <StorageBadge where={where} />
                  <span className="text-xs text-ink-2">
                    {toFaDigits(new Date(m.updatedAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }))}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {list && list.unreadable.length ? (
        <Card className="space-y-3 border-danger-ink/30 bg-danger-bg/20" data-testid="hub-unreadable">
          <p className="text-sm font-semibold text-danger-ink">
            {toFaDigits(list.unreadable.length)} رکورد ذخیره‌شده خراب یا ناسازگار است و بارگذاری نمی‌شود.
          </p>
          <Button
            variant="secondary"
            onClick={async () => { for (const u of list.unreadable) await store.remove(u.id); await refresh(); setMsg("رکوردهای خراب حذف شد."); }}
            data-testid="hub-remove-unreadable"
          >
            حذف رکوردهای خراب
          </Button>
        </Card>
      ) : null}

      <div className={styles.dangerCard} data-testid="hub-danger">
        <h2 className={styles.dangerTitle}>حذف همه‌ی داده‌های ذخیره‌شده‌ی برنامه</h2>
        <p className={styles.dangerText}>
          همه‌ی ماموریت‌های موقت و ذخیره‌شده‌ی این دستگاه، و پیش‌نویس‌ها و گفت‌وگوهای موقت این تب پاک می‌شود. برگشت‌پذیر نیست.
        </p>
        {!confirm ? (
          <div>
            <Button variant="secondary" onClick={() => setConfirm(true)} data-testid="hub-delete-all-start" className="gap-2">
              <Trash2 aria-hidden size={16} />
              حذف همه
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-danger-ink/30 bg-danger-bg/30 p-4" role="alertdialog" aria-label="تأیید حذف همه">
            <p className="text-sm font-bold text-danger-ink">مطمئنید؟ تمامی داده‌ها پاک خواهند شد.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  const r = await store.deleteAll();
                  clearLegacyTabData();
                  setConfirm(false);
                  setMsg(r.ok ? "همه‌ی داده‌های ذخیره‌شده پاک شد." : "بخشی از حذف انجام نشد؛ دوباره تلاش کنید.");
                  await refresh();
                }}
                data-testid="hub-delete-all-confirm"
              >
                بله، همه پاک شود
              </Button>
              <Button id="hub-delete-cancel" variant="ghost" onClick={() => setConfirm(false)}>
                انصراف
              </Button>
            </div>
          </div>
        )}
        <p role="status" aria-live="polite" className="min-h-6 text-sm text-ok-ink font-semibold" data-testid="hub-msg">{msg ?? ""}</p>
      </div>

      <p className="text-sm pt-1">
        <Link href="/missions/new" className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-2" data-testid="legacy-link">
          پیش‌نویس سؤال و ثبت پاسخ بدون ماموریت
        </Link>
      </p>
    </div>
  );
}
