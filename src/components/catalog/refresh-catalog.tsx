"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";

export function RefreshCatalog() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Button disabled={pending} onClick={() => startTransition(() => router.refresh())} variant="secondary"><RefreshCw aria-hidden size={16} className={pending ? "animate-spin" : undefined} />{pending ? "در حال بررسی…" : "بررسی دوباره"}</Button>;
}
