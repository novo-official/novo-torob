"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, CalendarClock, Landmark, Package, Store, TriangleAlert } from "lucide-react";
import type { InquiryContext, ReplyEvidence } from "@/domain/inquiry";
import { interpretAmount } from "@/domain/inquiry-parse";
import { buildQuestions, defaultQuestionIds } from "@/domain/inquiry-questions";
import { RECOVERY_TRIGGER_FA, activeInquiry, type MissionEvent, type MissionResult, type RecoveryTrigger, type ShoppingMissionV1 } from "@/domain/mission";
import type { RecoveryPlan } from "@/domain/mission-recovery";
import { ProvenanceBadge } from "@/components/inquiry/provenance-badge";
import { Badge, Button, Card, inputStyles } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatToman, toFaDigits } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import type { MissionView } from "@/lib/mission-derive";

type Quick = "UNAVAILABLE" | "PRICE_CHANGED" | "WRONG_MODEL" | "NO_REPLY" | "PAYMENT_WARRANTY";
const QUICK: ReadonlyArray<[Quick, string]> = [
  ["UNAVAILABLE", "فروشنده گفت موجود نیست"], ["PRICE_CHANGED", "فروشنده قیمت دیگری گفت"], ["WRONG_MODEL", "فروشنده مدل/واحد دیگری گفت"], ["NO_REPLY", "پاسخی نیامد"], ["PAYMENT_WARRANTY", "گارانتی یا پرداخت فرق دارد"],
];
const rid = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const reply = (over: Partial<ReplyEvidence>): ReplyEvidence => ({ id: rid(), provenance: "USER_REPORTED", rawText: "", stock: "unknown", reportedPriceToman: null, reportedUnit: "same", model: "not_asked", warranty: { report: "not_asked", months: null }, payment: "not_asked", visitNote: "", receivedLabel: null, scenarioId: null, ...over });
const nowIso = () => new Date().toISOString();

export function RecoverTab({ m, ctx, view, dispatch, focusTrigger }: {
  m: ShoppingMissionV1; ctx: InquiryContext | null; view: MissionView; dispatch: (e: MissionEvent) => MissionResult; focusTrigger: RecoveryTrigger | null;
}) {
  const [open, setOpen] = useState<RecoveryTrigger | null>(focusTrigger);
  const [quick, setQuick] = useState<Quick>("UNAVAILABLE");
  const [priceText, setPriceText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const defaults = useMemo(() => (ctx ? defaultQuestionIds(buildQuestions(ctx)) : []), [ctx]);
  const inq = activeInquiry(m);
  const lastPrice = [...(inq?.replies ?? [])].reverse().find((r) => r.reportedPriceToman !== null)?.reportedPriceToman ?? null;
  const [syncedFocus, setSyncedFocus] = useState(focusTrigger);
  if (focusTrigger !== syncedFocus) { setSyncedFocus(focusTrigger); if (focusTrigger) setOpen(focusTrigger); }

  if (!m.shop || !ctx) return <Card className="space-y-2" data-testid="tab-recover"><h2 className="font-bold">جایگزین‌ها و بازیابی</h2><p className="text-sm leading-7 text-ink-2">پس از انتخاب فروشگاه و پیشنهاد، هر وقت مشکلی پیش آمد (ناموجود، قیمت متفاوت، مدل دیگر، بدون پاسخ، خارج از ساعت) این‌جا راه جایگزین با شناسه‌ی واقعی داده نشان داده می‌شود.</p></Card>;

  const report = () => {
    setErr(null);
    const ev = (r: ReplyEvidence) => dispatch({ type: "INQUIRY", event: { type: "ENTER_REPLY", reply: r, at: nowIso() }, defaults });
    let r: MissionResult;
    if (quick === "NO_REPLY") r = dispatch({ type: "INQUIRY", event: { type: "MARK_NO_RESPONSE", at: nowIso() }, defaults });
    else if (quick === "PRICE_CHANGED") {
      const a = interpretAmount(priceText, ctx.offer.priceToman, "toman");
      if (a.kind !== "ok") return setErr("مبلغ را به‌صورت عدد (تومان) بنویسید.");
      r = ev(reply({ reportedPriceToman: a.toman, stock: "unknown" }));
    } else if (quick === "UNAVAILABLE") r = ev(reply({ stock: "no" }));
    else if (quick === "WRONG_MODEL") r = ev(reply({ model: "different" }));
    else r = ev(reply({ payment: "not_available" }));
    if (!r.ok) setErr(r.messageFa); else { setOpen(quick); setPriceText(""); }
  };

  return (
    <div className="space-y-3" data-testid="tab-recover">
      {view.triggers.length ? (
        <Card className="space-y-2 border-danger-ink/40" data-testid="active-triggers">
          <h2 className="flex items-center gap-1.5 font-bold"><TriangleAlert aria-hidden size={16} className="text-danger-ink" />نیاز به تصمیم</h2>
          <ul className="space-y-2">{view.triggers.map((t) => <li key={t}><button type="button" aria-pressed={open === t} data-testid={`trigger-${t}`} onClick={() => setOpen(t)} className={cn("min-h-11 w-full rounded-xl border p-3 text-start text-sm", open === t ? "border-brand bg-brand-soft" : "border-line bg-surface")}><span className="block font-semibold">{RECOVERY_TRIGGER_FA[t]}</span><span className="block text-xs text-ink-2">راه‌های جایگزین را ببینید</span></button></li>)}</ul>
        </Card>
      ) : <Card className="space-y-1" data-testid="no-triggers"><h2 className="font-bold">فعلاً مشکلی ثبت نشده</h2><p className="text-sm leading-7 text-ink-2">اگر فروشنده چیز دیگری گفت یا پاسخی نداد، همین‌جا ثبتش کنید تا جایگزین پیدا شود.</p></Card>}

      <Card className="space-y-3" data-testid="quick-report">
        <h2 className="font-bold">ثبت سریع گزارش خودتان</h2>
        <div role="radiogroup" aria-label="چه چیزی پیش آمد؟" className="flex flex-wrap gap-2">
          {QUICK.map(([k, t]) => <button key={k} type="button" role="radio" aria-checked={quick === k} data-testid={`quick-${k}`} onClick={() => setQuick(k)} className={cn("min-h-11 rounded-full border px-3.5 text-sm", quick === k ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2")}>{t}</button>)}
        </div>
        {quick === "PRICE_CHANGED" ? (
          <div className="space-y-1"><label htmlFor="quick-price" className="text-sm font-semibold">قیمتی که فروشنده گفت (تومان)</label><input id="quick-price" inputMode="numeric" value={priceText} onChange={(e) => setPriceText(e.target.value)} className={cn(inputStyles, "max-w-[16rem]")} data-testid="quick-price" placeholder="مثلاً ۴٬۹۰۰٬۰۰۰" /></div>
        ) : null}
        <p className="text-xs leading-6 text-ink-2">این‌ها «گزارش شما» هستند: تأییدنشده، فقط برای همین ماموریت، و قیمت یا رتبه‌بندی داده را عوض نمی‌کنند. پاسخ شبیه‌سازی‌شده هرگز به این‌جا نمی‌رسد.</p>
        <Button onClick={report} data-testid="quick-submit">ثبت گزارش</Button>
        {err ? <p role="alert" className="text-sm text-danger-ink" data-testid="quick-error">{err}</p> : null}
      </Card>

      {open ? <Plan key={open} m={m} trigger={open} reported={lastPrice} dispatch={dispatch} /> : null}
    </div>
  );
}

function Plan({ m, trigger, reported, dispatch }: { m: ShoppingMissionV1; trigger: RecoveryTrigger; reported: number | null; dispatch: (e: MissionEvent) => MissionResult }) {
  const [state, setState] = useState<{ status: "loading" | "ok" | "error"; plan: RecoveryPlan | null }>({ status: "loading", plan: null });
  const key = [trigger, m.product?.productId, m.product?.variantGroupId, m.shop?.shopId, m.shop?.offerId, m.area.district, m.area.radius, m.budget.min, m.budget.max, m.visit, reported].join("|");
  useEffect(() => {
    if (!m.product || !m.shop) return;
    const ac = new AbortController();
    const sp = new URLSearchParams({ trigger, product: m.product.productId, shop: m.shop.shopId, offer: m.shop.offerId, radius: String(m.area.radius) });
    if (m.product.variantGroupId) sp.set("variant", m.product.variantGroupId);
    if (m.area.district) sp.set("district", m.area.district);
    if (m.budget.min) sp.set("bmin", String(m.budget.min));
    if (m.budget.max) sp.set("bmax", String(m.budget.max));
    if (m.visit) sp.set("visit", m.visit);
    if (reported) sp.set("reported", String(reported));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading", plan: null });
    fetch(`/api/missions/recovery?${sp}`, { signal: ac.signal, cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as RecoveryPlan; })
      .then((plan) => setState({ status: "ok", plan }))
      .catch((e) => { if (!(e instanceof DOMException && e.name === "AbortError")) setState({ status: "error", plan: null }); });
    return () => ac.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (state.status === "loading") return <p role="status" className="rounded-xl bg-surface-2 p-3 text-sm" data-testid="plan-loading">در حال یافتن جایگزین‌های واقعی در داده…</p>;
  if (state.status === "error" || !state.plan) return <p role="alert" className="rounded-xl bg-danger-bg p-3 text-sm text-danger-ink" data-testid="plan-error">یافتن جایگزین ممکن نشد؛ چیزی تغییر نکرد. دوباره تلاش کنید.</p>;
  const p = state.plan;
  const choose = (shopId: string, offerId: string) => {
    dispatch({ type: "RECOVERY_DECISION", trigger, resolution: "SWITCHED_SHOP" });
    dispatch({ type: "SELECT_SHOP", shopId, offerId, via: "RECOVERY" });
  };
  const bs = p.budgetScenario;
  return (
    <Card className="space-y-4" data-testid="recovery-plan" data-trigger={trigger}>
      <h2 className="font-bold">{RECOVERY_TRIGGER_FA[trigger]}</h2>
      <section aria-label="چه چیزی مسلم است و چه چیزی گزارش شماست" className="space-y-2" data-testid="plan-facts">
        <h3 className="text-sm font-bold">واقعیت‌ها در برابر گزارش شما</h3>
        <ul className="space-y-1.5">{p.facts.map((f) => <li key={f.labelFa} className="flex flex-wrap items-start gap-2 text-sm" data-provenance={f.provenance}><ProvenanceBadge kind={f.provenance} short /><span className="min-w-0 flex-1 leading-7"><span className="text-ink-2">{f.labelFa}: </span>{f.valueFa}</span></li>)}</ul>
      </section>

      {trigger === "PRICE_CHANGED" && bs ? (
        <section aria-label="سناریوی بودجه" className="space-y-2 rounded-xl border border-line p-3" data-testid="budget-scenario">
          <h3 className="text-sm font-bold">سناریوی بودجه (قیمت ثبت‌شده‌ی داده تغییر نمی‌کند)</h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-ink-2">ثبت‌شده در داده</dt><dd className="font-bold" data-testid="bs-recorded">{bs.recordedToman !== null ? formatToman(bs.recordedToman) : "نامعلوم"}</dd></div>
            <div><dt className="text-xs text-ink-2">گزارش شما (تأییدنشده)</dt><dd className="font-bold" data-testid="bs-reported">{bs.reportedToman !== null ? formatToman(bs.reportedToman) : "نامعلوم"}</dd></div>
            <div><dt className="text-xs text-ink-2">اختلاف</dt><dd className="font-bold" data-testid="bs-delta">{bs.deltaToman === null ? "—" : bs.deltaToman === 0 ? "برابر" : `${formatToman(Math.abs(bs.deltaToman))} ${bs.deltaToman > 0 ? "بیشتر" : "کمتر"} (${toFaDigits(Math.abs(bs.deltaPct ?? 0))}٪)`}</dd></div>
          </dl>
          <p className="text-sm leading-7" data-testid="bs-fit">{bs.budgetMaxToman === null ? "بودجه‌ی حداکثری ثبت نشده؛ تناسب با بودجه نامعلوم است." : bs.fitReported === "OVER" ? `با قیمت گزارش‌شده ${formatToman(bs.overByToman)} از سقف بودجه (${formatToman(bs.budgetMaxToman)}) بیشتر می‌شود.` : bs.fitReported === "WITHIN" ? `قیمت گزارش‌شده هنوز داخل سقف بودجه (${formatToman(bs.budgetMaxToman)}) است.` : "تناسب با بودجه نامعلوم است."} {bs.alternativesWithinBudget > 0 ? `${toFaDigits(bs.alternativesWithinBudget)} پیشنهاد ثبت‌شده‌ی دیگر برای همین نسخه داخل بودجه است (موجودی تأییدنشده).` : "پیشنهاد ثبت‌شده‌ی دیگری داخل بودجه پیدا نشد."}</p>
          <Link href={p.hrefs.compare} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-brand underline" data-testid="reopen-compare"><ArrowLeftRight aria-hidden size={14} />بازکردن دوباره‌ی مقایسه با همین فیلترها</Link>
        </section>
      ) : null}

      {p.nextInterval ? (
        <section className="space-y-2 rounded-xl border border-line p-3" data-testid="next-interval">
          <h3 className="flex items-center gap-1.5 text-sm font-bold"><CalendarClock aria-hidden size={14} />بازه‌ی اعلام‌شده‌ی بعدی</h3>
          <p className="text-sm leading-7">{p.nextInterval.labelFa}</p>
          <Button variant="secondary" data-testid="apply-next-interval" onClick={() => { dispatch({ type: "RECOVERY_DECISION", trigger, resolution: "TIME_CHANGED" }); dispatch({ type: "SET_VISIT", visit: p.nextInterval!.atTehran }); }}>زمان مراجعه را به این بازه ببر</Button>
        </section>
      ) : null}

      <section aria-label="فروشنده‌های جایگزین" className="space-y-2" data-testid="plan-sellers">
        <h3 className="flex items-center gap-1.5 text-sm font-bold"><Store aria-hidden size={14} />فروشگاه‌های جایگزین با پیشنهاد ثبت‌شده‌ی همین نسخه</h3>
        {p.sellers.length ? (
          <ul className="space-y-2">{p.sellers.map((s) => (
            <li key={s.shopId} className="space-y-1.5 rounded-xl border border-line p-3 text-sm" data-testid="alt-seller" data-shop-id={s.shopId} data-offer-id={s.offerId}>
              <p className="font-semibold"><bdi>{s.name}</bdi>{s.locationLabel ? <span className="font-normal text-ink-2"> · {s.locationLabel}</span> : null} <Badge tone={s.tier === "A" ? "ok" : "brand"}>سطح هویت {s.tier}</Badge></p>
              <p className="font-bold">{s.priceToman !== null ? formatToman(s.priceToman) : "قیمت قابل‌اتکا ثبت نشده"} <span className="text-xs font-normal text-ink-2">(ثبت‌شده · {s.priceNoteFa})</span></p>
              {s.distanceMeters !== null ? <p className="text-xs text-ink-2">حدود {formatDistance(s.distanceMeters)} — خط مستقیم</p> : null}
              <ul className="list-disc space-y-0.5 ps-5 text-xs leading-6 text-ink-2">{s.tradeoffsFa.map((t) => <li key={t}>{t}</li>)}</ul>
              <div className="flex flex-wrap gap-2"><Button onClick={() => choose(s.shopId, s.offerId)} data-testid="choose-alt">این فروشگاه را انتخاب می‌کنم</Button><Link href={s.hrefs.shop} className="inline-flex min-h-11 items-center text-sm text-brand underline">جزئیات فروشگاه</Link></div>
            </li>
          ))}</ul>
        ) : <p className="text-sm leading-7 text-ink-2" data-testid="no-alt-sellers">فروشگاه دیگری با پیشنهاد هم‌نسخه‌ی (احتمالاً) قابل‌اتکا در نمونه‌ی داده پیدا نشد.</p>}
        <ul className="list-disc space-y-0.5 ps-5 text-xs leading-6 text-ink-2">{p.coverageFa.map((c) => <li key={c}>{c}</li>)}</ul>
      </section>

      {p.variants.length ? (
        <section className="space-y-1.5" data-testid="plan-variants"><h3 className="flex items-center gap-1.5 text-sm font-bold"><Package aria-hidden size={14} />نسخه‌های دیگر همین محصول</h3>
          <p className="text-xs leading-6 text-ink-2">نسخه‌ی دیگر خودکار جایگزین نمی‌شود؛ برای هر نسخه به صفحه‌ی محصول برگردید و دوباره انتخاب کنید.</p>
          <ul className="space-y-1">{p.variants.map((v) => <li key={v.groupId}><Link href={v.href} className="inline-flex min-h-11 items-center text-sm text-brand underline"><bdi>{v.label}</bdi> ({toFaDigits(v.offerCount)} پیشنهاد)</Link></li>)}</ul></section>
      ) : null}

      {p.products.length ? (
        <section className="space-y-1.5" data-testid="plan-products"><h3 className="text-sm font-bold">محصولات هم‌دسته (جایگزین احتمالی)</h3>
          <ul className="space-y-1">{p.products.map((x) => <li key={x.productId}><Link href={x.href} className="block min-h-11 rounded-xl border border-line p-3 text-sm hover:bg-surface-2"><bdi className="font-semibold">{x.title}</bdi><span className="block text-xs text-ink-2">{x.priceText} · {toFaDigits(x.distinctSellers)} فروشگاه با پیشنهاد ثبت‌شده</span></Link></li>)}</ul></section>
      ) : null}

      {p.areas.length ? (
        <section className="space-y-1.5" data-testid="plan-areas"><h3 className="flex items-center gap-1.5 text-sm font-bold"><Landmark aria-hidden size={14} />مناطق خرید پیشنهادی (فروشنده یا موجودی نیست)</h3>
          <ul className="space-y-2">{p.areas.map((a) => <li key={a.areaId} className="space-y-1 rounded-xl border border-dashed border-warn-line p-3 text-sm" data-testid="plan-area" data-geo-type={a.geoType}><p className="font-semibold"><bdi>{a.nameFa}</bdi> <Badge tone="warn">فروشنده نیست</Badge></p><p className="text-xs leading-6">{a.reasonFa}</p><p className="text-xs text-ink-2">{a.confidenceFa} · {a.sourcesFa} · بررسی: {a.verifiedAt}{a.distanceMeters !== null ? ` · حدود ${formatDistance(a.distanceMeters)} (خط مستقیم)` : ""}</p><Link href={a.mapHref} className="inline-flex min-h-11 items-center text-sm text-brand underline">نمایش روی نقشه</Link></li>)}</ul></section>
      ) : null}

      <ul className="list-disc space-y-1 ps-5 text-xs leading-6 text-ink-2">{p.notesFa.map((n) => <li key={n}>{n}</li>)}</ul>
      <Button variant="ghost" data-testid="dismiss-trigger" onClick={() => dispatch({ type: "RECOVERY_DECISION", trigger, resolution: "DISMISSED" })}>با آگاهی از این خطر، با همین فروشگاه ادامه می‌دهم</Button>
    </Card>
  );
}
