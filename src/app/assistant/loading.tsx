import { ListSkeleton } from "@/components/catalog/skeleton";

export default function Loading() {
  // The streamed assistant page is taller than the viewport: reserve that height so the footer does not jump out of view when it arrives (CLS).
  return (
    <div className="min-h-[100svh]">
      <ListSkeleton rows={2} label="در حال آماده‌سازی دستیار…" />
    </div>
  );
}
