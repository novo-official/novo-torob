"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Check, ClipboardCopy, MessageSquareOff, PhoneOff, Plus, RotateCcw, Trash2, UserCheck } from "lucide-react";
import { deriveOutcome, initialInquiryState, inquiryReducer, STATUS_FA, type DemoScenarioId, type InquiryEvent, type InquiryQuestion, type InquiryState, type NextAction, type ReplyEvidence } from "@/domain/inquiry";
import { runDemoScenario, type DemoRun } from "@/domain/inquiry-demo";
import { LIMITS } from "@/domain/inquiry-parse";
import { buildQuestions, composeFollowUp, composeInquiry, composeReconfirm, defaultQuestionIds } from "@/domain/inquiry-questions";
import type { InquiryContext } from "@/domain/inquiry";
import { ContextCard, PublicLinks } from "@/components/inquiry/context-card";
import { DecisionPanel } from "@/components/inquiry/decision-panel";
import { DemoBanner, DemoPanel } from "@/components/inquiry/demo-panel";
import { ProvenanceBadge } from "@/components/inquiry/provenance-badge";
import { ReplyForm } from "@/components/inquiry/reply-form";
import { Badge, Button, Card, inputStyles } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatToman, toFaDigits } from "@/lib/format";
import { clearInquiry, loadInquiry, saveInquiry, storageKey } from "@/lib/inquiry-storage";
import { buildMissionHref } from "@/lib/mission-url";

const nowIso = () => new Date().toISOString();
type Step = "compose" | "follow" | "reply" | "outcome";
const STEPS: ReadonlyArray<[Step, string]> = [["compose", "۱. پرسش"], ["follow", "۲. پیگیری"], ["reply", "۳. پاسخ"], ["outcome", "۴. نتیجه"]];
const statusOfDemo = (runs: DemoRun[]): InquiryState["status"] => {
  const last = runs.at(-1);
  if (!last) return "DRAFT";
  if (!last.reply) return "NO_RESPONSE";
  return last.reply.stock === "yes" ? "USER_REPORTED_AVAILABLE" : last.reply.stock === "no" ? "USER_REPORTED_UNAVAILABLE" : "USER_ENTERED_REPLY";
};

/**
 * Phase 8: when the workspace is embedded in a mission, the MANUAL inquiry state is owned by the mission (same Phase 6 reducer) instead of
 * this tab's sessionStorage. The DEMO mode below is unaffected: it stays in component memory and has no path into the binding.
 */
export interface InquiryBinding {
  state: InquiryState | null;
  dispatch: (e: InquiryEvent, defaults: string[]) => void;
  onVisitChange: (visit: string) => void;
  /** return true when the mission handled the next action itself (e.g. opened the recovery panel) */
  onNextAction?: (a: NextAction) => boolean;
  privacyNoteFa: string;
}

export function InquiryWorkspace({ ctx, visitDefault, back, binding }: { ctx: InquiryContext; visitDefault: string; back: string | null; binding?: InquiryBinding }) {
  const router = useRouter();
  const qs = useMemo(() => buildQuestions(ctx), [ctx]);
  const defaults = useMemo(() => defaultQuestionIds(qs), [qs]);
  const key = storageKey({ product: ctx.product.id, shop: ctx.shop.id, offer: ctx.offer.id });

  const [localManual, setManual] = useState<InquiryState>(() => initialInquiryState(defaults));
  const manual: InquiryState = binding ? (binding.state ?? initialInquiryState(defaults)) : localManual;
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<"MANUAL" | "DEMO">("MANUAL");
  const [demoConsent, setDemoConsent] = useState(false);
  const [demoRuns, setDemoRuns] = useState<DemoRun[]>([]);
  const [scenario, setScenario] = useState<DemoScenarioId>("NOT_AVAILABLE");
  const [msg, setMsg] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  // phones show ONE step at a time (all four are always visible on large screens); nothing is hidden from keyboard/AT users because tabs are real tabs
  const [step, setStep] = useState<Step>("compose");
  const [qOpen, setQOpen] = useState(false);
  const only = (x: Step) => cn(step !== x && "max-lg:hidden");
  const [fallbackCopy, setFallbackCopy] = useState(false);
  const [custom, setCustom] = useState("");
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const replyRef = useRef<HTMLDivElement | null>(null);
  const visitRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (binding) { setHydrated(true); return; } // the mission owns the state
    // hydrate from this tab's sessionStorage after mount (server render and first client render are identical)
    const s = loadInquiry(key, qs.map((q) => q.id));
    if (s) setManual(s);
    setHydrated(true);
  }, [key, qs, binding]);
  useEffect(() => { if (hydrated && !binding) saveInquiry(key, localManual); }, [localManual, hydrated, key, binding]);

  const bindingDispatch = binding?.dispatch;
  const dispatch = useCallback((e: InquiryEvent) => { if (bindingDispatch) bindingDispatch(e, defaults); else setManual((s) => inquiryReducer(s, e, defaults)); }, [defaults, bindingDispatch]);

  const byId = useMemo(() => {
    const m = new Map<string, InquiryQuestion>(qs.map((q) => [q.id, q]));
    for (const c of manual.customQuestions) m.set(c.id, { id: c.id, intent: "custom", textFa: c.textFa, reasonFa: "پرسش دلخواه شما", defaultOn: true, custom: true });
    return m;
  }, [qs, manual.customQuestions]);
  const ordered = manual.questionIds.map((id) => byId.get(id)).filter((q): q is InquiryQuestion => !!q);
  const generated = useMemo(() => composeInquiry(ctx, ordered), [ctx, ordered]);
  const text = manual.draftOverride ?? generated;
  const available = qs.filter((q) => !manual.questionIds.includes(q.id));

  const setIds = (ids: string[]) => dispatch({ type: "SET_QUESTIONS", ids, at: nowIso() });
  const move = (i: number, d: -1 | 1) => { const ids = [...manual.questionIds]; const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; setIds(ids); };

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unsupported");
      await navigator.clipboard.writeText(text);
      dispatch({ type: "COPY", at: nowIso() });
      setFallbackCopy(false);
      setMsg({ kind: "ok", text: "متن کپی شد. ارسال آن کاملاً با خودتان است؛ هیچ پیامی از این برنامه فرستاده نمی‌شود." });
      setStep("follow");
    } catch {
      setFallbackCopy(true);
      areaRef.current?.focus();
      areaRef.current?.select();
      setMsg({ kind: "warn", text: "کپی خودکار انجام نشد؛ متن انتخاب شد، دستی کپی کنید (Ctrl+C) و بعد «متن را دستی کپی کردم» را بزنید." });
    }
  };

  const outcome = useMemo(() => {
    if (mode === "DEMO") {
      const replies = demoRuns.map((r) => r.reply).filter((r): r is ReplyEvidence => !!r);
      return deriveOutcome(ctx, { status: statusOfDemo(demoRuns), replies, nextAction: null }, "DEMO");
    }
    return deriveOutcome(ctx, { status: manual.status, replies: manual.replies, nextAction: manual.nextAction, previous: manual.previous }, "MANUAL");
  }, [ctx, mode, demoRuns, manual.status, manual.replies, manual.nextAction, manual.previous]);

  const focusComposer = () => { setStep("compose"); window.setTimeout(() => { areaRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" }); areaRef.current?.focus(); }, 0); };
  const onAction = (a: NextAction) => {
    if (mode === "MANUAL") dispatch({ type: "SELECT_NEXT_ACTION", action: a.id, at: nowIso() });
    if (mode === "MANUAL" && binding?.onNextAction?.(a)) return;
    if (a.id === "CLARIFY_VARIANT") {
      if (!manual.questionIds.includes("q_variant")) setIds(["q_variant", ...manual.questionIds]); else dispatch({ type: "EDIT_DRAFT", text: null, at: nowIso() });
      setMsg({ kind: "ok", text: "پرسش «مدل/نسخه‌ی دقیق» در پیش‌نویس فعال شد؛ پیش‌نویس را دوباره کپی کنید." });
      focusComposer();
    } else if (a.id === "FOLLOW_UP") {
      dispatch({ type: "EDIT_DRAFT", text: composeFollowUp(ctx), at: nowIso() });
      setMsg({ kind: "ok", text: "پیام پیگیری کوتاه جایگزین پیش‌نویس شد؛ ارسالش با خودتان است." });
      focusComposer();
    } else if (a.id === "RECONFIRM_BEFORE_VISIT") {
      dispatch({ type: "EDIT_DRAFT", text: composeReconfirm(ctx), at: nowIso() });
      setMsg({ kind: "ok", text: "متن «تأیید دوباره پیش از رفتن» آماده شد؛ ارسالش با خودتان است." });
      focusComposer();
    } else if (a.id === "CHECK_VISIT_HOURS") { visitRef.current?.scrollIntoView?.({ block: "center" }); visitRef.current?.focus(); }
    else if (a.id === "AWAIT_REPLY") { setStep("reply"); window.setTimeout(() => replyRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 0); }
  };

  const reset = () => { if (binding) dispatch({ type: "RESET", at: nowIso() }); else { clearInquiry(key); setManual(initialInquiryState(defaults)); } setFallbackCopy(false); setMsg({ kind: "ok", text: "پیش‌نویس و پاسخ‌های ثبت‌شده‌ی این پرسش پاک شد." }); };
  const runDemo = () => { setDemoRuns((r) => [...r, runDemoScenario(ctx, scenario, text)]); setMsg({ kind: "ok", text: "نمونه‌ی پاسخ شبیه‌سازی‌شده اضافه شد (واقعی نیست)." }); };
  const exitDemo = () => { setMode("MANUAL"); setDemoRuns([]); setDemoConsent(false); setMsg({ kind: "ok", text: "حالت شبیه‌سازی بسته شد و همه‌ی داده‌ی نمونه پاک شد؛ چیزی ذخیره نشد." }); };

  const changeVisit = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return;
    if (binding) { binding.onVisitChange(v); return; }
    router.replace(buildMissionHref({ product: ctx.product.id, variant: ctx.variant.selectedGroupId, shop: ctx.shop.id, offer: ctx.offer.id, visit: v, back }), { scroll: false });
  };

  const statusLine = mode === "DEMO" ? "شبیه‌سازی (فقط دمو)" : STATUS_FA[manual.status];
  return (
    <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:items-start lg:gap-6 lg:space-y-0" data-testid="inquiry-workspace" data-mode={mode}>
      {mode === "DEMO" ? <div className="lg:col-span-2"><DemoBanner onExit={exitDemo} /></div> : null}

      <div className="space-y-5 lg:col-start-2 lg:row-start-2">
        <ContextCard ctx={ctx}>
          <div className="space-y-2 border-t border-line pt-3">
            <label htmlFor="visit" className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock aria-hidden size={16} />زمان مراجعه‌ی برنامه‌ریزی‌شده (به وقت تهران)</label>
            <input id="visit" ref={visitRef} type="datetime-local" step={60} className={cn(inputStyles, "max-w-[16rem]")} value={ctx.visit.input ?? visitDefault} onChange={(e) => changeVisit(e.target.value)} data-testid="visit-input" />
            <p className="text-xs leading-6 text-ink-2">{ctx.hours.labelFa}. فقط ساعت اعلام‌شده بررسی می‌شود، نه باز بودن واقعی.</p>
          </div>
        </ContextCard>
      </div>

      <div className="space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-2">
        <p role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm" data-testid="status-line">
          <span className="text-ink-2">وضعیت پرسش:</span><Badge tone={mode === "DEMO" ? "warn" : "brand"} data-testid="status-badge">{statusLine}</Badge>
          {mode === "MANUAL" ? <ProvenanceBadge kind={manual.replies.length ? "USER_REPORTED" : "UNKNOWN"} short /> : <ProvenanceBadge kind="DEMO_SIMULATED" short />}
        </p>
        <div role="tablist" aria-label="مراحل پرسش از فروشنده" className="grid grid-cols-4 gap-1 lg:hidden" data-testid="inquiry-steps">
          {STEPS.map(([k, label]) => (
            <button key={k} type="button" role="tab" id={`istep-${k}`} aria-selected={step === k} aria-controls={`ipanel-${k}`} data-testid={`istep-${k}`} onClick={() => setStep(k)}
              className={cn("min-h-11 rounded-xl border px-1 text-xs font-semibold", step === k ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2")}>{label}</button>
          ))}
        </div>
        <p role="status" aria-live="polite" data-testid="live-msg" className={cn("min-h-6 text-sm", msg?.kind === "warn" ? "font-semibold text-warn-ink" : "text-ok-ink")}>{msg ? <>{msg.kind === "ok" ? <Check aria-hidden size={14} className="me-1 inline" /> : null}{msg.text}</> : null}</p>

        {/* ---------- mode switch ---------- */}
        <Card className={cn("space-y-3", only("follow"))} aria-labelledby="mode-h" id="ipanel-follow">
          <h2 id="mode-h" className="font-bold">چگونه پیش می‌روید؟</h2>
          <div role="radiogroup" aria-label="حالت پیگیری" className="grid gap-2 sm:grid-cols-2">
            <button type="button" role="radio" aria-checked={mode === "MANUAL"} data-testid="mode-manual" onClick={() => setMode("MANUAL")} className={cn("min-h-11 rounded-2xl border p-3 text-start text-sm", mode === "MANUAL" ? "border-brand bg-brand-soft" : "border-line bg-surface")}>
              <span className="block font-semibold">پیگیری دستی</span><span className="block text-xs text-ink-2">متن را کپی می‌کنید، خودتان می‌پرسید و پاسخ را ثبت می‌کنید</span>
            </button>
            <button type="button" role="radio" aria-checked={mode === "DEMO"} data-testid="mode-demo" disabled={mode !== "DEMO" && !demoConsent} onClick={() => setMode("DEMO")} className={cn("min-h-11 rounded-2xl border border-dashed p-3 text-start text-sm disabled:opacity-60", mode === "DEMO" ? "border-warn-ink bg-warn-bg" : "border-warn-line bg-surface")}>
              <span className="block font-semibold">شبیه‌سازی پاسخ فروشنده — فقط برای دمو</span><span className="block text-xs text-ink-2">پاسخ ساختگی با برچسب روشن؛ هیچ ارتباط واقعی نیست</span>
            </button>
          </div>
          {mode === "MANUAL" ? (
            <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-5" checked={demoConsent} onChange={(e) => setDemoConsent(e.target.checked)} data-testid="demo-consent" />می‌دانم حالت شبیه‌سازی فقط نمونه‌ی ساختگی است، چیزی به فروشنده نمی‌رسد و نتیجه‌اش ذخیره یا به‌عنوان گزارش واقعی ثبت نمی‌شود.</label>
          ) : null}
        </Card>

        {/* ---------- composer ---------- */}
        <Card className={cn("space-y-4", only("compose"))} aria-labelledby="composer-h" id="ipanel-compose">
          <h2 id="composer-h" className="font-bold">۱. پرسش‌ها را بسازید</h2>
          <button type="button" className="min-h-11 text-start text-sm font-semibold text-brand underline lg:hidden" aria-expanded={qOpen} aria-controls="question-editor" onClick={() => setQOpen((v) => !v)} data-testid="q-toggle">{qOpen ? "بستن ویرایش پرسش‌ها" : `ویرایش پرسش‌ها (${toFaDigits(ordered.length)} فعال)`}</button>
          <div id="question-editor" className={cn("space-y-4", !qOpen && "max-lg:hidden")}>
          <p className="text-xs leading-6 text-ink-2">پیش‌فرض‌ها از شواهد همین پیشنهاد آمده‌اند؛ هر پرسش دلیل دارد و می‌توانید خاموش، جابه‌جا یا اضافه کنید.</p>
          <ol className="space-y-2" aria-label="پرسش‌های انتخاب‌شده" data-testid="question-list">
            {ordered.map((q, i) => (
              <li key={q.id} className="flex items-start gap-2 rounded-xl border border-line p-2.5" data-question-id={q.id}>
                <div className="min-w-0 flex-1 text-sm leading-7"><span className="text-ink-2">{toFaDigits(i + 1)}. </span><bdi>{q.textFa}</bdi><span className="block text-xs text-ink-2">{q.reasonFa}</span></div>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <button type="button" className="grid size-11 place-items-center rounded-lg border border-line" aria-label={`بالا بردن پرسش ${toFaDigits(i + 1)}`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp aria-hidden size={16} /></button>
                  <button type="button" className="grid size-11 place-items-center rounded-lg border border-line" aria-label={`پایین بردن پرسش ${toFaDigits(i + 1)}`} onClick={() => move(i, 1)} disabled={i === ordered.length - 1}><ArrowDown aria-hidden size={16} /></button>
                  <button type="button" className="grid size-11 place-items-center rounded-lg border border-line text-danger-ink" aria-label={`حذف پرسش ${toFaDigits(i + 1)}`} data-testid="remove-question" onClick={() => (q.custom ? dispatch({ type: "REMOVE_CUSTOM", id: q.id, at: nowIso() }) : setIds(manual.questionIds.filter((x) => x !== q.id)))}><Trash2 aria-hidden size={16} /></button>
                </div>
              </li>
            ))}
            {ordered.length === 0 ? <li className="text-sm text-ink-2">هیچ پرسشی انتخاب نشده؛ پیام فقط معرفی کالاست.</li> : null}
          </ol>
          {available.length ? (
            <div className="space-y-1.5" role="group" aria-label="پرسش‌های قابل‌افزودن">
              <p className="text-xs font-semibold text-ink-2">افزودن پرسش:</p>
              <div className="flex flex-wrap gap-2">{available.map((q) => <button key={q.id} type="button" onClick={() => setIds([...manual.questionIds, q.id])} data-testid={`add-${q.id}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed border-brand px-3 text-sm text-brand"><Plus aria-hidden size={14} />{q.textFa.slice(0, 38)}{q.textFa.length > 38 ? "…" : ""}</button>)}</div>
            </div>
          ) : null}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) { dispatch({ type: "ADD_CUSTOM", id: `c_${Date.now().toString(36)}`, textFa: custom, at: nowIso() }); setCustom(""); } }}>
            <div className="min-w-[12rem] flex-1 space-y-1"><label htmlFor="custom-q" className="text-xs font-semibold text-ink-2">پرسش دلخواه (حداکثر {toFaDigits(LIMITS.maxCustomQuestions)})</label><input id="custom-q" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={LIMITS.custom} className={inputStyles} /></div>
            <Button type="submit" variant="secondary" disabled={!custom.trim() || manual.customQuestions.length >= LIMITS.maxCustomQuestions}>افزودن</Button>
          </form>

          </div>
          <div className="space-y-1.5">
            <label htmlFor="draft" className="text-sm font-semibold">متن پیام (قابل‌ویرایش)</label>
            <textarea id="draft" ref={areaRef} value={text} onChange={(e) => dispatch({ type: "EDIT_DRAFT", text: e.target.value, at: nowIso() })} maxLength={LIMITS.draft} rows={9} className={cn(inputStyles, "min-h-48 py-3 leading-8 [field-sizing:content] max-lg:max-h-72 max-lg:overflow-y-auto")} data-testid="draft" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
              <span>{toFaDigits(text.length)} / {toFaDigits(LIMITS.draft)} نویسه</span>
              {manual.draftOverride !== null ? <button type="button" className="min-h-11 underline" onClick={() => dispatch({ type: "EDIT_DRAFT", text: null, at: nowIso() })}>بازگشت به پیش‌نویس خودکار</button> : <span>پیش‌نویس خودکار (بدون شماره‌ی تلفن)</span>}
            </div>
          </div>
          {mode === "MANUAL" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={copy} data-testid="copy"><ClipboardCopy aria-hidden size={18} />کپی متن</Button>
              {fallbackCopy ? <Button variant="secondary" onClick={() => { dispatch({ type: "COPY", at: nowIso() }); setMsg({ kind: "ok", text: "ثبت شد که متن را دستی کپی کرده‌اید؛ ارسالش با خودتان است." }); }} data-testid="manual-copy-done">متن را دستی کپی کردم</Button> : null}
            </div>
          ) : <p className="text-sm text-ink-2">در حالت شبیه‌سازی نیازی به کپی نیست؛ متن بالا فقط پیام نمونه‌ی شما در گفت‌وگوی ساختگی می‌شود.</p>}
        </Card>

        {mode === "MANUAL" ? (
          <>
            <Card className={cn("space-y-4", only("follow"))} aria-labelledby="manual-h">
              <h2 id="manual-h" className="font-bold">۲. پیگیری دستی (خارج از این برنامه)</h2>
              <PublicLinks ctx={ctx} />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => { dispatch({ type: "MARK_CONTACTED", at: nowIso() }); setMsg({ kind: "ok", text: "ثبت شد که خودتان پرسیده‌اید (برنامه چیزی نفرستاده است)." }); setStep("reply"); }} data-testid="mark-contacted" disabled={manual.status !== "DRAFT" && manual.status !== "COPIED" && manual.status !== "NO_RESPONSE"}><UserCheck aria-hidden size={16} />خودم پرسیدم</Button>
                <Button variant="secondary" onClick={() => { dispatch({ type: "MARK_NO_RESPONSE", at: nowIso() }); setMsg({ kind: "ok", text: "ثبت شد: پاسخی نیامده." }); }} data-testid="no-response" disabled={manual.status !== "USER_MARKED_CONTACTED" && manual.status !== "COPIED" && manual.status !== "DRAFT"}><PhoneOff aria-hidden size={16} />پاسخی نیامد</Button>
                <Button variant="ghost" onClick={() => dispatch({ type: manual.status === "CANCELLED" ? "REOPEN" : "CANCEL", at: nowIso() })} data-testid="cancel"><MessageSquareOff aria-hidden size={16} />{manual.status === "CANCELLED" ? "بازگشایی پرسش" : "لغو پرسش"}</Button>
              </div>
            </Card>
            <div ref={replyRef} className={cn("scroll-mt-24 space-y-5", only("reply"))} id="ipanel-reply">
              {manual.status !== "CANCELLED" ? <ReplyForm ctx={ctx} onSubmit={(r) => { dispatch({ type: "ENTER_REPLY", reply: r, at: nowIso() }); setMsg({ kind: "ok", text: "پاسخ به‌عنوان گزارش شما ثبت شد؛ مستقلاً تأیید نشده است." }); setStep("outcome"); }} /> : null}
            {manual.replies.length ? (
              <Card className="space-y-3" aria-labelledby="replies-h" data-testid="replies">
                <h2 id="replies-h" className="font-bold">پاسخ‌های ثبت‌شده توسط شما</h2>
                <ul className="space-y-2">
                  {manual.replies.map((r) => (
                    <li key={r.id} className="space-y-1 rounded-xl border border-line p-3 text-sm" data-testid="reply-item" data-provenance={r.provenance}>
                      <ProvenanceBadge kind="USER_REPORTED" />
                      <p>موجودی: {r.stock === "yes" ? "گفت موجود است" : r.stock === "no" ? "گفت موجود نیست" : "نامعلوم"}{r.reportedPriceToman !== null ? ` · قیمت گفته‌شده: ${formatToman(r.reportedPriceToman)}` : ""}{r.model === "different" ? " · مدل متفاوت" : r.model === "same" ? " · مدل تأییدشده توسط فروشنده" : ""}</p>
                      {r.rawText ? <p className="whitespace-pre-line text-ink-2"><bdi>{r.rawText}</bdi></p> : null}
                      <button type="button" className="min-h-11 text-xs text-danger-ink underline" onClick={() => dispatch({ type: "REMOVE_REPLY", id: r.id, at: nowIso() })}>حذف این پاسخ</button>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            </div>
          </>
        ) : (
          <div className={only("reply")}><DemoPanel scenario={scenario} onScenario={setScenario} onRun={runDemo} runs={demoRuns} onClear={() => setDemoRuns([])} draft={text} /></div>
        )}

        <Card className={cn("space-y-2 border-dashed", only("outcome"))} aria-labelledby="privacy-h">
          <h2 id="privacy-h" className="text-sm font-bold">ذخیره‌سازی و حریم خصوصی</h2>
          <p className="text-xs leading-6 text-ink-2" data-testid="privacy-note">{binding ? binding.privacyNoteFa : "پیش‌نویس و پاسخ‌های ثبت‌شده‌ی شما فقط در همین تب مرورگر (sessionStorage) می‌ماند و با بستن تب یا دکمه‌ی زیر پاک می‌شود. شماره‌ی تلفن و مختصات هرگز ذخیره نمی‌شود. حالت شبیه‌سازی هیچ‌وقت ذخیره نمی‌شود و بعد از تازه‌سازی صفحه یا کپی نشانی فعال نیست."}</p>
          <Button variant="ghost" onClick={reset} data-testid="reset"><RotateCcw aria-hidden size={16} />پاک کردن پیش‌نویس و پاسخ‌ها</Button>
        </Card>
      </div>

      <div className={cn("lg:col-start-2 lg:row-start-3", only("outcome"))} id="ipanel-outcome">
        <DecisionPanel outcome={outcome} onAction={onAction} selected={mode === "MANUAL" ? manual.nextAction : null} />
      </div>
    </div>
  );
}
