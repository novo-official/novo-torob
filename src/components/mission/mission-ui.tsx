"use client";

import { CircleCheck, HardDrive, MemoryStick, Clock } from "lucide-react";
import { PHASE_FA, PHASE_ORDER, type MissionPhase } from "@/domain/mission";
import { Badge } from "@/components/ui";
import type { Where } from "@/lib/mission-store";
import { cn } from "@/lib/cn";

export const WHERE_FA: Record<Where, { label: string; help: string }> = {
  TAB: { label: "موقت — فقط همین تب", help: "با بستن تب یا مرورگر پاک می‌شود. برای نگه‌داشتن، «ذخیره روی این دستگاه» را بزنید." },
  DEVICE: { label: "ذخیره‌شده روی این دستگاه", help: "فقط در همین مرورگر و همین پروفایل می‌ماند؛ روی دستگاه دیگر دیده نمی‌شود و هر وقت بخواهید پاک می‌شود." },
  MEMORY: { label: "فقط تا بستن صفحه", help: "ذخیره‌سازی مرورگر در دسترس نیست؛ ماموریت فقط تا بستن یا تازه‌سازی این صفحه می‌ماند." },
};

export function StorageBadge({ where }: { where: Where | null }) {
  if (!where) return null;
  const Icon = where === "DEVICE" ? HardDrive : where === "MEMORY" ? MemoryStick : Clock;
  return <Badge tone={where === "DEVICE" ? "ok" : where === "MEMORY" ? "warn" : "neutral"} title={WHERE_FA[where].help} data-testid="storage-badge" data-where={where}><Icon aria-hidden size={12} />{WHERE_FA[where].label}</Badge>;
}

/** compact progress: not decorative — each step is the derived phase of the mission (never a stored flag). On phones only the current step shows its label. */
export function Stepper({ phase }: { phase: MissionPhase }) {
  const idx = phase === "ABANDONED" ? -1 : PHASE_ORDER.indexOf(phase === "AWAIT_REPLY" ? "INQUIRY" : phase);
  const steps = PHASE_ORDER.filter((p) => p !== "NEED");
  return (
    <ol aria-label="پیشرفت ماموریت" className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="mission-stepper" data-phase={phase}>
      {steps.map((p, i) => {
        const at = PHASE_ORDER.indexOf(p);
        const done = idx > at;
        const current = idx === at || (p === "INQUIRY" && phase === "AWAIT_REPLY");
        return (
          <li key={p} aria-current={current ? "step" : undefined} className={cn("flex items-center gap-1 rounded-full border px-2 py-1", current ? "border-brand bg-brand-soft font-bold text-brand-soft-ink" : done ? "border-line bg-surface-2 text-ink-2" : "border-dashed border-line text-ink-2")}>
            {done ? <CircleCheck aria-hidden size={14} /> : <span aria-hidden className="grid size-4 place-items-center rounded-full bg-surface-2 text-[10px]">{i + 1}</span>}
            <span className={current ? undefined : "max-sm:sr-only"}>{PHASE_FA[p]}</span>
          </li>
        );
      })}
    </ol>
  );
}
