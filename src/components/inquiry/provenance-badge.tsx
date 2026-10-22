import { Bot, Database, HelpCircle, UserRound } from "lucide-react";
import { PROVENANCE_FA, type FactProvenance } from "@/domain/inquiry";
import { cn } from "@/lib/cn";

const TONE: Record<FactProvenance, string> = {
  DATASET_RECORDED: "bg-surface-2 text-ink-2 border-line",
  USER_REPORTED: "bg-brand-soft text-brand-soft-ink border-brand/40",
  DEMO_SIMULATED: "bg-warn-bg text-warn-ink border-warn-line border-dashed",
  UNKNOWN: "bg-surface text-ink-2 border-line border-dashed",
};
const ICON = { DATASET_RECORDED: Database, USER_REPORTED: UserRound, DEMO_SIMULATED: Bot, UNKNOWN: HelpCircle } as const;

/** Never colour-only: icon + explicit Persian label + `title` help + data attribute for tests. */
export function ProvenanceBadge({ kind, short = false, className }: { kind: FactProvenance; short?: boolean; className?: string }) {
  const Icon = ICON[kind];
  const m = PROVENANCE_FA[kind];
  const label = short ? ({ DATASET_RECORDED: "داده", USER_REPORTED: "گزارش شما", DEMO_SIMULATED: "شبیه‌سازی", UNKNOWN: "نامعلوم" } as const)[kind] : m.label;
  return (
    <span data-provenance={kind} title={m.help} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", TONE[kind], className)}>
      <Icon aria-hidden size={12} />{label}
    </span>
  );
}
