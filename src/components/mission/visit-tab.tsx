"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Check, ClipboardCopy, ExternalLink, Flag, MapPin, SkipForward, Undo2 } from "lucide-react";
import { CHECKLIST, exportChecklistText, itemState, type ChecklistItemId, type MissionEvent, type MissionResult, type ShoppingMissionV1 } from "@/domain/mission";
import type { MissionFacts } from "@/domain/mission-recovery";
import { Badge, Button, Card, inputStyles } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatToman, toFaDigits } from "@/lib/format";
import type { MissionView } from "@/lib/mission-derive";
import type { MissionTab } from "@/lib/mission-url";

const STATE_FA = { done: "مرور شد", skipped: "رد شد", pending: "مانده" } as const;

export function VisitTab({ m, facts, failed, view, dispatch, onTab, visitDefault }: {
  m: ShoppingMissionV1; facts: MissionFacts | null; failed: boolean; view: MissionView; dispatch: (e: MissionEvent, o?: { readyNow?: boolean }) => MissionResult; onTab: (t: MissionTab) => void; visitDefault: string;
}) {
  const ctx = facts?.context ?? null;
  const [msg, setMsg] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const exportText = useMemo(() => exportChecklistText(m, {
    productTitle: facts?.product?.title ?? null, shopName: ctx?.shop.name ?? null, priceText: ctx?.offer.priceToman != null ? formatToman(ctx.offer.priceToman) : null,
    priceNoteFa: ctx?.offer.recordedAtLabel ? `${ctx.offer.recordedAtLabel}؛ قیمت امروز نیست` : null, hoursLabelFa: ctx?.hours.labelFa ?? null,
    visitLabelFa: m.visit ? toFaDigits(m.visit.replace("T", " ")) + " (وقت تهران)" : null, addressFa: ctx?.shop.address ?? null,
  }, view.readiness), [m, facts, ctx, view.readiness]);

  if (!m.shop) {
    return <Card className="space-y-2" data-testid="tab-visit"><h2 className="font-bold">برنامه‌ی مراجعه</h2><p className="text-sm leading-7 text-ink-2">برنامه‌ی مراجعه بعد از انتخاب فروشگاه و پیشنهاد ساخته می‌شود. نخست محصول و فروشنده را انتخاب کنید.</p></Card>;
  }
  const hoursOutside = ctx?.hours.state === "OUTSIDE_DECLARED";
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unsupported");
      await navigator.clipboard.writeText(exportText);
      setFallback(null); setMsg({ kind: "ok", text: "فهرست مراجعه کپی شد (برای استفاده‌ی خودتان؛ پیامی ارسال نشد)." });
    } catch { setFallback(exportText); setMsg({ kind: "warn", text: "کپی خودکار انجام نشد؛ متن زیر را دستی کپی کنید." }); }
  };
  const mark = (item: ChecklistItemId, kind: "done" | "skipped") => { const r = dispatch({ type: "CHECK", item, kind }); if (!r.ok) setMsg({ kind: "warn", text: r.messageFa }); };

  return (
    <div className="space-y-3" data-testid="tab-visit">
      <Card className="space-y-2">
        <label htmlFor="mission-visit" className="flex items-center gap-1.5 text-sm font-bold"><CalendarClock aria-hidden size={16} />زمان مراجعه (وقت تهران)</label>
        <div className="flex flex-wrap items-center gap-2">
          <input id="mission-visit" type="datetime-local" step={60} className={cn(inputStyles, "max-w-[16rem]")} value={m.visit ?? visitDefault} onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.target.value)) dispatch({ type: "SET_VISIT", visit: e.target.value }); }} data-testid="mission-visit-input" />
          <Button variant="secondary" onClick={() => dispatch({ type: "SET_VISIT", visit: null })} disabled={m.visit === null} data-testid="visit-now">همین حالا</Button>
        </div>
        <p className="text-xs leading-6 text-ink-2" data-testid="visit-hours">{ctx ? ctx.hours.labelFa : failed ? "اطلاعات داده دریافت نشد؛ ساعت سنجیده نشد (بسته یا باز فرض نمی‌شود)" : "در حال بارگذاری…"}. فقط ساعت اعلام‌شده محاسبه می‌شود؛ باز بودن واقعی یا تعطیلات رسمی بررسی نمی‌شود. اگر زمان یا فروشنده را عوض کنید، فقط بررسی‌های وابسته به آن دوباره باید مرور شوند.</p>
        {!m.visit ? <p className="text-xs leading-6 text-warn-ink">برای «آماده مراجعه» شدن، زمان مراجعه را صریحاً انتخاب کنید (الان «همین حالا» حساب می‌شود).</p> : null}
        {hoursOutside ? <p role="alert" className="rounded-xl bg-danger-bg p-3 text-sm leading-7 text-danger-ink" data-testid="visit-outside">این زمان خارج از ساعت اعلام‌شده‌ی فروشگاه است. زمان را عوض کنید یا در تب «جایگزین‌ها» راه دیگری انتخاب کنید.</p> : null}
      </Card>

      <Card className="space-y-3" data-testid="checklist">
        <div className="flex items-center justify-between gap-2"><h2 className="font-bold">فهرست آماده‌سازی</h2><Badge tone="neutral">{toFaDigits(CHECKLIST.filter((c) => itemState(m, c.id).state !== "pending").length)} از {toFaDigits(CHECKLIST.length)}</Badge></div>
        <p className="text-xs leading-6 text-ink-2">تیک زدن یعنی «من این را مرور کردم»، نه اینکه موجودی یا قیمت تأیید شده است.</p>
        <ul className="space-y-2">
          {CHECKLIST.map((c) => {
            const st = itemState(m, c.id);
            const blockedHours = c.id === "check_hours" && hoursOutside;
            return (
              <li key={c.id} className="space-y-1.5 rounded-xl border border-line p-3" data-testid={`check-${c.id}`} data-state={st.state}>
                <div className="flex items-start gap-2">
                  <span aria-hidden className={cn("mt-1 grid size-5 shrink-0 place-items-center rounded-full border text-[11px]", st.state === "done" ? "border-ok-ink bg-ok-bg text-ok-ink" : st.state === "skipped" ? "border-line bg-surface-2 text-ink-2" : "border-dashed border-line")}>{st.state === "done" ? <Check size={12} /> : st.state === "skipped" ? <SkipForward size={11} /> : null}</span>
                  <div className="min-w-0 flex-1 text-sm leading-7"><span className="font-semibold">{c.titleFa}</span>{c.required ? null : <span className="text-ink-2"> (اختیاری)</span>}<span className="block text-xs text-ink-2">{c.whyFa}</span>
                    <span className="sr-only">وضعیت: {STATE_FA[st.state]}</span></div>
                  <Badge tone={st.state === "done" ? "ok" : st.state === "skipped" ? "neutral" : "warn"}>{st.derived ? "ثبت‌شده توسط شما" : STATE_FA[st.state]}</Badge>
                </div>
                <div className="flex flex-wrap gap-2 ps-7">
                  {c.id === "contact_result" ? (
                    st.state === "pending" ? <><Button variant="secondary" onClick={() => onTab("inquiry")} data-testid="goto-inquiry">باز کردن پرسش و پاسخ</Button><Button variant="ghost" onClick={() => mark(c.id, "skipped")} data-testid="skip-contact_result">بدون پرسش ادامه می‌دهم</Button></> : null
                  ) : c.id === "open_map" ? (
                    facts?.shopMapHref ? <a href={facts.shopMapHref} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-4 text-sm text-brand" onClick={() => mark("open_map", "done")} data-testid="open-map"><MapPin aria-hidden size={14} />باز کردن نقشه (مکان ثبت‌شده در داده)<ExternalLink aria-hidden size={12} /><span className="sr-only"> (پنجره‌ی جدید)</span></a> : <span className="text-xs text-ink-2">مختصات معتبری برای این فروشگاه نیست.</span>
                  ) : st.state === "pending" ? (
                    <><Button variant="secondary" disabled={blockedHours} onClick={() => mark(c.id, "done")} data-testid={`done-${c.id}`}><Check aria-hidden size={14} />مرور کردم</Button>{!c.required || !blockedHours ? <Button variant="ghost" onClick={() => mark(c.id, "skipped")} data-testid={`skip-${c.id}`}><SkipForward aria-hidden size={14} />رد می‌کنم</Button> : null}</>
                  ) : <Button variant="ghost" onClick={() => dispatch({ type: "UNCHECK", item: c.id })} data-testid={`undo-${c.id}`}><Undo2 aria-hidden size={14} />برگرداندن</Button>}
                </div>
                {c.id === "verify_location" ? <p className="ps-7 text-xs leading-6 text-ink-2" data-testid="location-line">{!ctx ? "در حال بارگذاری نشانی از داده…" : ctx.shop.address ? <>نشانی ثبت‌شده در داده: <bdi>{ctx.shop.address}</bdi>. اگر طبقه یا واحد در آن نیست، از فروشنده بپرسید.</> : "نشانی دقیق (طبقه/واحد) در داده نامعلوم است؛ از فروشنده بپرسید."}</p> : null}
                {blockedHours ? <p className="ps-7 text-xs text-danger-ink">تا زمانی که زمان مراجعه خارج از ساعت اعلام‌شده است، این مورد «مرور شد» نمی‌شود.</p> : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="space-y-3" data-testid="readiness" data-ready={view.readiness.ready ? "1" : "0"}>
        <h2 className="flex items-center gap-1.5 font-bold"><Flag aria-hidden size={16} />{view.readiness.ready ? "آماده مراجعه" : "هنوز آماده نیستید"}</h2>
        {view.readiness.ready ? <p className="text-sm leading-7">بررسی‌های لازم را مرور کرده‌اید. <strong>این به معنی «موجودی تأییدشده» نیست</strong>؛ پیش از حرکت دوباره موجودی و قیمت امروز را بپرسید.</p>
          : <ul className="list-disc space-y-1 ps-5 text-sm leading-7">{view.readiness.blockers.map((b) => <li key={b.code}>{b.textFa}</li>)}</ul>}
        <ul className="list-disc space-y-1 ps-5 text-xs leading-6 text-ink-2">{view.readiness.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="flex flex-wrap gap-2">
          <Button onClick={copy} variant="secondary" data-testid="copy-checklist"><ClipboardCopy aria-hidden size={16} />کپی فهرست مراجعه</Button>
          <Button disabled={!view.readiness.ready} onClick={() => { const r = dispatch({ type: "MARK_VISITED" }, { readyNow: view.readiness.ready }); setMsg(r.ok ? { kind: "ok", text: "ثبت شد که مراجعه کرده‌اید؛ برنامه چیزی را تأیید نمی‌کند." } : { kind: "warn", text: r.messageFa }); }} data-testid="mark-visited">مراجعه انجام شد</Button>
        </div>
        <p role="status" aria-live="polite" data-testid="visit-msg" className={cn("min-h-6 text-sm", msg?.kind === "warn" ? "font-semibold text-warn-ink" : "text-ok-ink")}>{msg?.text ?? ""}</p>
        {fallback ? <textarea readOnly value={fallback} rows={8} className={cn(inputStyles, "min-h-40 leading-7")} aria-label="متن فهرست مراجعه برای کپی دستی" data-testid="checklist-fallback" onFocus={(e) => e.currentTarget.select()} /> : null}
      </Card>
    </div>
  );
}
