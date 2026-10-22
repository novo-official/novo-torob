"use client";

import { useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import type { EvidenceCardView } from "@/domain/agent";
import { CardView } from "@/components/agent/agent-cards";
import { Button, Card } from "@/components/ui";

const NOOP = { onControl: () => undefined, picked: [] as string[], onPick: () => undefined, busy: false };

/** Opt-in panel on the product page: nothing external is read until the user presses the button. The dataset section above stays the primary source. */
export function ExternalEvidencePanel({ productId }: { productId: string }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; card: EvidenceCardView | null; cached: boolean }>({ status: "idle", card: null, cached: false });
  const load = async () => {
    setState({ status: "loading", card: null, cached: false });
    try {
      const r = await fetch(`/api/evidence/${productId}?optin=1`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { card: EvidenceCardView; cached: boolean };
      setState({ status: "done", card: j.card, cached: j.cached });
    } catch { setState({ status: "error", card: null, cached: false }); }
  };
  return (
    <Card className="space-y-3" data-testid="external-evidence-panel">
      <h2 className="flex items-center gap-2 font-bold"><Globe aria-hidden size={18} />مشخصات و نظر بیرونی (اختیاری)</h2>
      <p className="text-sm leading-7 text-ink-2">با زدن دکمه، فقط برای همین مدل و فقط از چند صفحه‌ی عمومیِ بازبینی‌شده می‌خوانیم؛ گزیده‌ها کوتاه، عیناً نقل‌شده و دارای نشانی منبع‌اند. این بخش جایگزین داده‌ی رسمی ترب نیست، موجودی و قیمت نمی‌دهد و امتیاز یا شمار نظر نمایش نمی‌دهد.</p>
      {state.status === "idle" ? <Button variant="secondary" onClick={load} data-testid="evidence-load">نمایش شواهد بیرونی این مدل</Button> : null}
      {state.status === "loading" ? <p role="status" className="flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm" data-testid="evidence-loading"><Loader2 aria-hidden size={16} className="animate-spin motion-reduce:animate-none" />در حال خواندن صفحه‌های بازبینی‌شده…</p> : null}
      {state.status === "error" ? <p role="alert" className="rounded-xl bg-danger-bg p-3 text-sm text-danger-ink" data-testid="evidence-error">خواندن شواهد بیرونی ممکن نشد؛ داده‌ی رسمی ترب بالا همچنان معتبر است. <button type="button" className="min-h-11 underline" onClick={load}>دوباره</button></p> : null}
      {state.card ? <div data-testid="evidence-result" data-status={state.card.status} data-mode={state.card.mode}><CardView card={state.card} h={NOOP} />{state.cached ? <p className="mt-1 text-xs text-ink-2">نتیجه‌ی ذخیره‌شده (حداکثر یک روز قدمت).</p> : null}</div> : null}
    </Card>
  );
}
