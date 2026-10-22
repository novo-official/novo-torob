"use client";

import { TriangleAlert } from "lucide-react";
import { Button, ButtonLink, EmptyState } from "@/components/ui";

export function RouteError({ reset }: { reset: () => void }) {
  return (
    <EmptyState icon={<TriangleAlert size={22} />} title="مشکلی پیش آمد" action={<><Button onClick={reset}>تلاش دوباره</Button><ButtonLink href="/" variant="secondary">بازگشت به خانه</ButtonLink></>}>
      <p>اطلاعات این صفحه بارگذاری نشد. دوباره تلاش کنید یا از صفحهٔ اصلی ادامه دهید.</p>
    </EmptyState>
  );
}
