"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Cpu, FlaskConical, SendHorizontal, SlidersHorizontal, TriangleAlert, Wrench } from "lucide-react";
import { describeControl, FALLBACK_FA, TOOL_LABEL_FA, initialAgentState, type AgentAction, type AgentControl, type AgentErrorResponse, type AgentPublicStatus, type AgentState, type AgentTurnResponse } from "@/domain/agent";
import { AgentPanel } from "@/components/agent/agent-panel";
import { CardView } from "@/components/agent/agent-cards";
import { Button, Card, inputStyles } from "@/components/ui";
import { cn } from "@/lib/cn";
import { safeInternalHref } from "@/lib/safe-href";

type Msg =
  | { id: string; role: "user"; text: string; control?: boolean }
  | { id: string; role: "assistant"; text: string; turn: Omit<AgentTurnResponse, "state" | "ok"> | null; error?: string };

const KEY = "hamghadam.agent.v1";
const EXAMPLES = ["هدفون ورزشی می‌خوام تا ۳ میلیون", "دوربین مدار بسته برای مغازه", "HDW1200CLQP رو می‌خوام", "فروشنده‌های نزدیک فردوسی", "نظر و مشخصات بیرونی این محصول را بگو"];
let n = 0;
const mid = () => `m${++n}-${Date.now().toString(36)}`;

function loadSaved(): { state: AgentState; msgs: Msg[] } | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { v?: number; state?: AgentState; msgs?: Msg[] };
    // a saved state with a foreign shape (old build, edited storage) is discarded instead of crashing the panel; the server re-validates strictly anyway
    const want = Object.keys(initialAgentState()).sort().join();
    return j.v === 1 && j.state?.v === 1 && Object.keys(j.state).sort().join() === want && Array.isArray(j.msgs) ? { state: j.state, msgs: j.msgs.slice(-12) } : null;
  } catch { return null; }
}

export function AgentChat({ status }: { status: AgentPublicStatus }) {
  const [state, setState] = useState<AgentState>(initialAgentState);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const logRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // restore this tab's conversation after mount (first client render equals the server render)
    const s = loadSaved();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s) { setState(s.state); setMsgs(s.msgs); }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { window.sessionStorage.setItem(KEY, JSON.stringify({ v: 1, state, msgs: msgs.slice(-12) })); } catch { /* storage unavailable */ }
  }, [state, msgs, hydrated]);

  const send = useCallback(async (p: { message?: string; control?: AgentControl }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMsgs((m) => [...m, p.message ? { id: mid(), role: "user", text: p.message } : { id: mid(), role: "user", text: describeControl(p.control!), control: true }]);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 40_000);
    try {
      const r = await fetch("/api/agent/turn", { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: p.message ?? null, control: p.control ?? null, state }) });
      const j = (await r.json().catch(() => null)) as AgentTurnResponse | AgentErrorResponse | null;
      if (!j || !r.ok || !j.ok) {
        const e = j && !j.ok ? j : null;
        setError(e?.messageFa ?? "پاسخی دریافت نشد؛ دوباره تلاش کنید.");
        setMsgs((m) => [...m, { id: mid(), role: "assistant", text: e?.messageFa ?? "پاسخی دریافت نشد.", turn: null, error: e?.error ?? "HTTP" }]);
        return;
      }
      setState(j.state);
      const { state: _s, ok: _o, ...turn } = j;
      void _s; void _o;
      setTitles((t) => { const o = { ...t }; for (const c of turn.cards) if (c.type === "product") o[c.productId] = c.title; return o; });
      setMsgs((m) => [...m, { id: mid(), role: "assistant", text: turn.assistant.text, turn }]);
      if (p.control?.type === "select_shops" || p.control?.type === "select_offer" || p.control?.type === "reset" || p.control?.type === "select_product") setPicked([]);
      if (p.control?.type === "reset") setMsgs([]);
    } catch (e) {
      const m = e instanceof DOMException && e.name === "AbortError" ? "زمان پاسخ‌گویی تمام شد؛ دوباره تلاش کنید." : "ارتباط با دستیار برقرار نشد؛ شبکه را بررسی کنید.";
      setError(m);
      setMsgs((x) => [...x, { id: mid(), role: "assistant", text: m, turn: null, error: "NETWORK" }]);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }, [busy, state]);

  useEffect(() => { logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight }); }, [msgs.length, busy]);

  const onPick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 4 ? [...p, id] : p));
  const handlers = { onControl: (c: AgentControl) => void send({ control: c }), picked, onPick, busy };
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  const submit = (e: React.FormEvent) => { e.preventDefault(); const t = text.trim(); if (!t || busy) return; setText(""); void send({ message: t }); };
  const prov = status.provider;
  const runAction = (a: AgentAction) => (a.kind === "control" ? void send({ control: a.control }) : a.kind === "suggest" ? void send({ message: a.message }) : null);

  const banner = useMemo(() => (
    <div role="note" data-testid="agent-provider" data-provider={prov.id} className={cn("flex flex-wrap items-start gap-2 rounded-2xl border p-3 text-sm leading-7", prov.isLanguageModel ? "border-brand/40 bg-brand-soft text-brand-soft-ink" : "border-dashed border-warn-line bg-warn-bg text-warn-ink")}>
      {prov.isLanguageModel ? <Cpu aria-hidden size={18} className="mt-1 shrink-0" /> : <FlaskConical aria-hidden size={18} className="mt-1 shrink-0" />}
      <p><strong>{prov.labelFa}.</strong> {prov.isLanguageModel ? "پاسخ‌ها از ابزارهای داده‌ی رسمی می‌آیند و متن مدل پیش از نمایش از نظر ادعای بی‌پشتوانه بررسی می‌شود." : "پاسخ‌ها از روی ابزارهای داده ساخته می‌شوند و هیچ مدل زبانی‌ای در کار نیست؛ این حالت برای دمو و آزمون بدون هزینه است."}</p>
    </div>
  ), [prov]);

  if (!status.enabled) return <Card className="space-y-2" data-testid="agent-disabled"><h2 className="font-bold">{status.provider.id === "locked" ? "مدل زنده قفل است" : "دستیار در این محیط غیرفعال است"}</h2>{status.lockedReasonFa ? <p className="text-sm leading-7 text-warn-ink" data-testid="agent-locked-reason">{status.lockedReasonFa}</p> : null}<p className="text-sm leading-7 text-ink-2">از <Link className="text-brand underline" href="/discover">مشاور انتخاب</Link> و <Link className="text-brand underline" href="/search">جست‌وجوی مدل</Link> استفاده کنید؛ همه‌ی مراحل بدون دستیار هم کار می‌کنند.</p></Card>;

  return (
    <div className="space-y-4" data-testid="agent-root">
      {banner}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-5">
        <section aria-label="گفت‌وگو" className="min-w-0 space-y-3">
          <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions" aria-label="گفت‌وگوی دستیار" data-testid="agent-log" className="space-y-3">
            {msgs.length === 0 ? (
              <Card className="space-y-3" data-testid="agent-welcome">
                <h2 className="flex items-center gap-2 font-bold"><Bot aria-hidden size={18} />سلام! کجا می‌خواهید کمک کنم؟</h2>
                <p className="text-sm leading-7 text-ink-2">می‌توانم چهار کار را پشت‌سرهم انجام دهم: ۱) انتخاب محصول بر اساس نیازتان، ۲) پیدا کردن فروشگاه‌های دارای پیشنهاد ثبت‌شده در اطراف، ۳) مقایسه‌ی محتاطانه‌ی فروشنده‌ها، ۴) نوشتن پیش‌نویس پرسش. همه‌چیز از داده‌ی رسمی ترب می‌آید؛ پیشنهاد ثبت‌شده به معنی موجودی نیست و چیزی به فروشنده ارسال نمی‌شود.</p>
                <div className="flex flex-wrap gap-2" aria-label="نمونه‌ی پیام">{EXAMPLES.map((e) => <button key={e} type="button" disabled={busy} data-testid="agent-example" onClick={() => void send({ message: e })} className="min-h-11 rounded-full border border-dashed border-brand px-3 text-sm text-brand">{e}</button>)}</div>
              </Card>
            ) : null}
            {msgs.map((m) => (m.role === "user" ? (
              <div key={m.id} className={cn("max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-7", m.control ? "me-auto bg-surface-2 text-ink-2" : "me-auto bg-brand text-brand-ink")} data-testid="agent-user-msg"><bdi>{m.text}</bdi></div>
            ) : (
              <AssistantMsg key={m.id} m={m} latest={lastAssistant?.id === m.id} handlers={handlers} runAction={runAction} />
            )))}
          </div>
          {busy ? <p role="status" data-testid="agent-busy" className="flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm"><Wrench aria-hidden size={14} />در حال اجرای ابزارها…</p> : null}
          {error ? <p role="alert" data-testid="agent-error" className="flex items-start gap-2 rounded-xl bg-danger-bg p-3 text-sm text-danger-ink"><TriangleAlert aria-hidden size={16} className="mt-1 shrink-0" />{error}</p> : null}
          {picked.length > 0 ? (
            <div role="region" aria-label="فروشگاه‌های انتخاب‌شده برای مقایسه" data-testid="agent-pick-bar" className="sticky bottom-20 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-brand bg-surface p-3 shadow-lg md:bottom-4">
              <span className="text-sm font-semibold">{new Intl.NumberFormat("fa-IR").format(picked.length)} فروشگاه برای مقایسه</span>
              <Button disabled={busy || picked.length < 1} onClick={() => void send({ control: { type: "select_shops", shopIds: picked } })} data-testid="agent-compare-picked">مقایسه‌ی انتخاب‌شده‌ها</Button>
              <button type="button" className="min-h-11 text-sm underline" onClick={() => setPicked([])}>پاک کردن</button>
            </div>
          ) : null}
          <form onSubmit={submit} className="space-y-2" aria-label="ارسال پیام به دستیار">
            <label htmlFor="agent-input" className="text-sm font-semibold">پیام شما (فارسی)</label>
            <textarea id="agent-input" ref={areaRef} data-testid="agent-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={status.maxMessageChars} rows={2} placeholder="مثلاً: هدفون ورزشی تا ۳ میلیون می‌خوام" className={cn(inputStyles, "min-h-20 py-2 leading-7")}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit(e); }} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-ink-2">{new Intl.NumberFormat("fa-IR").format(text.length)} / {new Intl.NumberFormat("fa-IR").format(status.maxMessageChars)} · Ctrl+Enter برای ارسال</span>
              <div className="flex gap-2"><Button type="button" variant="secondary" className="lg:hidden" aria-expanded={panelOpen} aria-controls="agent-panel-wrap" onClick={() => setPanelOpen((v) => !v)} data-testid="agent-panel-toggle"><SlidersHorizontal aria-hidden size={16} />ترجیحات</Button><Button type="submit" disabled={busy || !text.trim()} data-testid="agent-send"><SendHorizontal aria-hidden size={16} className="rtl:-scale-x-100" />ارسال</Button></div>
            </div>
          </form>
        </section>
        <div id="agent-panel-wrap" className={cn("mt-4 lg:sticky lg:top-24 lg:mt-0", !panelOpen && "hidden lg:block")}>
          <AgentPanel state={state} status={status} titles={titles} busy={busy} onControl={(c) => void send({ control: c })} />
        </div>
      </div>
    </div>
  );
}

function AssistantMsg({ m, latest, handlers, runAction }: { m: Extract<Msg, { role: "assistant" }>; latest: boolean; handlers: Parameters<typeof CardView>[0]["h"]; runAction: (a: AgentAction) => void }) {
  const t = m.turn;
  const cards = t?.cards ?? [];
  // keep the page short on phones: the first three sellers are open, the rest are one tap away (nothing is dropped)
  const sellers = cards.filter((c) => c.type === "seller");
  const shown = sellers.length > 4 ? new Set(sellers.slice(0, 3).map((c) => c.id)) : null;
  const body = (
    <div className="space-y-3">
      {cards.filter((c) => !shown || c.type !== "seller" || shown.has(c.id)).map((c) => <CardView key={c.id} card={c} h={handlers} />)}
      {shown ? <details data-testid="agent-more-sellers"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand">{new Intl.NumberFormat("fa-IR").format(sellers.length - shown.size)} فروشگاه دیگر</summary><div className="space-y-3 pt-2">{sellers.filter((c) => !shown.has(c.id)).map((c) => <CardView key={c.id} card={c} h={handlers} />)}</div></details> : null}
    </div>
  );
  return (
    <article className="max-w-full space-y-3 rounded-2xl border border-line bg-surface p-3.5" data-testid="agent-assistant-msg" data-latest={latest ? "1" : "0"}>
      <p className="whitespace-pre-line text-sm leading-8" data-testid="agent-text">{m.text}</p>
      {t ? (
        <>
          {t.fallback.used && t.fallback.reason ? <p role="status" className="rounded-xl bg-warn-bg p-2.5 text-xs leading-6 text-warn-ink" data-testid="agent-fallback">{FALLBACK_FA[t.fallback.reason]}؛ با مسیر قطعی (بدون مدل زبانی) ادامه دادم.</p> : null}
          {t.assistant.groundingFallback ? <p role="status" className="rounded-xl bg-warn-bg p-2.5 text-xs leading-6 text-warn-ink" data-testid="agent-grounding">متن مدل رد شد (ادعای بی‌پشتوانه)؛ پاسخ از روی نتایج ابزارها بازسازی شد.</p> : null}
          {t.notices.map((x) => <p key={x} className="text-xs leading-6 text-ink-2">{x}</p>)}
          {t.trace.length ? <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2" aria-label="ابزارهای اجراشده" data-testid="agent-trace"><Wrench aria-hidden size={12} />{t.trace.map((x, i) => <span key={i} className={cn("rounded-full px-2 py-0.5", x.status === "ok" ? "bg-surface-2" : "bg-warn-bg text-warn-ink")}>{x.tool === "unknown_tool" ? "ابزار نامعتبر" : TOOL_LABEL_FA[x.tool]}{x.status === "ok" ? " ✓" : ` (${x.status === "not_found" ? "یافت نشد" : x.status === "ambiguous" ? "نیازمند توضیح" : x.status === "disabled" ? "غیرفعال" : x.status === "unknown" ? "نامعلوم" : x.status === "no_comparable_offer" ? "بدون پیشنهاد قابل‌مقایسه" : "خطا"})`}</span>)}</p> : null}
          {latest ? body : cards.length ? <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand">کارت‌های این مرحله ({new Intl.NumberFormat("fa-IR").format(cards.length)})</summary>{body}</details> : null}
          {latest && t.clarify ? (
            <div role="group" aria-label="سؤال دستیار" className="space-y-2 rounded-2xl border border-brand bg-brand-soft/40 p-3" data-testid="agent-clarify">
              <p className="font-semibold">{t.clarify.text}</p>
              {t.clarify.help ? <p className="text-xs text-ink-2">{t.clarify.help}</p> : null}
              <div className="flex flex-wrap gap-2">{t.clarify.options.map((o) => <button key={o.id} type="button" disabled={handlers.busy} data-testid="agent-clarify-option" onClick={() => handlers.onControl(o.control)} className="min-h-11 rounded-xl border border-brand bg-surface px-3 text-start text-sm">{o.label}{o.hint ? <span className="block text-xs text-ink-2">{o.hint}</span> : null}</button>)}
                {t.clarify.skip ? <button type="button" disabled={handlers.busy} onClick={() => handlers.onControl(t.clarify!.skip!)} className="min-h-11 rounded-xl border border-line px-3 text-sm text-ink-2">مطمئن نیستم</button> : null}</div>
            </div>
          ) : null}
          {latest && t.actions.length ? (
            <div className="flex flex-wrap gap-2" aria-label="گام‌های پیشنهادی" data-testid="agent-actions">
              {t.actions.map((a) => a.kind === "navigate" ? (safeInternalHref(a.href) ? <Link key={a.label} href={a.href} className="inline-flex min-h-11 items-center rounded-full border border-brand px-4 text-sm text-brand hover:bg-brand-soft">{a.label}</Link> : null) : <button key={a.label} type="button" disabled={handlers.busy} onClick={() => runAction(a)} className="min-h-11 rounded-full border border-dashed border-brand px-4 text-sm text-brand hover:bg-brand-soft">{a.label}</button>)}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
