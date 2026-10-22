/** Loading placeholder for server-rendered catalog routes (aria-busy, no fake content). */
export function ListSkeleton({ rows = 4, label = "در حال بارگذاری…" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <div className="size-20 rounded-xl bg-surface-2" />
          <div className="flex-1 space-y-2"><div className="h-4 w-3/4 rounded bg-surface-2" /><div className="h-3 w-1/2 rounded bg-surface-2" /><div className="h-4 w-1/3 rounded bg-surface-2" /></div>
        </div>
      ))}
    </div>
  );
}
