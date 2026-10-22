import { ListSkeleton } from "@/components/catalog/skeleton";

export default function Loading() {
  return <ListSkeleton rows={2} label="در حال آماده‌سازی دستیار…" />;
}
