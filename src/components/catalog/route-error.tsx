"use client";

import { TriangleAlert } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

export function RouteError({ reset }: { reset: () => void }) {
  return (
    <EmptyState icon={<TriangleAlert size={22} />} title="مشکلی پیش آمد" action={<Button onClick={reset}>تلاش دوباره</Button>}>
      <p>داده‌ها بارگذاری نشد. دوباره تلاش کنید؛ اگر ادامه داشت، پیکربندی پایگاه داده را بررسی کنید.</p>
    </EmptyState>
  );
}
