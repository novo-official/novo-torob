"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HardDrive, ShieldCheck, Trash2 } from "lucide-react";
import { MISSION_LIMITS, type MissionEvent, type MissionResult, type ShoppingMissionV1 } from "@/domain/mission";
import type { StoreFailure, Where } from "@/lib/mission-store";
import { Button, Card, inputStyles } from "@/components/ui";
import { WHERE_FA } from "@/components/mission/mission-ui";
import { cn } from "@/lib/cn";
import { toFaDigits } from "@/lib/format";

const ISSUE_FA: Record<StoreFailure, string> = {
  BLOCKED: "ذخیره‌سازی مرورگر مسدود یا در دسترس نیست (حالت خصوصی یا دسترسی رد‌شده). ماموریت فقط تا بستن این صفحه در حافظه می‌ماند؛ خرید شما با این مشکل متوقف نمی‌شود.",
  QUOTA: "فضای ذخیره‌سازی مرورگر پر است؛ چیزی ذخیره نشد.",
  UNAVAILABLE: "ذخیره‌سازی در این مرورگر پشتیبانی نمی‌شود؛ ماموریت فقط تا بستن این صفحه می‌ماند.",
  CONFLICT: "ماموریت در تب دیگری تغییر کرده بود.",
};

export function DeviceTab({ m, where, issue, dispatch, saveToDevice, forgetFromDevice, remove }: {
  m: ShoppingMissionV1; where: Where | null; issue: StoreFailure | null; dispatch: (e: MissionEvent) => MissionResult;
  saveToDevice: (keepNotes: boolean) => Promise<boolean>; forgetFromDevice: () => Promise<boolean>; remove: () => Promise<boolean>;
}) {
  const [keepNotes, setKeepNotes] = useState(false);
  const [notes, setNotes] = useState(m.notes ?? "");
  const [notesConsent, setNotesConsent] = useState(m.notes !== null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const askedRef = useRef(false);
  // Keyboard/SR: opening the confirmation moves focus to the safe «انصراف»; cancelling returns focus to the trigger.
  useEffect(() => {
    if (confirmDelete) { askedRef.current = true; document.getElementById("device-delete-cancel")?.focus(); }
    else if (askedRef.current) { askedRef.current = false; document.querySelector<HTMLElement>('[data-testid="delete-start"]')?.focus(); }
  }, [confirmDelete]);
  const onDevice = where === "DEVICE";

  return (
    <div className="space-y-3" data-testid="tab-device">
      <Card className="space-y-3" data-testid="storage-card">
        <h2 className="flex items-center gap-1.5 font-bold"><HardDrive aria-hidden size={16} />ذخیره‌سازی این ماموریت</h2>
        <p className="text-sm leading-7" data-testid="storage-status"><strong>{where ? WHERE_FA[where].label : "—"}.</strong> {where ? WHERE_FA[where].help : ""}</p>
        {issue ? <p role="alert" className="rounded-xl bg-warn-bg p-3 text-sm leading-7 text-warn-ink" data-testid="storage-issue">{ISSUE_FA[issue]}</p> : null}
        <div className="space-y-2 rounded-xl border border-line p-3 text-sm leading-7">
          <p className="flex items-start gap-1.5"><ShieldCheck aria-hidden size={16} className="mt-1 shrink-0 text-ok-ink" /><span>چه چیزی ذخیره می‌شود: شناسه‌ی محصول/فروشگاه/پیشنهاد، بودجه و محله‌ی انتخابی شما، زمان مراجعه، تیک‌های فهرست و پاسخ‌هایی که خودتان ثبت کرده‌اید (با برچسب «گزارش شما»).</span></p>
          <p>چه چیزی <strong>هرگز</strong> ذخیره نمی‌شود: موقعیت دقیق (GPS)، شماره‌ی تلفن، هر پاسخ شبیه‌سازی‌شده‌ی دمو، کلید یا رمز.</p>
          <p>ماموریت‌ها بین دستگاه‌ها هم‌گام نمی‌شوند و روی سرور ذخیره نمی‌شوند.</p>
        </div>
        {!onDevice ? (
          <div className="space-y-2">
            <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-5" checked={keepNotes} onChange={(e) => setKeepNotes(e.target.checked)} data-testid="keep-notes" />یادداشت‌های متنی‌ام هم روی این دستگاه ذخیره شود (اختیاری)</label>
            <Button disabled={where === "MEMORY"} onClick={async () => { const ok = await saveToDevice(keepNotes); setMsg(ok ? "ماموریت روی این دستگاه ذخیره شد." : "ذخیره انجام نشد؛ ماموریت همچنان موقت است."); }} data-testid="save-device">ذخیره روی این دستگاه</Button>
            <p className="text-xs leading-6 text-ink-2">تا وقتی این دکمه را نزنید، چیزی بعد از بستن تب باقی نمی‌ماند.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={async () => { const ok = await forgetFromDevice(); setMsg(ok ? "از این دستگاه حذف شد؛ ماموریت فقط در همین تب می‌ماند." : "حذف انجام نشد."); }} data-testid="forget-device">حذف از این دستگاه (فقط در این تب بماند)</Button></div>
        )}
        <p role="status" aria-live="polite" className="min-h-6 text-sm text-ok-ink" data-testid="device-msg">{msg ?? ""}</p>
      </Card>

      <Card className="space-y-2" data-testid="notes-card">
        <label htmlFor="mission-notes" className="font-bold">یادداشت‌های شخصی</label>
        <textarea id="mission-notes" rows={4} maxLength={MISSION_LIMITS.note} className={cn(inputStyles, "min-h-28 py-2 leading-7")} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="notes-input" />
        <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-5" checked={notesConsent} onChange={(e) => setNotesConsent(e.target.checked)} data-testid="notes-consent" />این یادداشت در ماموریت نگه داشته شود{onDevice ? " (روی این دستگاه ذخیره می‌شود)" : " (فقط در این تب)"}. شماره‌ی تلفن یا اطلاعات حساس ننویسید.</label>
        <div className="flex items-center justify-between gap-2 text-xs text-ink-2"><span>{toFaDigits(notes.length)} / {toFaDigits(MISSION_LIMITS.note)}</span>
          <Button variant="secondary" onClick={() => { const r = dispatch({ type: "SET_NOTES", text: notes, consent: notesConsent }); setMsg(r.ok ? (notesConsent && notes.trim() ? "یادداشت ذخیره شد." : "یادداشت پاک شد.") : r.messageFa); }} data-testid="notes-save">ثبت یادداشت</Button></div>
      </Card>

      <Card className="space-y-2" data-testid="danger-card">
        <h2 className="font-bold">حذف</h2>
        {!confirmDelete ? <Button variant="secondary" onClick={() => setConfirmDelete(true)} data-testid="delete-start"><Trash2 aria-hidden size={16} />حذف کامل این ماموریت</Button> : (
          <div className="space-y-2" role="alertdialog" aria-label="تأیید حذف">
            <p className="text-sm leading-7 text-danger-ink">ماموریت از همه‌ی جاهایی که ذخیره شده (این تب و این دستگاه) پاک می‌شود و برگشت‌پذیر نیست.</p>
            <div className="flex flex-wrap gap-2"><Button onClick={async () => { const ok = await remove(); if (!ok) setMsg("حذف کامل انجام نشد؛ دوباره تلاش کنید."); }} data-testid="delete-confirm">بله، حذف شود</Button><Button id="device-delete-cancel" variant="ghost" onClick={() => setConfirmDelete(false)}>انصراف</Button></div>
          </div>
        )}
        <Link href="/missions" className="inline-flex min-h-11 items-center text-sm text-brand underline">همه‌ی ماموریت‌های این دستگاه و حذف یکجا</Link>
      </Card>
    </div>
  );
}
