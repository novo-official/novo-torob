"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import type { AgentControl, AgentPublicStatus, AgentState } from "@/domain/agent";
import { STAGE_FA } from "@/domain/agent";
import { PRIORITY_FA, type RankingPriority } from "@/domain/comparison";
import { Button, Card, inputStyles } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatNumberFa, parseBudget, toFaDigits } from "@/lib/format";
import { RADIUS_OPTIONS, radiusLabel } from "@/lib/geo";

const DISTRICTS = [["ferdowsi", "فردوسی"], ["sheikh-hadi", "شیخ هادی"], ["baharestan", "بهارستان"]] as const;

/** Structured preferences: every control sends a typed control turn (no prompt needed) and changes ONLY its own field. */
export function AgentPanel({ state, status, titles, busy, onControl }: { state: AgentState; status: AgentPublicStatus; titles: Record<string, string>; busy: boolean; onControl: (c: AgentControl) => void }) {
  const [budget, setBudget] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const chip = (t: string) => <li key={t} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">{t}</li>;
  const sel = state.selection ? titles[state.selection.productId] ?? "محصول انتخاب‌شده" : null;
  const o = state.origin;
  const origin = o?.kind === "preset" ? DISTRICTS.find((d) => d[0] === o.id)?.[1] ?? null : o?.kind === "map" ? "نقطه‌ی روی نقشه" : null;
  return (
    <Card className="space-y-4" aria-labelledby="panel-h" data-testid="agent-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 id="panel-h" className="font-bold">برداشت من از نیاز شما</h2>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-soft-ink" data-testid="agent-stage">مرحله‌ی {toFaDigits(state.stage)}: {STAGE_FA[state.stage]}</span>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="ترجیحات فعلی" data-testid="agent-summary">
        {state.category ? chip(`دسته: ${state.category}`) : null}
        {state.model ? chip(`مدل: ${state.model}`) : null}
        {state.budget.max || state.budget.min ? chip(`بودجه: ${state.budget.min ? `از ${formatNumberFa(state.budget.min)} ` : ""}${state.budget.max ? `تا ${formatNumberFa(state.budget.max)}` : ""} تومان`) : null}
        {sel ? chip(`انتخاب: ${sel.slice(0, 40)}`) : null}
        {chip(`شعاع: ${radiusLabel(state.radius)}`)}
        {chip(`شروع: ${origin ?? "پیش‌فرض (فردوسی)"}`)}
        {state.constraints.hard.map((c) => chip(`حتماً: ${c}`))}
        {state.constraints.soft.map((c) => chip(`ترجیحاً: ${c}`))}
        {!state.category && !state.model && !sel ? <li className="text-xs text-ink-2">هنوز چیزی ثبت نشده است.</li> : null}
      </ul>

      <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); const raw = budget.trim(); if (!raw) return onControl({ type: "set_budget", min: null, max: null }); const v = parseBudget(raw); if (v === null) return setErr("بودجه را به‌صورت عدد (تومان) بنویسید."); setErr(null); onControl({ type: "set_budget", min: null, max: v }); }} aria-label="بودجه">
        <label htmlFor="agent-budget" className="text-sm font-semibold">حداکثر بودجه (تومان)</label>
        <div className="flex gap-2"><input id="agent-budget" data-testid="agent-budget" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={state.budget.max ? formatNumberFa(state.budget.max) : "مثلاً ۳٬۰۰۰٬۰۰۰"} className={cn(inputStyles, "max-w-[11rem]")} /><Button type="submit" variant="secondary" disabled={busy}>اعمال</Button></div>
        {err ? <p role="alert" className="text-xs text-danger-ink">{err}</p> : null}
      </form>

      <fieldset className="space-y-1.5"><legend className="text-sm font-semibold">محله‌ی شروع</legend>
        <div role="radiogroup" aria-label="محله‌ی شروع" className="flex flex-wrap gap-2">
          {DISTRICTS.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={state.origin?.kind === "preset" && state.origin.id === id} data-testid={`agent-origin-${id}`} disabled={busy} onClick={() => onControl({ type: "set_origin", id })} className={cn("min-h-11 rounded-full border px-3 text-sm", state.origin?.kind === "preset" && state.origin.id === id ? "border-brand bg-brand-soft" : "border-line")}>{label}</button>)}
        </div>
      </fieldset>
      <fieldset className="space-y-1.5"><legend className="text-sm font-semibold">شعاع (خط مستقیم)</legend>
        <div role="radiogroup" aria-label="شعاع" className="flex flex-wrap gap-2">
          {RADIUS_OPTIONS.map((r) => <button key={r} type="button" role="radio" aria-checked={state.radius === r} data-testid={`agent-radius-${r}`} disabled={busy} onClick={() => onControl({ type: "set_radius", radius: r })} className={cn("min-h-11 rounded-full border px-3 text-sm", state.radius === r ? "border-brand bg-brand-soft" : "border-line")}>{radiusLabel(r)}</button>)}
        </div>
      </fieldset>
      <fieldset className="space-y-1.5"><legend className="text-sm font-semibold">اولویت در مقایسه</legend>
        <div role="radiogroup" aria-label="اولویت" className="flex flex-wrap gap-2">
          {(Object.keys(PRIORITY_FA) as RankingPriority[]).map((p) => <button key={p} type="button" role="radio" aria-checked={state.priority === p} data-testid={`agent-prio-${p}`} disabled={busy} onClick={() => onControl({ type: "set_priority", priority: p })} className={cn("min-h-11 rounded-full border px-3 text-xs", state.priority === p ? "border-brand bg-brand-soft" : "border-line")}>{PRIORITY_FA[p]}</button>)}
        </div>
      </fieldset>

      <label className={cn("flex min-h-11 items-start gap-2 text-sm", status.evidenceMode === "off" && "opacity-60")}>
        <input type="checkbox" className="mt-1 size-5" data-testid="agent-external" checked={state.externalEvidence} disabled={busy || status.evidenceMode === "off"} onChange={(e) => onControl({ type: "toggle_external", on: e.target.checked })} />
        <span>استفاده از شواهد بیرونی (مشخصات و نظر) برای محصول‌های داده‌ی رسمی{status.evidenceMode === "off" ? " — در این محیط غیرفعال است" : status.evidenceMode === "fixture" ? " — حالت آزمایشی: نمونه‌های ساختگی" : ""}</span>
      </label>
      <Button variant="ghost" onClick={() => onControl({ type: "reset" })} disabled={busy} data-testid="agent-reset"><RotateCcw aria-hidden size={16} />پاک کردن همه‌ی ترجیحات</Button>
      <p className="text-xs leading-6 text-ink-2">ترجیحات فقط در همین تب می‌ماند. موقعیت دقیق، شماره‌ی تلفن یا پاسخ شبیه‌سازی هرگز ذخیره نمی‌شود.</p>
    </Card>
  );
}
