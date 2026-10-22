"use client";

import { RouteError } from "@/components/catalog/route-error";
import { PageHeader } from "@/components/ui";

export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <><PageHeader title="جست‌وجوی مدل یا نام کالا" /><RouteError reset={retry} /></>;
}
