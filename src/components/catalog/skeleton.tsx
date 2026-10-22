/** Loading placeholder for server-rendered catalog routes (aria-busy, no fake content). */
export function ListSkeleton({ rows = 4, label = "در حال بارگذاری…" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="animate-pulse rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
          <div className="flex gap-3"><div className="size-20 shrink-0 rounded-xl bg-surface-2" /><div className="min-w-0 flex-1 space-y-3"><div className="h-3 w-1/3 rounded bg-surface-2" /><div className="h-5 w-3/4 rounded bg-surface-2" /><div className="h-3 w-1/2 rounded bg-surface-2" /></div></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4"><div className="h-5 w-36 rounded bg-surface-2" /><div className="h-11 w-44 rounded-xl bg-surface-2" /></div>
        </div>
      ))}
    </div>
  );
}
