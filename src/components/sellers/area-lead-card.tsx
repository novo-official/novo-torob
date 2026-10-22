import { ExternalLink, Landmark, MapPinned } from "lucide-react";
import type { AreaRecommendation } from "@/domain/shopping-area";
import { Badge } from "@/components/ui";
import { toFaDigits } from "@/lib/format";
import { externalMapLink, formatDistance } from "@/lib/geo";
import { cn } from "@/lib/cn";

const CONF = { high: ["اطمینان بالا", "ok"], medium: ["اطمینان متوسط", "warn"], low: ["برآورد از داده (اطمینان کم)", "neutral"] } as const;
const KIND = { street: "خیابان", mall: "پاساژ", district: "محدوده" } as const;
const faDate = (iso: string) => new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", dateStyle: "long" }).format(new Date(`${iso}T12:00:00Z`));

/**
 * SHOPPING_DISTRICT_SUGGESTION — a place to LOOK, not a seller. Evidence (traceable facts) and inference (system
 * judgement) are rendered separately; curated areas show every source with its date, dataset areas show the data basis.
 */
export function AreaLeadCard({ rec, selected = false, onShowOnMap }: { rec: AreaRecommendation; selected?: boolean; onShowOnMap?: (id: string) => void }) {
  const a = rec.area;
  const [confText, confTone] = CONF[a.confidence];
  const link = externalMapLink(a.center.lat, a.center.lon);
  return (
    <li
      data-testid="area-lead"
      data-area-id={a.id}
      data-source-type={a.sourceType}
      aria-current={selected ? "true" : undefined}
      className={cn("space-y-3 rounded-[var(--radius-card)] border border-warn-line bg-surface p-4", selected && "ring-2 ring-brand")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold"><Landmark aria-hidden size={18} className="shrink-0 text-warn-ink" /><bdi>{a.nameFa}</bdi></h3>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="warn">پیشنهاد منطقه — فروشنده نیست</Badge>
          <Badge tone={confTone}>{confText}</Badge>
        </div>
      </div>
      <p className="text-sm text-ink-2">{KIND[a.kind]} · {a.areaLabelFa}{rec.distanceMeters !== null ? <> · حدود {formatDistance(rec.distanceMeters)} (خط مستقیم تا مرکز)</> : null}</p>
      <p className="text-sm leading-7">{a.recommendationReasonFa}</p>

      {rec.evidence.length ? (
        <div className="text-sm">
          <p className="font-semibold">شواهد (قابل‌ردیابی)</p>
          <ul className="list-disc space-y-1 ps-5 leading-7 text-ink-2">{rec.evidence.map((e, i) => <li key={i}>{e.textFa}</li>)}</ul>
        </div>
      ) : null}
      {rec.inference.length ? (
        <div className="text-sm">
          <p className="font-semibold">برداشت سیستم (استنباط)</p>
          <ul className="list-disc space-y-1 ps-5 leading-7 text-ink-2">{rec.inference.map((e, i) => <li key={i}>{e.textFa}</li>)}</ul>
        </div>
      ) : null}
      {rec.density ? <p className="text-xs text-ink-2">در داده‌ی هکاتون: {toFaDigits(rec.density.shopsListing)} فروشگاه این دسته را اعلام کرده‌اند و {toFaDigits(rec.density.shopsWithOffers)} فروشگاه در همین دسته پیشنهاد ثبت‌شده دارند.</p> : null}

      <details className="text-sm" data-testid="area-sources">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand">منابع و تاریخ بررسی ({toFaDigits(a.sources.length)})</summary>
        <ul className="space-y-2 pb-1">
          {a.sources.map((s, i) => (
            <li key={i} className="rounded-xl bg-surface-2 p-2.5 text-xs leading-6">
              <p className="font-semibold">{s.title}</p>
              <p className="text-ink-2">{s.publisher}{s.publishedAt ? ` · ${faDate(s.publishedAt)}` : ""} · {s.supports === "claim" ? "پشتیبان ادعای تخصص بازار" : s.supports === "coordinates" ? "پشتیبان مختصات" : "داده‌ی هکاتون"}</p>
              {s.quote ? <p className="mt-1">«{s.quote}»</p> : null}
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-brand hover:underline" dir="ltr">{new URL(s.url).hostname}<ExternalLink aria-hidden size={12} /></a> : null}
              {s.dataset ? <p className="text-ink-2" dir="ltr">{s.dataset.files.join(", ")}: {s.dataset.fields.join(", ")}</p> : null}
            </li>
          ))}
        </ul>
        <p className="text-xs leading-6 text-ink-2">بررسی منابع: {faDate(a.verifiedAt)}. مرکز: {a.coordinateBasisFa}</p>
      </details>

      <p className="text-xs leading-6 text-warn-ink">{a.disclaimerFa}</p>
      <div className="flex flex-wrap gap-2">
        {onShowOnMap ? <button type="button" onClick={() => onShowOnMap(a.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-4 text-sm font-semibold text-brand hover:bg-brand-soft"><MapPinned aria-hidden size={16} />نمایش روی نقشه</button> : null}
        {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-brand hover:underline"><ExternalLink aria-hidden size={14} />باز کردن در OpenStreetMap<span className="sr-only"> (پنجره‌ی جدید؛ فقط مقصد فرستاده می‌شود)</span></a> : null}
      </div>
    </li>
  );
}
