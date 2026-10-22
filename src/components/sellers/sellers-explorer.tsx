"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Crosshair, List, LocateFixed, Map as MapIcon, MapPinned, SearchX, TriangleAlert, X } from "lucide-react";
import { COMPARE_LIMITS } from "@/domain/comparison";
import type { SellersResponse } from "@/domain/sellers";
import { AreaLeadCard } from "@/components/sellers/area-lead-card";
import { SellerCard } from "@/components/sellers/seller-card";
import { Badge, Button, Card, EmptyState, inputStyles } from "@/components/ui";
import { formatToman, toFaDigits } from "@/lib/format";
import { RADIUS_OPTIONS, radiusLabel, snapOrigin } from "@/lib/geo";
import { GPS_MESSAGE, requestPosition, type GpsStatus } from "@/lib/gps";
import { buildCompareHref } from "@/lib/compare-url";
import { buildMissionHref } from "@/lib/mission-url";
import { buildShopHref, buildSellersHref, type OriginKey, type SellersParams } from "@/lib/sellers-url";
import { DISTANCE_NOTE } from "@/lib/seller-labels";
import { cn } from "@/lib/cn";

const NearbyMap = dynamic(() => import("@/components/sellers/nearby-map").then((m) => m.NearbyMap), {
  ssr: false,
  loading: () => <div role="status" className="grid h-full min-h-72 place-items-center rounded-2xl border border-line bg-surface-2 text-sm text-ink-2">در حال آماده‌سازی نقشه…</div>,
});

const PAGE_STEP = 12;
export interface PresetView { id: string; label: string }
type ActivityState = { state: "idle" } | { state: "loading" } | { state: "error" } | { state: "ok"; data: import("@/domain/sellers").CategoryActivityResponse };

export function SellersExplorer({ initial, params, presets }: { initial: SellersResponse; params: SellersParams; presets: PresetView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<"list" | "map">(params.view);
  const [selectedShops, setSelectedShops] = useState<string[]>(params.shop ? [params.shop] : []);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [cmpIds, setCmpIds] = useState<string[]>(params.cmp);
  const [cmpNames, setCmpNames] = useState<Record<string, string>>({});
  // Back/Forward can restore this page from the router cache with the ORIGINAL props while the address bar (updated via history.replaceState) already carries the
  // picks: the URL is the truth, so re-read `cmp` once after mount.
  useEffect(() => {
    const ids = [...new Set((new URLSearchParams(window.location.search).get("cmp") ?? "").split(",").filter((x) => /^shop_[0-9a-f]{8,40}$/.test(x)))].slice(0, 4);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCmpIds((prev) => (prev.join(",") === ids.join(",") ? prev : ids));
  }, []);
  const [pickMode, setPickMode] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [gpsPoint, setGpsPoint] = useState<{ lat: number; lon: number } | null>(null); // memory only — never URL/storage
  const [gpsData, setGpsData] = useState<{ key: string; data: SellersResponse } | null>(null);
  const [activity, setActivity] = useState<ActivityState>({ state: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const [more, setMore] = useState<{ key: string; n: number }>({ key: "", n: PAGE_STEP });

  const gpsMode = params.origin === "gps";
  const filtersKey = `${params.product}|${params.variant}|${params.radius}|${params.uncertain}|${params.sort}|${params.open}|${params.reliable}|${params.pay}|${gpsPoint?.lat},${gpsPoint?.lon}`;
  const data = gpsMode && gpsData ? gpsData.data : initial;
  const tilesEnabled = !tilesFailed && (params.tiles ?? !gpsMode);
  const busy = pending || (gpsMode && !!gpsPoint && gpsData?.key !== filtersKey);
  const selectedId = selectedShops[0] ?? null;

  // ---- navigation (URL = source of truth for everything except GPS coordinates)
  const hrefFor = useCallback((patch: Partial<SellersParams>) => buildSellersHref({ ...params, view, shop: selectedId, cmp: cmpIds, ...patch }), [params, view, selectedId, cmpIds]);
  const go = useCallback((patch: Partial<SellersParams>) => {
    startTransition(() => router.push(hrefFor({ page: 1, ...patch }), { scroll: false }));
  }, [router, hrefFor]);
  const mirror = useCallback((patch: Partial<SellersParams>) => {
    try { window.history.replaceState(window.history.state, "", hrefFor(patch)); } catch { /* history unavailable: state stays in memory */ }
  }, [hrefFor]);

  // ---- GPS: results are fetched with POST so precise-ish coordinates never appear in a URL
  useEffect(() => {
    if (!gpsMode || !gpsPoint) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    fetch("/api/sellers", {
      method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gps: gpsPoint, product: params.product, variant: params.variant ?? undefined, r: params.radius, uncertain: params.uncertain, sort: params.sort, open: params.open, reliable: params.reliable, pay: params.pay ?? undefined, pageSize: 50 }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<SellersResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => setGpsData({ key: filtersKey, data: d }))
      .catch((e: unknown) => { if ((e as Error).name !== "AbortError") setGpsStatus("unavailable"); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsMode, gpsPoint, filtersKey]);

  const useGps = async () => {
    setGpsStatus("requesting");
    const r = await requestPosition(typeof navigator !== "undefined" ? navigator.geolocation : undefined);
    if (r.status !== "granted") { setGpsStatus(r.status); return; }
    setGpsStatus("granted");
    setGpsPoint(snapOrigin(r.point));
    go({ origin: "gps", ll: null });
  };
  const chooseOrigin = (o: OriginKey) => { setGpsData(null); setPickMode(false); go({ origin: o, ll: null }); };
  const onPick = (lat: number, lon: number) => {
    const s = snapOrigin({ lat, lon });
    setPickMode(false); setGpsData(null);
    go({ origin: "map", ll: s });
  };

  // ---- selection shared by list and map
  const sellersAll = useMemo(() => [...data.sellers, ...data.outsideRadius.filter((o) => !data.sellers.some((s) => s.shopId === o.shopId))], [data]);
  const selectedSellers = sellersAll.filter((s) => selectedShops.includes(s.shopId));
  const selectShops = (ids: string[]) => { setSelectedShops(ids); setSelectedArea(null); mirror({ shop: ids[0] ?? null }); if (ids[0]) document.getElementById(`seller-${ids[0]}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
  const showOnMap = (id: string) => { setSelectedShops([id]); setSelectedArea(null); setView("map"); mirror({ shop: id, view: "map" }); };
  const toggleCmp = (id: string) => {
    const name = sellersAll.find((x) => x.shopId === id)?.name;
    const next = cmpIds.includes(id) ? cmpIds.filter((x) => x !== id) : cmpIds.length < COMPARE_LIMITS.maxSellers ? [...cmpIds, id] : cmpIds;
    if (name) setCmpNames((m) => ({ ...m, [id]: name }));
    setCmpIds(next);
    mirror({ cmp: next });
  };
  const cmpProps = (id: string) => ({ checked: cmpIds.includes(id), disabled: cmpIds.length >= COMPARE_LIMITS.maxSellers, onToggle: toggleCmp });
  const originKey = (params.origin ?? presets[0]?.id ?? null) as OriginKey | null;
  const compareBase = { product: params.product, variant: data.variant.selectedGroupId, origin: originKey, ll: params.ll, radius: params.radius, bmin: params.bmin, bmax: params.bmax, back: hrefFor({}) };
  const compareHref = buildCompareHref({ ...compareBase, shops: cmpIds });
  const switchView = (v: "list" | "map") => { setView(v); mirror({ view: v }); };
  // focus management for the (non-modal) sheet: move focus in when it opens, give it back to the opener when it closes
  const sheetRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const sheetOpen = selectedShops.length > 0 || !!selectedArea;
  useEffect(() => {
    if (sheetOpen) {
      const a = document.activeElement;
      if (a instanceof HTMLElement && a !== document.body && !sheetRef.current?.contains(a)) openerRef.current = a;
      sheetRef.current?.focus({ preventScroll: true });
      return;
    }
    const o = openerRef.current; openerRef.current = null;
    if (o && o.isConnected && (document.activeElement === document.body || document.activeElement === null)) o.focus({ preventScroll: true });
  }, [sheetOpen]);
  useEffect(() => {
    if (!selectedShops.length && !selectedArea) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setSelectedShops([]); setSelectedArea(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedShops.length, selectedArea]);

  const loadActivity = async () => {
    if (!data.product || activity.state === "loading") return;
    setActivity({ state: "loading" });
    try {
      const qs = new URLSearchParams({ category: data.product.categoryName, product: data.product.id, r: String(params.radius), o: params.origin === "map" ? "map" : params.origin === "gps" ? "" : (params.origin ?? "ferdowsi") });
      if (params.origin === "map" && params.ll) qs.set("ll", `${params.ll.lat},${params.ll.lon}`);
      if (gpsMode && data.origin) qs.set("ll", `${data.origin.lat},${data.origin.lon}`);
      const r = await fetch(`/api/activity?${qs.toString()}`);
      if (!r.ok) throw new Error(String(r.status));
      setActivity({ state: "ok", data: await r.json() });
    } catch { setActivity({ state: "error" }); }
  };

  const hrefFor1 = (shopId: string) => buildShopHref(shopId, { product: params.product, variant: data.variant.selectedGroupId, back: hrefFor({ shop: shopId }) });
  const inquiry = (s: { shopId: string; offerIds: string[] }) => buildMissionHref({ product: params.product, variant: data.variant.selectedGroupId, shop: s.shopId, offer: s.offerIds.length === 1 ? s.offerIds[0] : null, back: hrefFor({ shop: s.shopId }) });
  const handoff = (shopId: string) => buildCompareHref({ ...compareBase, shops: [shopId] });

  const origin = data.origin;
  const mapShops = sellersAll.map((s) => ({ id: s.shopId, name: s.name, lat: s.lat, lon: s.lon, distanceMeters: s.distanceMeters }));
  const mapAreas = data.areaLeads.map((r) => ({ id: r.area.id, name: r.area.nameFa, lat: r.area.center.lat, lon: r.area.center.lon, sourceType: r.area.sourceType }));
  const c = data.counts;
  const fa = toFaDigits;
  const needsVariant = data.situation === "VARIANT_UNCONFIRMED";
  const shownCount = data.sellers.length;
  const listKey = `${filtersKey}|${params.origin}|${params.ll?.lat},${params.ll?.lon}`;
  const visibleN = more.key === listKey ? more.n : PAGE_STEP;
  const visibleSellers = data.sellers.slice(0, visibleN);

  return (
    <div className="space-y-5" aria-busy={busy}>
      {/* ---------- variant confirmation (situation B) / compact selected variant ---------- */}
      {data.variant.needsConfirmation ? (
        <details open={needsVariant || !data.variant.selectedGroupId} className={cn("rounded-[var(--radius-card)] border p-4", needsVariant ? "border-warn-line bg-warn-bg" : "border-line bg-surface")} data-testid="variant-panel">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-bold"><TriangleAlert aria-hidden size={18} />{needsVariant ? "نسخه‌ی دقیق را تأیید کنید" : <>نسخه‌ی انتخابی: <bdi className="font-semibold">{data.variant.groups.find((g) => g.id === data.variant.selectedGroupId)?.label ?? "—"}</bdi> <span className="text-sm font-normal text-brand">(تغییر)</span></>}</summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm leading-7">{needsVariant
              ? `${fa(c.shopsAnyVariant)} فروشگاه برای این شناسه‌ی محصول پیشنهاد ثبت کرده‌اند، اما پیشنهادها لزوماً یک کالای یکسان نیستند (کد مدل یا واحد قیمت متفاوت). تا نسخه را انتخاب نکنید، هیچ فروشگاهی «فروشنده‌ی همین نسخه» نشان داده نمی‌شود.`
              : "پیشنهادها فقط با برداشت از عنوان فروشنده با نسخه‌ی انتخابی می‌خوانند؛ پیش از رفتن تأیید کنید."}</p>
            <div role="radiogroup" aria-label="نسخه‌ی دقیق محصول" className="grid gap-2">
              {data.variant.groups.map((g) => (
                <button key={g.id} type="button" role="radio" aria-checked={data.variant.selectedGroupId === g.id} onClick={() => go({ variant: g.id })}
                  className={cn("rounded-2xl border p-3 text-start", data.variant.selectedGroupId === g.id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand")}>
                  <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{g.label}</span><span className="text-xs text-ink-2">{fa(g.offerCount)} پیشنهاد</span></span>
                  <span className="mt-1 block text-xs text-ink-2">نمونه عنوان فروشنده: <bdi>{g.sampleTitle.slice(0, 90)}</bdi></span>
                </button>
              ))}
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={params.uncertain} onChange={(e) => go({ uncertain: e.target.checked })} />نمایش فروشگاه‌های نسخه‌ی نامطمئن هم (با هشدار روشن)</label>
          </div>
        </details>
      ) : null}

      {/* ---------- origin / radius / filters ---------- */}
      <Card className="space-y-4" aria-labelledby="where-h">
        <h2 id="where-h" className="font-bold">کجا هستید؟</h2>
        <div role="radiogroup" aria-label="محله‌ی شروع" className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={params.origin === p.id || (!params.origin && p.id === presets[0]?.id)} onClick={() => chooseOrigin(p.id as OriginKey)}
              className={cn("min-h-11 rounded-full border px-4 text-sm font-medium", (params.origin === p.id || (!params.origin && p.id === presets[0]?.id)) ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2")}>
              {p.label}
            </button>
          ))}
          <button type="button" aria-pressed={pickMode} onClick={() => { setPickMode((v) => !v); switchView("map"); }}
            className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium", pickMode ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2")}>
            <Crosshair aria-hidden size={16} />{pickMode ? "روی نقشه ضربه بزنید…" : params.origin === "map" ? "نقطه‌ی انتخابی (تغییر)" : "انتخاب روی نقشه"}
          </button>
          <Button variant="secondary" onClick={useGps} disabled={gpsStatus === "requesting"} data-testid="gps-button"><LocateFixed aria-hidden size={16} />{gpsStatus === "denied" || gpsStatus === "timeout" || gpsStatus === "unavailable" ? "تلاش دوباره برای موقعیت من" : "استفاده از موقعیت من"}</Button>
        </div>
        <p className="text-xs leading-6 text-ink-2">موقعیت‌یابی اختیاری است و فقط با دکمه‌ی بالا و اجازه‌ی مرورگر انجام می‌شود. موقعیت دقیق شما در نشانی صفحه، حافظه‌ی مرورگر یا گزارش‌ها ذخیره نمی‌شود (به حدود ۱۰۰ متر گرد می‌شود).</p>
        {GPS_MESSAGE[gpsStatus] ? <p role="status" data-testid="gps-message" className={cn("rounded-xl p-3 text-sm leading-7", gpsStatus === "granted" ? "bg-ok-bg text-ok-ink" : gpsStatus === "requesting" ? "bg-surface-2" : "bg-warn-bg text-warn-ink")}>{GPS_MESSAGE[gpsStatus]}</p> : null}
        {gpsMode && !gpsPoint && gpsStatus === "idle" ? <p role="status" className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">برای نمایش نزدیک‌ترین فروشگاه‌ها به موقعیت خودتان، دوباره «استفاده از موقعیت من» را بزنید (موقعیت ذخیره نمی‌شود). فعلاً نتایج برای محله‌ی پیش‌فرض است.</p> : null}
        {origin?.defaulted ? <p role="status" className="rounded-xl bg-surface-2 p-3 text-sm">نقطه‌ی شروع پیش‌فرض «{origin.label}» است؛ محله‌ی نزدیک‌تر به خودتان را انتخاب کنید.</p> : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">شعاع جست‌وجو (خط مستقیم)</legend>
          <div role="radiogroup" aria-label="شعاع" className="flex flex-wrap gap-2">
            {RADIUS_OPTIONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={params.radius === r} onClick={() => go({ radius: r })}
                className={cn("min-h-11 rounded-full border px-4 text-sm font-medium", params.radius === r ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2")}>{radiusLabel(r)}</button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm"><span className="font-semibold">مرتب‌سازی</span>
            <select className={inputStyles} value={params.sort} onChange={(e) => go({ sort: e.target.value as SellersParams["sort"] })}>
              <option value="distance">نزدیک‌ترین</option><option value="price">کمترین قیمت ثبت‌شده</option><option value="recent">تازه‌ترین قیمت</option>
            </select></label>
          <label className="space-y-1 text-sm"><span className="font-semibold">پرداخت اعلام‌شده</span>
            <select className={inputStyles} value={params.pay ?? ""} onChange={(e) => go({ pay: e.target.value || null })}>
              <option value="">همه</option>{["ترب‌پی", "اسنپ‌پی", "دیجی پی", "تارا", "ازکی‌وام"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select></label>
          <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" className="size-5" checked={params.open} onChange={(e) => go({ open: e.target.checked })} />فقط «باز» طبق ساعت اعلام‌شده</label>
          <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" className="size-5" checked={params.reliable} onChange={(e) => go({ reliable: e.target.checked })} />فقط دارای قیمت قابل‌اتکا</label>
        </div>
      </Card>

      {/* ---------- counts ---------- */}
      {data.situation !== "VARIANT_UNCONFIRMED" ? (
        <p role="status" data-testid="counts" className="text-sm leading-7">
          <strong>{fa(c.shopsWithinRadius)}</strong> فروشگاه در شعاع {radiusLabel(params.radius)} از «{origin?.label ?? "نقطه‌ی شروع"}»
          {" "}(از {fa(c.shopsTotal)} فروشگاهی که برای این نسخه پیشنهاد ثبت کرده‌اند؛ {fa(c.offersWithinRadius)} پیشنهاد در شعاع از {fa(c.offersTotal)} پیشنهاد).
          {" "}<span className="text-ink-2">{DISTANCE_NOTE}</span>
          {c.shopsAfterFilters !== c.shopsWithinRadius ? <> پس از فیلترها: <strong>{fa(c.shopsAfterFilters)}</strong>.</> : null}
        </p>
      ) : null}
      {data.notices.filter((n) => !n.startsWith("نقطه‌ی شروع پیش‌فرض")).map((n) => <p key={n} role="status" className="flex gap-2 rounded-xl bg-warn-bg p-3 text-sm leading-7 text-warn-ink"><TriangleAlert aria-hidden size={16} className="mt-1 shrink-0" />{n}</p>)}

      {/* ---------- list / map ---------- */}
      <div role="tablist" aria-label="نمای نتایج" className="flex gap-2 lg:hidden">
        {(["list", "map"] as const).map((v) => (
          <button key={v} role="tab" type="button" aria-selected={view === v} aria-controls={v === "list" ? "panel-list" : "panel-map"} onClick={() => switchView(v)}
            className={cn("inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border font-semibold", view === v ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface")}>
            {v === "list" ? <List aria-hidden size={16} /> : <MapIcon aria-hidden size={16} />}{v === "list" ? "فهرست" : "نقشه"}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div id="panel-list" role="tabpanel" aria-label="فهرست فروشگاه‌ها" className={cn("min-w-0 space-y-4", view === "map" && "hidden lg:block")}>
          <SituationBlocks data={data} params={params} go={go} />
          {data.sellers.length > 0 ? (
            <ul data-testid="seller-list" aria-label="فروشگاه‌های دارای پیشنهاد ثبت‌شده" className="space-y-3">
              {visibleSellers.map((s) => <SellerCard key={s.shopId} seller={s} detailHref={hrefFor1(s.shopId)} handoffHref={handoff(s.shopId)} inquiryHref={inquiry(s)} selected={selectedShops.includes(s.shopId)} onShowOnMap={showOnMap} compare={cmpProps(s.shopId)} />)}
            </ul>
          ) : null}
          {visibleSellers.length < data.sellers.length ? <button type="button" data-testid="show-more" onClick={() => setMore({ key: listKey, n: visibleN + PAGE_STEP })} className="min-h-11 w-full rounded-xl border border-line bg-surface font-semibold text-brand hover:bg-surface-2">نمایش بیشتر ({fa(visibleSellers.length)} از {fa(data.sellers.length)})</button> : null}
          {data.sellers.length > 0 && data.hasMore ? <p className="text-xs text-ink-2">فقط نزدیک‌ترین {fa(shownCount)} فروشگاه نمایش داده می‌شود؛ برای دیدن بقیه شعاع را کم کنید یا فیلتر بگذارید.</p> : null}
          {data.outsideRadius.length > 0 ? (
            <section aria-labelledby="outside-h" className="space-y-3" data-testid="outside-radius">
              <h3 id="outside-h" className="font-bold">نزدیک‌ترین فروشگاه‌های واقعی بیرون از شعاع</h3>
              <p className="text-sm text-ink-2">این‌ها پیشنهاد ثبت‌شده برای همین نسخه دارند اما بیرون از {radiusLabel(params.radius)} هستند.</p>
              <ul className="space-y-3">{data.outsideRadius.map((s) => <SellerCard key={s.shopId} seller={s} outside detailHref={hrefFor1(s.shopId)} handoffHref={handoff(s.shopId)} inquiryHref={inquiry(s)} selected={selectedShops.includes(s.shopId)} onShowOnMap={showOnMap} compare={cmpProps(s.shopId)} />)}</ul>
            </section>
          ) : null}
          {data.areaLeads.length > 0 ? (
            <section aria-labelledby="areas-h" className="space-y-3" data-testid="area-leads">
              <h3 id="areas-h" className="flex items-center gap-2 font-bold"><MapPinned aria-hidden size={18} />مناطق پیشنهادی برای جست‌وجو</h3>
              <p className="text-sm leading-7 text-ink-2">این‌ها فروشنده‌ی این محصول نیستند؛ محله‌هایی‌اند که بر پایه‌ی منبع یا تراکم داده برای این دسته ارزش گشتن دارند.</p>
              <ul className="space-y-3">{data.areaLeads.map((r) => <AreaLeadCard key={r.area.id} rec={r} selected={selectedArea === r.area.id} onShowOnMap={(id) => { setSelectedArea(id); setSelectedShops([]); setView("map"); }} />)}</ul>
            </section>
          ) : null}
          <details onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && activity.state === "idle") void loadActivity(); }} className="rounded-2xl border border-line bg-surface" data-testid="activity-details">
            <summary className="min-h-11 cursor-pointer px-4 py-2.5 font-semibold">فروشگاه‌های فعال در همین دسته (بدون پیشنهاد برای این محصول)</summary>
            <div className="space-y-2 px-4 pb-4 text-sm">
              {activity.state === "loading" ? <p role="status">در حال بارگذاری…</p> : null}
              {activity.state === "error" ? <p role="alert" className="text-danger-ink">بارگذاری نشد. <button type="button" className="underline" onClick={() => { setActivity({ state: "idle" }); void loadActivity(); }}>تلاش دوباره</button></p> : null}
              {activity.state === "ok" ? (
                <>
                  <p className="rounded-xl bg-warn-bg p-3 leading-7 text-warn-ink">{activity.data.disclaimerFa}</p>
                  <p>{fa(activity.data.total)} فروشگاه ({fa(activity.data.withinRadius)} در شعاع انتخابی) این دسته را اعلام کرده‌اند ولی برای این محصول پیشنهادی ثبت نکرده‌اند.</p>
                  <ul className="space-y-2" data-testid="activity-list">{activity.data.shops.slice(0, 10).map((s) => (
                    <li key={s.shopId} className="rounded-xl bg-surface-2 p-2.5"><bdi className="font-semibold">{s.name}</bdi> {s.locationLabel ? <Badge>{s.locationLabel}</Badge> : null} {s.distanceMeters !== null ? <span className="text-xs text-ink-2">· حدود {s.distanceMeters < 1000 ? `${fa(Math.round(s.distanceMeters))} متر` : `${fa((s.distanceMeters / 1000).toFixed(1))} کیلومتر`}</span> : null}
                      <br /><Link className="text-xs text-brand hover:underline" href={buildShopHref(s.shopId, { back: hrefFor({}) })}>جزئیات فروشگاه</Link></li>
                  ))}</ul>
                </>
              ) : null}
            </div>
          </details>
        </div>

        <div id="panel-map" role="tabpanel" aria-label="نقشه" className={cn("min-w-0", view === "list" && "hidden lg:block")}>
          <div className="relative lg:sticky lg:top-4">
            <div className="h-[28rem] sm:h-[34rem] lg:h-[calc(100vh-8rem)] lg:min-h-[28rem]">
              <NearbyMap
                origin={origin ? { lat: origin.lat, lon: origin.lon, label: origin.label ?? "نقطه‌ی شروع" } : null}
                radiusMeters={params.radius} shops={mapShops} areas={mapAreas}
                selectedShopId={selectedId} selectedAreaId={selectedArea} tilesEnabled={tilesEnabled} pickMode={pickMode}
                onSelectShops={selectShops} onSelectArea={(id) => { setSelectedArea(id); setSelectedShops([]); }}
                onPickOrigin={onPick} onTilesFailed={() => setTilesFailed(true)}
              />
            </div>
            {/* bottom sheet (selected seller / group / area) */}
            {selectedSellers.length > 0 || selectedArea ? (
              <aside ref={sheetRef} tabIndex={-1} role="region" aria-label="جزئیات انتخاب‌شده روی نقشه" data-testid="map-sheet" className="absolute outline-none focus-visible:ring-2 focus-visible:ring-brand inset-x-2 bottom-2 z-[500] max-h-[55%] overflow-y-auto rounded-2xl border border-line bg-surface p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-bold">{selectedArea ? "منطقه‌ی پیشنهادی (فروشنده نیست)" : selectedSellers.length > 1 ? `${fa(selectedSellers.length)} فروشگاه با مختصات یکسان` : "فروشگاه انتخاب‌شده"}</p>
                  <button type="button" aria-label="بستن" onClick={() => { setSelectedShops([]); setSelectedArea(null); mirror({ shop: null }); }} className="grid size-11 place-items-center rounded-full hover:bg-surface-2"><X aria-hidden size={18} /></button>
                </div>
                {selectedArea ? (
                  <ul>{data.areaLeads.filter((r) => r.area.id === selectedArea).map((r) => <AreaLeadCard key={r.area.id} rec={r} selected />)}</ul>
                ) : (
                  <ul className="space-y-2">{selectedSellers.map((s) => <SellerCard key={s.shopId} seller={s} outside={s.distanceMeters !== null && s.distanceMeters > params.radius} detailHref={hrefFor1(s.shopId)} handoffHref={handoff(s.shopId)} inquiryHref={inquiry(s)} selected compare={cmpProps(s.shopId)} />)}</ul>
                )}
              </aside>
            ) : null}
          </div>
          <div className="mt-2 space-y-1 text-xs leading-6 text-ink-2" data-testid="map-legend">
            <p aria-label="راهنمای نشانگرها" className="flex flex-wrap gap-x-4 gap-y-1">
              <span><span aria-hidden className="me-1 inline-block size-3 rounded-full bg-[#0a5c70] align-middle" />فروشگاه دارای پیشنهاد ثبت‌شده</span>
              <span><span aria-hidden className="me-1 inline-block size-3 rotate-45 bg-[#b45309] align-middle" />منطقه‌ی پیشنهادی (فروشنده نیست)</span>
              <span><span aria-hidden className="me-1 inline-block size-3 rounded-full border-2 border-[#1d4ed8] bg-white align-middle" />نقطه‌ی شروع</span>
            </p>
            <p>نشانگر شماره‌دار: چند فروشگاه با مختصات یکسان ثبت شده‌اند (معمولاً در یک پاساژ)؛ روی آن بزنید تا همه را ببینید.</p>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={tilesEnabled} disabled={tilesFailed} onChange={(e) => { setTilesFailed(false); go({ tiles: e.target.checked }); }} />
              نمایش نقشه‌ی خیابانی (بارگذاری کاشی از OpenStreetMap)</label>
            <p data-testid="tiles-note">{tilesFailed ? "کاشی‌های نقشه بارگذاری نشد؛ نشانگرها روی زمینه‌ی ساده دیده می‌شوند و فهرست کامل است. " : tilesEnabled ? "با روشن بودن نقشه، مرورگر شما کاشی‌ها را از سرور OpenStreetMap می‌گیرد و آن سرور ناحیه‌ی در حال دیدن را می‌بیند. " : "نقشه‌ی خیابانی خاموش است؛ هیچ درخواستی به سرور بیرونی نمی‌رود. "}<span dir="ltr">© OpenStreetMap contributors (ODbL)</span>.</p>
          </div>
        </div>
      </div>
      {cmpIds.length > 0 ? (
        <section aria-label="فروشگاه‌های انتخاب‌شده برای مقایسه" data-testid="compare-bar" className="sticky bottom-20 z-30 space-y-2 rounded-2xl border border-brand bg-surface p-3 shadow-lg md:bottom-4">
          <p className="text-sm font-semibold">{fa(cmpIds.length)} فروشگاه برای مقایسه <span className="font-normal text-ink-2">({cmpIds.map((id) => cmpNames[id] ?? sellersAll.find((x) => x.shopId === id)?.name ?? "فروشگاه").join("، ")})</span></p>
          <div className="flex flex-wrap items-center gap-2">
            {cmpIds.length >= COMPARE_LIMITS.minSellers ? (
              <Link href={compareHref} data-testid="compare-go" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-hover">مقایسه‌ی {fa(cmpIds.length)} فروشگاه</Link>
            ) : (
              <>
                <Link href={compareHref} data-testid="compare-go" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold text-brand">دیدن همین یک فروشگاه در مقایسه</Link>
                <span className="text-xs text-ink-2">برای مقایسه حداقل {fa(COMPARE_LIMITS.minSellers)} فروشگاه (حداکثر {fa(COMPARE_LIMITS.maxSellers)}) تیک بزنید.</span>
              </>
            )}
            <button type="button" onClick={() => { setCmpIds([]); mirror({ cmp: [] }); }} className="min-h-11 rounded-xl px-3 text-sm text-ink-2 underline">پاک کردن انتخاب‌ها</button>
          </div>
        </section>
      ) : null}
      {busy ? <p className="sr-only" role="status">در حال به‌روزرسانی نتایج…</p> : null}
    </div>
  );
}

/** Messages for situations A (nothing in radius), B (no reliable variant), no-offers. Geographic states stay separate. */
function SituationBlocks({ data, params, go }: { data: SellersResponse; params: SellersParams; go: (p: Partial<SellersParams>) => void }) {
  const fa = toFaDigits;
  if (data.situation === "NO_SHOP_IN_RADIUS") {
    return (
      <EmptyState icon={<SearchX size={22} />} title={`در شعاع ${radiusLabel(params.radius)} فروشگاهی با پیشنهاد ثبت‌شده نیست`}>
        <p data-testid="situation-a">این فقط درباره‌ی داده‌ی ما است، نه ادعا درباره‌ی نبود مغازه در تهران. {data.counts.shopsTotal > 0 ? `${fa(data.counts.shopsTotal)} فروشگاه در داده برای این نسخه پیشنهاد دارند.` : null}</p>
        {data.radiusHints.length > 0 ? (
          <div className="mt-3 flex flex-wrap justify-center gap-2" aria-label="گسترش شعاع">
            {data.radiusHints.slice(0, 3).map((h) => <button key={h.radiusMeters} type="button" onClick={() => go({ radius: h.radiusMeters })} className="min-h-11 rounded-full border border-brand bg-brand-soft px-4 text-sm font-semibold text-brand-soft-ink">با {radiusLabel(h.radiusMeters)}: {fa(h.shops)} فروشگاه</button>)}
          </div>
        ) : <p className="mt-2">حتی با بزرگ‌ترین شعاع فروشگاهی پیدا نشد.</p>}
      </EmptyState>
    );
  }
  if (data.situation === "NO_RELIABLE_VARIANT_MATCH") {
    return (
      <EmptyState icon={<SearchX size={22} />} title="فروشگاهی با نسخه‌ی قابل‌اتکا پیدا نشد">
        <p data-testid="situation-b">پیشنهادهای این محصول با نسخه‌ی انتخابی شما به‌اندازه‌ی کافی نمی‌خوانند ({fa(data.counts.shopsHiddenUncertain + data.counts.shopsHiddenConflicting)} فروشگاه پنهان شد). می‌توانید نسخه‌ی دیگری انتخاب کنید یا فروشگاه‌های نامطمئن را با هشدار ببینید.</p>
        <div className="mt-3 flex justify-center"><Button variant="secondary" onClick={() => go({ uncertain: true })}>نمایش فروشگاه‌های نامطمئن</Button></div>
      </EmptyState>
    );
  }
  if (data.situation === "NO_OFFERS") {
    return <EmptyState icon={<SearchX size={22} />} title="برای این محصول پیشنهادی ثبت نشده"><p data-testid="situation-no-offers">هیچ فروشگاهی در داده‌ی ما برای این محصول پیشنهاد ثبت نکرده است. فروشگاه‌های فعال در همین دسته و مناطق پیشنهادی را پایین‌تر ببینید.</p></EmptyState>;
  }
  if (data.situation === "VARIANT_UNCONFIRMED") {
    return <p role="status" className="rounded-2xl border border-dashed border-line bg-surface p-4 text-sm leading-7" data-testid="situation-unconfirmed">پس از انتخاب نسخه (بالا) فروشگاه‌های دارای پیشنهاد همان نسخه نشان داده می‌شوند. قیمت ثبت‌شده‌ی محصول: {data.product ? (data.product.price.min !== null ? formatToman(data.product.price.min) : "نامشخص") : ""}</p>;
  }
  return null;
}
