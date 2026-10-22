"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { VariantGroup } from "@/domain/advisor";
import { Badge } from "@/components/ui";
import { FLAG_SHORT } from "@/lib/flag-labels";
import { toFaDigits } from "@/lib/format";

/** The exact sellable variant is a user decision, kept in the URL (?variant=) and handed to Phase 4. */
export function VariantPicker({ groups, selected }: { groups: VariantGroup[]; selected: string | null }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const pick = (id: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (id) next.set("variant", id); else next.delete("variant");
    start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
  };
  return (
    <div role="radiogroup" aria-label="نسخه‌ی دقیق محصول" aria-busy={pending} className="grid gap-2">
      {groups.map((g) => (
        <button key={g.id} type="button" role="radio" aria-checked={selected === g.id} onClick={() => pick(g.id)} className={`rounded-2xl border p-3 text-start ${selected === g.id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand"}`}>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{g.label}</span>
            <span className="text-xs text-ink-2">{toFaDigits(g.offerCount)} پیشنهاد</span>
          </span>
          <span className="mt-1 block text-xs text-ink-2">نمونه عنوان فروشنده: <bdi>{g.sampleTitle.slice(0, 90)}</bdi></span>
          <span className="mt-1 flex flex-wrap gap-1">
            {g.flags.filter((f) => FLAG_SHORT[f]).map((f) => <Badge key={f} tone={FLAG_SHORT[f]!.tone}>{FLAG_SHORT[f]!.text}</Badge>)}
          </span>
        </button>
      ))}
      <button type="button" role="radio" aria-checked={selected === null} onClick={() => pick(null)} className={`rounded-2xl border p-3 text-start ${selected === null ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand"}`}>
        <span className="font-semibold">هنوز مطمئن نیستم</span>
        <span className="block text-xs text-ink-2">در گام فروشنده‌ها دوباره از شما پرسیده می‌شود.</span>
      </button>
    </div>
  );
}
