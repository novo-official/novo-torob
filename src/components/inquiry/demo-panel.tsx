import { Bot, FlaskConical, Trash2 } from "lucide-react";
import { DEMO_BANNER, DEMO_SCENARIOS, DEMO_TAG, type DemoRun } from "@/domain/inquiry-demo";
import type { DemoScenarioId } from "@/domain/inquiry";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Persistent, unmistakable demo indicator (header of the workspace while demo is active). */
export function DemoBanner({ onExit }: { onExit: () => void }) {
  return (
    <div role="status" aria-live="polite" data-testid="demo-banner" className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-dashed border-warn-ink bg-warn-bg p-3 text-warn-ink">
      <p className="flex items-center gap-2 text-sm font-bold"><FlaskConical aria-hidden size={18} />{DEMO_BANNER}<span className="font-normal"> — هیچ پیامی ارسال نمی‌شود؛ پاسخ‌ها نمونه‌ی ساختگی‌اند و ذخیره نمی‌شوند.</span></p>
      <Button variant="secondary" onClick={onExit} data-testid="demo-exit">خروج از شبیه‌سازی و پاک کردن آن</Button>
    </div>
  );
}

export function DemoPanel({ scenario, onScenario, onRun, runs, onClear, draft }: { scenario: DemoScenarioId; onScenario: (s: DemoScenarioId) => void; onRun: () => void; runs: DemoRun[]; onClear: () => void; draft: string }) {
  return (
    <Card className="space-y-4 border-dashed border-warn-line" aria-labelledby="demo-h" data-testid="demo-panel">
      <h2 id="demo-h" className="flex items-center gap-2 font-bold"><Bot aria-hidden size={18} />شبیه‌سازی پاسخ فروشنده — فقط برای دمو</h2>
      <p className="text-sm leading-7 text-ink-2">سناریو را انتخاب کنید؛ پاسخ‌ها از روی یک اسکریپت ثابت ساخته می‌شوند و <strong>هیچ فروشنده‌ی واقعی چیزی نگفته است</strong>. قیمت، موجودی و گارانتی نمونه به داده یا رتبه‌بندی راه پیدا نمی‌کند.</p>
      <div role="radiogroup" aria-label="سناریوی شبیه‌سازی" className="grid gap-2 sm:grid-cols-2">
        {DEMO_SCENARIOS.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={scenario === s.id} data-testid={`scenario-${s.id}`} onClick={() => onScenario(s.id)}
            className={cn("min-h-11 rounded-2xl border p-3 text-start text-sm", scenario === s.id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2")}>
            <span className="block font-semibold">{s.labelFa}</span><span className="block text-xs text-ink-2">{s.descriptionFa}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onRun} data-testid="demo-run" disabled={!draft.trim()}><Bot aria-hidden size={16} />اجرای سناریو</Button>
        <Button variant="ghost" onClick={onClear} disabled={!runs.length} data-testid="demo-clear"><Trash2 aria-hidden size={16} />پاک کردن گفت‌وگوی نمونه</Button>
      </div>
      {runs.length ? (
        <ol className="space-y-3" aria-label="گفت‌وگوی نمونه (شبیه‌سازی‌شده)" data-testid="demo-transcript">
          {runs.flatMap((r) => r.messages).map((m) => (
            <li key={m.id} data-testid="demo-message" data-sender={m.sender} data-provenance={m.provenance}
              className={cn("max-w-[92%] space-y-1 rounded-2xl border border-dashed p-3 text-sm leading-7", m.sender === "user_sim" ? "me-auto border-line bg-surface-2" : m.sender === "system_sim" ? "mx-auto border-line bg-surface text-ink-2" : "ms-auto border-warn-line bg-warn-bg text-warn-ink")}>
              <p className="whitespace-pre-line"><bdi>{m.textFa}</bdi></p>
              <p className="text-xs font-semibold" data-testid="demo-tag">{m.sender === "user_sim" ? "پیام شما (نمونه) — " : ""}{m.tagFa}</p>
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-ink-2">هنوز سناریویی اجرا نشده. بدون هیچ ارتباط واقعی، می‌توانید ببینید جمع‌بندی و گام بعد چطور تغییر می‌کند.</p>}
      <p className="text-xs leading-6 text-ink-2">برچسب‌ها: {DEMO_TAG}. رسید تحویل، ساعت واقعی یا کانال پیام وجود ندارد.</p>
    </Card>
  );
}
