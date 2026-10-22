"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, CircleAlert, LocateFixed, Plus, Scale, TriangleAlert } from "lucide-react";
import { COMPARE_LIMITS, PRIORITY_FA, type PriceVerdictKind, type RankingPriority, type SellerComparisonResponse, type SellerComparisonResult } from "@/domain/comparison";
import { CompareTable } from "@/components/compare/compare-table";
import { Badge, Button, Card, EmptyState, inputStyles } from "@/components/ui";
import { buildCompareHref, type CompareParams } from "@/lib/compare-url";
import { formatNumberFa, formatToman, parseBudget, toFaDigits } from "@/lib/format";
import { formatDistance, RADIUS_OPTIONS, radiusLabel, snapOrigin } from "@/lib/geo";
import { GPS_MESSAGE, requestPosition, type GpsStatus } from "@/lib/gps";
import { buildMissionHref } from "@/lib/mission-url";
import { buildShopHref, type OriginKey } from "@/lib/sellers-url";
import { cn } from "@/lib/cn";

const fa = toFaDigits;
const VERDICT_TONE: Record<PriceVerdictKind, string> = {
  CHEAPEST_CONFIRMED: "border-ok-ink/40 bg-ok-bg text-ok-ink",
  CHEAPEST_QUALIFIED: "border-brand/40 bg-brand-soft text-brand-soft-ink",
  NO_WINNER_TIE: "border-warn-line bg-warn-bg text-warn-ink",
  NO_WINNER_INSUFFICIENT: "border-warn-line bg-warn-bg text-warn-ink",
  NO_WINNER_MISMATCH: "border-warn-line bg-warn-bg text-warn-ink",
  NO_WINNER_WIDE_SPREAD: "border-warn-line bg-warn-bg text-warn-ink",
  NO_WINNER_UNKNOWN_IDENTITY: "border-warn-line bg-warn-bg text-warn-ink",
};
const PRIO_HELP: Record<RankingPriority, string> = {
  price: "فقط قیمت‌های قابل‌اتکا (تازه، معتبر، هم‌نسخه) عدد رتبه می‌گیرند.",
  distance: "نزدیک‌ترین در خط مستقیم از نقطه‌ی شروع.",
  hours: "داخل ساعت اعلام‌شده در زمان بازدیدی که می‌دهید.",
  payment: "پرداخت حضوری اعلام‌شده بالاتر از «کانال نامعلوم» و «اعلام نشده».",
  warranty: "گارانتی اعلام‌شده (ماه) بالاتر از نامعلوم.",
};

export interface PresetView { id: string; label: string }

export function CompareView({ initial, params, presets, visitDefault }: { initial: SellerComparisonResponse; params: CompareParams; presets: PresetView[]; visitDefault: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [gpsPoint, setGpsPoint] = useState<{ lat: number; lon: number } | null>(null); // memory only
  const [gpsData, setGpsData] = useState<{ key: string; data: SellerComparisonResponse } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const gpsMode = params.origin === "gps";
  const key = `${params.product}|${params.variant}|${params.shops.join(",")}|${params.radius}|${params.visit}|${params.bmin}|${params.bmax}|${params.strict}|${params.prio}|${gpsPoint?.lat},${gpsPoint?.lon}`;
  const data = gpsMode && gpsData ? gpsData.data : initial;
  const busy = pending || (gpsMode && !!gpsPoint && gpsData?.key !== key);

  const go = (patch: Partial<CompareParams>) => startTransition(() => router.push(buildCompareHref({ ...params, ...patch }), { scroll: false }));

  useEffect(() => {
    if (!gpsMode || !gpsPoint) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    fetch("/api/compare/sellers", {
      method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gps: gpsPoint, product: params.product, variant: params.variant ?? undefined, shops: params.shops.join(","), r: params.radius, visit: params.visit ?? undefined, bmin: params.bmin ?? undefined, bmax: params.bmax ?? undefined, strict: params.strict, prio: params.prio }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<SellerComparisonResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => setGpsData({ key, data: d }))
      .catch((e: unknown) => { if ((e as Error).name !== "AbortError") setGpsStatus("unavailable"); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsMode, gpsPoint, key]);

  const useGps = async () => {
    setGpsStatus("requesting");
    const r = await requestPosition(typeof navigator !== "undefined" ? navigator.geolocation : undefined);
    if (r.status !== "granted") { setGpsStatus(r.status); return; }
    setGpsStatus("granted");
    setGpsPoint(snapOrigin(r.point));
    go({ origin: "gps", ll: null });
  };
  const chooseOrigin = (o: OriginKey | null) => { setGpsData(null); go({ origin: o, ll: null }); };

  const applyBudget = (form: HTMLFormElement) => {
    const f = new FormData(form);
    const raw = (n: string) => String(f.get(n) ?? "").trim();
    const min = raw("bmin") ? parseBudget(raw("bmin")) : null;
    const max = raw("bmax") ? parseBudget(raw("bmax")) : null;
    if ((raw("bmin") && min === null) || (raw("bmax") && max === null)) { setBudgetError("بودجه را به‌صورت عدد (تومان) بنویسید."); return; }
    if (min !== null && max !== null && min > max) { setBudgetError("حداقل بودجه نباید از حداکثر بیشتر باشد."); return; }
    setBudgetError(null);
    go({ bmin: min, bmax: max, strict: min || max ? params.strict : false });
  };

  const sellerHrefs = {
    shop: (s: SellerComparisonResult) => buildShopHref(s.shopId, { product: params.product, variant: data.variant.selectedGroupId, back: buildCompareHref({ ...params }) }),
    mission: (s: SellerComparisonResult) => buildMissionHref({ product: params.product, variant: data.variant.selectedGroupId, shop: s.shopId, offer: s.representative?.offerId ?? null, visit: params.visit, back: buildCompareHref({ ...params }) }),
    remove: (s: SellerComparisonResult) => buildCompareHref({ ...params, shops: params.shops.filter((x) => x !== s.shopId) }),
  };
  const canAdd = params.shops.length < COMPARE_LIMITS.maxSellers;
  const sit = data.situation;
  const sellersHref = params.product ? `/sellers?product=${params.product}${data.variant.selectedGroupId ? `&variant=${encodeURIComponent(data.variant.selectedGroupId)}` : ""}` : "/sellers";
  const win = data.verdict.winnerShopId ? data.sellers.find((s) => s.shopId === data.verdict.winnerShopId) : null;

  return (
    <div className="w-full min-w-0 max-w-full space-y-5" aria-busy={busy}>
      {/* ---------- criteria ---------- */}
      <Card className="space-y-4" aria-labelledby="criteria-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="criteria-h" className="font-bold">معیارهای شما</h2>
          <p className="text-xs text-ink-2">محصول: <Link className="font-semibold text-brand hover:underline" href={`/products/${data.product?.id ?? ""}`}><bdi>{data.product?.title}</bdi></Link>{data.variant.selected ? <> · نسخه: <bdi>{data.variant.selected.label}</bdi></> : null}</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">اولویت رتبه‌بندی</legend>
          <div role="radiogroup" aria-label="اولویت رتبه‌بندی" className="flex flex-wrap gap-2">
            {(Object.keys(PRIORITY_FA) as RankingPriority[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={params.prio === p} onClick={() => go({ prio: p })} data-testid={`prio-${p}`}
                className={cn("min-h-11 rounded-full border px-4 text-sm font-medium", params.prio === p ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2")}>{PRIORITY_FA[p]}</button>
            ))}
          </div>
          <p className="text-xs leading-6 text-ink-2">{PRIO_HELP[params.prio]} بقیه‌ی معیارها به‌ترتیب ثابت (قیمت، فاصله، ساعت، پرداخت، گارانتی) تعیین‌کننده‌ی تساوی‌اند؛ هیچ امتیاز پنهانی وجود ندارد.</p>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="visit" className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock aria-hidden size={16} />زمان بازدید (به وقت تهران)</label>
            <div className="flex flex-wrap items-center gap-2">
              <input id="visit" type="datetime-local" step={60} className={cn(inputStyles, "max-w-[15rem]")} value={params.visit ?? visitDefault}
                onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) go({ visit: v }); }} data-testid="visit-input" />
              {params.visit ? <Button variant="ghost" onClick={() => go({ visit: null })}>همین حالا</Button> : null}
            </div>
            <p className="text-xs leading-6 text-ink-2">{params.visit ? "ساعت‌ها برای این زمان سنجیده شده‌اند." : "زمان بازدید انتخاب نشده؛ زمان فعلی تهران استفاده شد."} فقط ساعت <em>اعلام‌شده</em> بررسی می‌شود، نه باز بودن واقعی.</p>
          </div>

          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); applyBudget(e.currentTarget); }} aria-label="بودجه">
            <p className="text-sm font-semibold">بودجه (تومان)</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="bmin">حداقل بودجه</label>
              <input id="bmin" name="bmin" inputMode="numeric" placeholder="از" defaultValue={params.bmin ? formatNumberFa(params.bmin) : ""} className={cn(inputStyles, "max-w-[9rem]")} />
              <label className="sr-only" htmlFor="bmax">حداکثر بودجه</label>
              <input id="bmax" name="bmax" inputMode="numeric" placeholder="تا" defaultValue={params.bmax ? formatNumberFa(params.bmax) : ""} className={cn(inputStyles, "max-w-[9rem]")} data-testid="bmax-input" />
              <Button type="submit" variant="secondary">اعمال بودجه</Button>
            </div>
            {budgetError ? <p role="alert" className="text-sm text-danger-ink">{budgetError}</p> : null}
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={params.strict} disabled={!params.bmin && !params.bmax} onChange={(e) => go({ strict: e.target.checked })} />بودجه‌ی سخت‌گیرانه: «نامعلوم» جدا از «داخل/بیش از بودجه» نشان داده شود</label>
          </form>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">نقطه‌ی شروع (برای فاصله‌ی خط مستقیم)</p>
          <div role="radiogroup" aria-label="نقطه‌ی شروع" className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={params.origin === p.id} onClick={() => chooseOrigin(p.id as OriginKey)}
                className={cn("min-h-11 rounded-full border px-4 text-sm font-medium", params.origin === p.id ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2")}>{p.label}</button>
            ))}
            {params.origin === "map" ? <Badge tone="brand" className="min-h-11 px-4">نقطه‌ی انتخابی روی نقشه</Badge> : null}
            <Button variant="secondary" onClick={useGps} disabled={gpsStatus === "requesting"} data-testid="gps-button"><LocateFixed aria-hidden size={16} />استفاده از موقعیت من</Button>
          </div>
          {GPS_MESSAGE[gpsStatus] ? <p role="status" data-testid="gps-message" className="rounded-xl bg-surface-2 p-3 text-sm leading-7">{GPS_MESSAGE[gpsStatus]}</p> : null}
          {gpsMode && !gpsPoint && gpsStatus === "idle" ? <p role="status" className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">موقعیت شما در نشانی صفحه ذخیره نمی‌شود؛ برای محاسبه‌ی فاصله دوباره «استفاده از موقعیت من» را بزنید.</p> : null}
          {!params.origin ? <p className="text-xs text-ink-2">نقطه‌ی شروع انتخاب نشده؛ فاصله‌ها نامعلوم‌اند و رتبه‌بندی بر پایه‌ی فاصله‌ی آن‌ها را مقایسه نمی‌کند.</p> : null}
          <div role="radiogroup" aria-label="شعاع" className="flex flex-wrap gap-2 pt-1">
            {RADIUS_OPTIONS.map((r) => <button key={r} type="button" role="radio" aria-checked={params.radius === r} onClick={() => go({ radius: r })} className={cn("min-h-11 rounded-full border px-3 text-xs font-medium", params.radius === r ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-2")}>شعاع {radiusLabel(r)}</button>)}
          </div>
          <p className="text-xs text-ink-2">شعاع فقط برای پیشنهاد فروشگاه‌های قابل‌افزودن و برچسب «خارج از شعاع» است؛ فروشگاهی که خودتان انتخاب کرده‌اید حذف نمی‌شود.</p>
        </div>
      </Card>

      {data.notices.map((n) => <p key={n} role="status" className="flex gap-2 rounded-xl bg-warn-bg p-3 text-sm leading-7 text-warn-ink"><TriangleAlert aria-hidden size={16} className="mt-1 shrink-0" />{n}</p>)}

      {/* ---------- verdict ---------- */}
      {sit === "OK" || sit === "NO_COMPARABLE_SELLERS" ? (
        <section role="status" aria-live="polite" data-testid="verdict" data-kind={data.verdict.kind} className={cn("space-y-1 rounded-2xl border p-4", VERDICT_TONE[data.verdict.kind])}>
          <h2 className="flex items-center gap-2 font-bold"><Scale aria-hidden size={18} />{data.verdict.headlineFa}</h2>
          <p className="text-sm leading-7">{data.verdict.detailFa}</p>
          {win && data.verdict.marginToman ? <p className="text-xs">اختلاف با نفر بعدی: {formatToman(data.verdict.marginToman)}</p> : null}
        </section>
      ) : null}

      {/* ---------- states ---------- */}
      {sit === "NO_SELLERS_SELECTED" ? (
        <EmptyState icon={<Scale size={22} />} title="هنوز فروشگاهی برای مقایسه انتخاب نشده" action={<Link href={sellersHref} className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 font-semibold text-brand-ink">انتخاب از فروشگاه‌های اطراف</Link>}>
          <p data-testid="state-none">از صفحه‌ی فروشگاه‌های اطراف ۲ تا {fa(COMPARE_LIMITS.maxSellers)} فروشگاه را تیک بزنید، یا از فهرست زیر اضافه کنید.</p>
        </EmptyState>
      ) : null}
      {sit === "VARIANT_UNCONFIRMED" ? (
        <div role="alert" data-testid="state-variant" className="flex gap-2 rounded-2xl border border-warn-line bg-warn-bg p-4 text-sm leading-7 text-warn-ink">
          <CircleAlert aria-hidden size={18} className="mt-1 shrink-0" />
          <div><p className="font-bold">نسخه‌ی دقیق انتخاب نشده است</p><p>پیشنهادهای این محصول لزوماً یک کالا نیستند، پس رتبه‌بندی نمی‌شوند. <Link className="font-semibold underline" href={`/products/${data.product?.id}`}>نسخه را در صفحه‌ی محصول انتخاب کنید</Link> یا از <Link className="font-semibold underline" href={sellersHref}>فروشگاه‌های اطراف</Link> ادامه دهید.</p></div>
        </div>
      ) : null}
      {sit === "SINGLE_SELLER" ? <p role="status" data-testid="state-single" className="rounded-xl bg-brand-soft p-3 text-sm leading-7 text-brand-soft-ink">فقط یک فروشگاه انتخاب شده؛ مقایسه به حداقل {fa(COMPARE_LIMITS.minSellers)} فروشگاه نیاز دارد. بدون مقایسه هم شواهد این فروشگاه را می‌بینید؛ فروشگاه دیگری اضافه کنید.</p> : null}
      {sit === "NO_COMPARABLE_SELLERS" ? <p role="status" data-testid="state-none-comparable" className="rounded-xl bg-warn-bg p-3 text-sm leading-7 text-warn-ink">هیچ‌کدام از فروشگاه‌های انتخابی برای نسخه‌ی انتخابی پیشنهادِ هم‌خوان ندارند؛ همه‌ی پیشنهادها زیر نمایش داده می‌شوند ولی رتبه‌بندی نشده‌اند.</p> : null}

      {data.budgetGroups ? (
        <section aria-label="گروه‌بندی بودجه" data-testid="budget-groups" className="grid gap-2 text-sm sm:grid-cols-3">
          {([["داخل بودجه", data.budgetGroups.within], ["بیش از بودجه", data.budgetGroups.over], ["نسبت به بودجه نامعلوم", data.budgetGroups.unknown]] as const).map(([t, ids]) => (
            <div key={t} className="rounded-xl border border-line bg-surface p-3"><p className="font-semibold">{t} ({fa(ids.length)})</p><p className="text-xs text-ink-2">{ids.map((id) => data.sellers.find((s) => s.shopId === id)?.name).filter(Boolean).join("، ") || "—"}</p></div>
          ))}
        </section>
      ) : null}

      {data.sellers.length > 0 ? (
        <CompareTable data={data} shopHref={sellerHrefs.shop} missionHref={sellerHrefs.mission} removeHref={sellerHrefs.remove} />
      ) : null}

      {/* ---------- add sellers ---------- */}
      <Card className="space-y-3" aria-labelledby="add-h">
        <h2 id="add-h" className="font-bold">افزودن فروشگاه به مقایسه</h2>
        <p className="text-xs leading-6 text-ink-2">فقط فروشگاه‌هایی که برای همین محصول پیشنهاد ثبت کرده‌اند {data.criteria.origin ? `و در شعاع ${radiusLabel(params.radius)} از «${data.criteria.origin.label}» هستند` : ""} پیشنهاد می‌شوند. حداکثر {fa(COMPARE_LIMITS.maxSellers)} فروشگاه.</p>
        {data.candidates.length ? (
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="candidates">
            {data.candidates.map((c) => (
              <li key={c.shopId} className="flex items-center justify-between gap-2 rounded-xl border border-line p-2.5">
                <div className="min-w-0 text-sm"><p className="truncate font-semibold"><bdi>{c.name}</bdi></p><p className="text-xs text-ink-2">{c.locationLabel ?? ""}{c.distanceMeters !== null ? ` · حدود ${formatDistance(c.distanceMeters)}` : ""} · {fa(c.offerCount)} پیشنهاد</p></div>
                <button type="button" disabled={!canAdd} onClick={() => go({ shops: [...params.shops, c.shopId] })} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-brand px-3 text-sm font-semibold text-brand hover:bg-brand-soft disabled:opacity-50" data-testid="add-candidate"><Plus aria-hidden size={14} />افزودن<span className="sr-only"> {c.name}</span></button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-2" data-testid="no-candidates">فروشگاه دیگری در این شعاع با پیشنهاد هم‌خوان پیدا نشد. شعاع را بیشتر کنید یا <Link className="text-brand underline" href={sellersHref}>همه‌ی فروشگاه‌ها را ببینید</Link>.</p>}
        <p className="text-xs leading-6 text-ink-2">عکس داده: {data.time.snapshotRef ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", dateStyle: "long" }).format(new Date(data.time.snapshotRef)) : "نامعلوم"}؛ امروز (تهران): {new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", dateStyle: "long" }).format(new Date(`${data.time.todayTehran}T12:00:00+03:30`))}. «قدیمی» یعنی بیش از {fa(data.time.staleRuleDays)} روز پیش از عکس داده؛ «روز پیش از امروز» زمان واقعی سپری‌شده است.</p>
      </Card>
      {busy ? <p className="sr-only" role="status">در حال به‌روزرسانی مقایسه…</p> : null}
    </div>
  );
}
