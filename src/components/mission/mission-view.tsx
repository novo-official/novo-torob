"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Compass, Flag, Loader2, SearchX } from "lucide-react";
import { activeInquiry, PHASE_FA, RECOVERY_TRIGGER_FA, type MissionEvent, type RecoveryTrigger, type ShoppingMissionV1 } from "@/domain/mission";
import type { NextAction } from "@/domain/inquiry";
import { Badge, ButtonLink, Card, EmptyState } from "@/components/ui";
import { InquiryWorkspace, type InquiryBinding } from "@/components/inquiry/inquiry-workspace";
import { DeviceTab } from "@/components/mission/device-tab";
import { StorageBadge, Stepper } from "@/components/mission/mission-ui";
import { RecoverTab } from "@/components/mission/recover-tab";
import { SummaryTab } from "@/components/mission/summary-tab";
import { useMission } from "@/components/mission/use-mission";
import { useMissionFacts } from "@/components/mission/use-facts";
import { VisitTab } from "@/components/mission/visit-tab";
import { cn } from "@/lib/cn";
import { deriveMissionView, type MissionView } from "@/lib/mission-derive";
import { missionLinks } from "@/lib/mission-links";
import { seedOfMission } from "@/lib/mission-seed";
import { buildMissionPageHref, buildMissionStartHref, isMissionTab, MISSION_TABS, type MissionTab } from "@/lib/mission-url";
import { buildAdvisorHref } from "@/lib/advisor-url";
import { toFaDigits } from "@/lib/format";

const TAB_FA: Record<MissionTab, string> = { summary: "خلاصه", visit: "برنامه‌ی مراجعه", inquiry: "پرسش و پاسخ", recover: "جایگزین‌ها", device: "ذخیره‌سازی" };

interface Step { labelFa: string; hintFa: string; tab?: MissionTab; href?: string }
function nextStep(m: ShoppingMissionV1, v: MissionView): Step {
  if (m.status === "VISITED") return { labelFa: "ماموریت به پایان رسید", hintFa: "اگر چیزی عوض شد دوباره بازش کنید.", tab: "summary" };
  if (m.status === "ABANDONED") return { labelFa: "ماموریت رها شده است", hintFa: "می‌توانید دوباره بازش کنید.", tab: "device" };
  if (v.triggers.length) return { labelFa: "راه جایگزین را انتخاب کنید", hintFa: RECOVERY_TRIGGER_FA[v.triggers[0]!], tab: "recover" };
  if (!m.product) return { labelFa: "محصول را انتخاب کنید", hintFa: "از مشاور یا جست‌وجو، یک محصول انتخاب کنید.", href: buildAdvisorHref({ category: m.need.category ?? undefined }) };
  if (!m.shop) return { labelFa: m.shortlist.length >= 2 ? "فروشنده را مقایسه و انتخاب کنید" : "فروشنده‌ی نزدیک را انتخاب کنید", hintFa: "فقط فروشگاه‌هایی که پیشنهاد ثبت‌شده‌ی همین محصول دارند.", href: m.shortlist.length >= 2 ? missionLinks(m).compare : missionLinks(m).sellers };
  if (v.phase === "VISIT_READY") return { labelFa: "برنامه‌ی مراجعه آماده است", hintFa: "پیش از حرکت دوباره موجودی و قیمت امروز را بپرسید.", tab: "visit" };
  const inq = activeInquiry(m);
  if (!inq || inq.status === "DRAFT" || inq.status === "COPIED") return { labelFa: "پرسش را بسازید و خودتان بپرسید", hintFa: "هیچ پیامی از برنامه ارسال نمی‌شود.", tab: "inquiry" };
  if (!inq.replies.length) return { labelFa: "پاسخ فروشنده را ثبت کنید", hintFa: "یا «پاسخی نیامد» را بزنید.", tab: "inquiry" };
  return { labelFa: "برنامه‌ی مراجعه را کامل کنید", hintFa: `${toFaDigits(v.readiness.remaining.length)} بررسی لازم مانده است.`, tab: "visit" };
}

export function MissionView({ id, seed, visitDefault }: { id: string; seed: MissionEvent[] | null; visitDefault: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const tabParam = sp.get("tab");
  const tab: MissionTab = isMissionTab(tabParam) ? tabParam : "summary";
  const api = useMission(id, seed);
  const m = api.mission;
  const { facts, loading, failed } = useMissionFacts(m);
  const view = useMemo(() => (m ? deriveMissionView(m, facts?.context ?? null) : null), [m, facts]);
  const [focusTrigger, setFocusTrigger] = useState<RecoveryTrigger | null>(null);
  // when every browser store is blocked the (non-sensitive) ids ride in the URL so a refresh can rebuild the mission
  const urlSeed = useCallback((mm: ShoppingMissionV1 | null) => (api.where === "MEMORY" && mm ? `${new URL(buildMissionStartHref(seedOfMission(mm)), "http://x").searchParams.toString()}` : ""), [api.where]);
  const go = useCallback((t: MissionTab) => { const q = urlSeed(m); const base = buildMissionPageHref(id, t); router.replace(q ? `${base}${base.includes("?") ? "&" : "?"}${q}` : base, { scroll: false }); }, [router, id, m, urlSeed]);
  useEffect(() => {
    if (api.where !== "MEMORY" || !m) return;
    const u = new URL(window.location.href);
    const fresh = new URLSearchParams(urlSeed(m)); const tabP = u.searchParams.get("tab");
    const next = new URL(u.pathname, u.origin); if (tabP) next.searchParams.set("tab", tabP); fresh.forEach((v, k) => next.searchParams.set(k, v));
    if (next.href !== u.href) window.history.replaceState(window.history.state, "", next.href);
  }, [api.where, m, urlSeed]);

  const ctx = facts?.context ?? null;
  const binding: InquiryBinding | null = useMemo(() => {
    if (!m) return null;
    return {
      state: activeInquiry(m),
      dispatch: (e, defaults) => { api.dispatch({ type: "INQUIRY", event: e, defaults }); },
      onVisitChange: (v) => { api.dispatch({ type: "SET_VISIT", visit: v }); },
      onNextAction: (a: NextAction) => {
        const t: RecoveryTrigger | null = a.id === "FIND_OTHER_SELLER" || a.id === "ALTERNATIVE_PRODUCT" ? (view?.allTriggers[0] ?? "UNAVAILABLE") : a.id === "COMPARE_AGAIN" ? "PRICE_CHANGED" : null;
        if (t) { setFocusTrigger(t); go("recover"); return true; }
        if (a.id === "CHECK_VISIT_HOURS") { go("visit"); return true; }
        return false;
      },
      privacyNoteFa: api.where === "DEVICE" ? "این پیش‌نویس و پاسخ‌های ثبت‌شده‌ی شما جزو ماموریت‌اند و چون «ذخیره روی این دستگاه» را زده‌اید در همین مرورگر می‌مانند. شماره‌ی تلفن و موقعیت دقیق هرگز ذخیره نمی‌شود. حالت شبیه‌سازی هیچ‌وقت ذخیره نمی‌شود." : "این پیش‌نویس و پاسخ‌ها جزو ماموریتِ موقتِ همین تب‌اند و با بستن تب پاک می‌شوند (مگر «ذخیره روی این دستگاه» را بزنید). شماره‌ی تلفن و موقعیت دقیق هرگز ذخیره نمی‌شود. حالت شبیه‌سازی هیچ‌وقت ذخیره نمی‌شود.",
    };
  }, [m, api, view, go]);

  if (api.state === "loading") return <p role="status" className="flex items-center gap-2 rounded-xl bg-surface-2 p-4 text-sm" data-testid="mission-loading"><Loader2 aria-hidden size={16} className="animate-spin motion-reduce:animate-none" />در حال بارگذاری ماموریت…</p>;
  if (api.state === "missing" || api.state === "unreadable" || !m || !view) {
    const unreadable = api.state === "unreadable";
    return (
      <EmptyState icon={<SearchX size={22} />} title={unreadable ? "این ماموریت قابل‌خواندن نیست" : "این ماموریت روی این دستگاه پیدا نشد"} action={<><ButtonLink href="/missions">ماموریت‌های این دستگاه</ButtonLink><ButtonLink href="/discover" variant="secondary">شروع دوباره</ButtonLink></>}>
        <p className="leading-7" data-testid="mission-missing">{unreadable ? "رکورد ذخیره‌شده خراب یا از نسخه‌ی ناسازگار است و اعتماد نمی‌شود. از صفحه‌ی ماموریت‌ها می‌توانید آن را حذف کنید." : "ماموریت‌های موقت با بستن تب پاک می‌شوند و ماموریت‌های ذخیره‌شده فقط در همان مرورگری که ذخیره کرده‌اید دیده می‌شوند. شناسه‌ی ماموریت به‌تنهایی چیزی را باز نمی‌کند."}</p>
      </EmptyState>
    );
  }

  const step = nextStep(m, view);
  const tabs = MISSION_TABS.filter((t) => t !== "recover" || !!m.shop);
  return (
    <div className="space-y-4" data-testid="mission-root" data-phase={view.phase} data-where={api.where ?? ""} data-rev={m.rev}>
      {api.conflict ? <p role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-bg p-3 text-sm text-warn-ink" data-testid="conflict-banner">این ماموریت در تب دیگری تغییر کرده بود؛ نسخه‌ی تازه بارگذاری شد.<button type="button" className="min-h-11 underline" onClick={api.dismissConflict}>باشه</button></p> : null}
      <Card className="space-y-3" data-testid="mission-header">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={view.phase === "VISIT_READY" ? "ok" : view.phase === "ABANDONED" ? "neutral" : "brand"} data-testid="phase-badge">{PHASE_FA[view.phase]}</Badge>
          <StorageBadge where={api.where} />
          {loading ? <span className="text-xs text-ink-2" role="status">در حال تازه‌سازی از داده…</span> : null}
        </div>
        <h2 className="text-lg font-extrabold leading-8"><bdi>{facts?.product?.title ?? (m.need.text ? `نیاز: ${m.need.text}` : "ماموریت خرید")}</bdi></h2>
        <Stepper phase={view.phase} />
        <div className="rounded-xl border border-brand/40 bg-brand-soft/40 p-3" data-testid="primary-step">
          <p className="flex items-center gap-1.5 text-sm font-bold"><Flag aria-hidden size={14} />گام بعد</p>
          <p className="font-semibold leading-7" data-testid="primary-step-label">{step.labelFa}</p>
          <p className="text-xs leading-6 text-ink-2">{step.hintFa}</p>
          {step.href ? <ButtonLink href={step.href} className="mt-2" data-testid="primary-cta"><Compass aria-hidden size={16} />{step.labelFa}</ButtonLink>
            : step.tab && step.tab !== tab ? <button type="button" className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-[0.95rem] font-semibold text-brand-ink hover:bg-brand-hover" onClick={() => go(step.tab!)} data-testid="primary-cta"><ArrowLeft aria-hidden size={16} />{step.labelFa}</button> : null}
        </div>
      </Card>

      <div role="tablist" aria-label="بخش‌های ماموریت" className="flex flex-wrap gap-1.5" data-testid="mission-tabs">
        {tabs.map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} data-testid={`tab-${t}-btn`} type="button" onClick={() => go(t)}
            className={cn("relative min-h-11 rounded-full border px-3.5 text-sm font-semibold", tab === t ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2")}>
            {TAB_FA[t]}{t === "recover" && view.triggers.length ? <span aria-label="نیازمند تصمیم" className="ms-1.5 inline-block size-2 rounded-full bg-danger-ink align-middle" /> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        {tab === "summary" ? <SummaryTab m={m} facts={facts} view={view} onTab={go} failed={failed} /> : null}
        {tab === "visit" ? <VisitTab m={m} facts={facts} failed={failed} view={view} dispatch={api.dispatch} onTab={go} visitDefault={visitDefault} /> : null}
        {tab === "inquiry" ? (
          !m.shop ? <Card className="space-y-2" data-testid="tab-inquiry"><h2 className="font-bold">پرسش و پاسخ</h2><p className="text-sm leading-7 text-ink-2">برای ساختن پرسش، نخست فروشگاه و پیشنهاد را انتخاب کنید.</p></Card>
            : ctx && binding && ctx.offer.id === m.shop.offerId ? <div data-testid="tab-inquiry"><InquiryWorkspace ctx={ctx} visitDefault={visitDefault} back={null} binding={binding} /></div>
            : <p role="status" className="rounded-xl bg-surface-2 p-3 text-sm" data-testid="tab-inquiry">{facts?.error ? "اطلاعات این پیشنهاد در داده تأیید نشد؛ فروشگاه را دوباره انتخاب کنید." : "در حال بارگذاری زمینه‌ی پرسش از داده…"}</p>
        ) : null}
        {tab === "recover" ? <RecoverTab m={m} ctx={ctx} view={view} dispatch={api.dispatch} focusTrigger={focusTrigger} /> : null}
        {tab === "device" ? <DeviceTab m={m} where={api.where} issue={api.issue} dispatch={api.dispatch} saveToDevice={api.saveToDevice} forgetFromDevice={api.forgetFromDevice} remove={api.remove} /> : null}
      </div>
      <p className="flex flex-wrap items-center gap-3 text-sm"><Link href="/missions" className="min-h-11 py-2 text-brand hover:underline">ماموریت‌های این دستگاه</Link>{m.status !== "ACTIVE" ? <button type="button" className="min-h-11 text-brand underline" onClick={() => api.dispatch({ type: "REOPEN" })} data-testid="reopen">بازکردن دوباره‌ی ماموریت</button> : <button type="button" className="min-h-11 text-ink-2 underline" onClick={() => api.dispatch({ type: "ABANDON" })} data-testid="abandon">رها کردن ماموریت</button>}</p>
    </div>
  );
}
