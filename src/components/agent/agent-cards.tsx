"use client";

import Link from "next/link";
import { Bot, Database, ExternalLink, FlaskConical, HelpCircle, Info, Landmark, MessageSquareText, Scale, Store, TriangleAlert, UserRound } from "lucide-react";
import { BADGE_FA, GEO_TYPE_FA, type AgentCard, type AgentControl, type EvidenceBadgeKind } from "@/domain/agent";
import { Badge, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toFaDigits } from "@/lib/format";
import { safeExternalHref, safeInternalHref } from "@/lib/safe-href";

const ICON: Record<EvidenceBadgeKind, typeof Database> = { OFFICIAL_DATASET: Database, EXTERNAL_FACT: ExternalLink, EXTERNAL_OPINION: MessageSquareText, USER_REPORTED: UserRound, DEMO_SIMULATION: FlaskConical, SYSTEM_ESTIMATE: Bot, UNKNOWN: HelpCircle };
const TONE: Record<EvidenceBadgeKind, string> = {
  OFFICIAL_DATASET: "bg-surface-2 text-ink-2 border-line", EXTERNAL_FACT: "bg-brand-soft text-brand-soft-ink border-brand/40", EXTERNAL_OPINION: "bg-surface text-ink border-brand/40 border-dashed",
  USER_REPORTED: "bg-brand-soft text-brand-soft-ink border-brand/40", DEMO_SIMULATION: "bg-warn-bg text-warn-ink border-warn-line border-dashed", SYSTEM_ESTIMATE: "bg-surface-2 text-ink-2 border-line border-dashed", UNKNOWN: "bg-surface text-ink-2 border-line border-dashed",
};

/** Never colour-only: icon + explicit Persian label + title help + data attribute. */
export function BadgeChip({ kind }: { kind: EvidenceBadgeKind }) {
  const Icon = ICON[kind];
  return <span data-badge={kind} title={BADGE_FA[kind].help} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", TONE[kind])}><Icon aria-hidden size={12} />{BADGE_FA[kind].label}</span>;
}

const linkCls = "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold text-brand hover:bg-brand-soft";
const btnCls = "inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-brand-ink hover:bg-brand-hover disabled:opacity-60";
function L({ href, children, testid }: { href: string | null | undefined; children: React.ReactNode; testid?: string }) {
  const h = safeInternalHref(href);
  return h ? <Link href={h} className={linkCls} data-testid={testid}>{children}</Link> : null;
}

export interface CardHandlers { onControl: (c: AgentControl) => void; picked: string[]; onPick: (shopId: string) => void; busy: boolean }

export function CardView({ card, h }: { card: AgentCard; h: CardHandlers }) {
  switch (card.type) {
    case "product":
      return (
        <Card className={cn("space-y-2", card.selected && "ring-2 ring-brand")} data-testid="agent-product" data-product-id={card.productId}>
          <div className="flex flex-wrap items-center gap-1.5">{card.rank ? <Badge tone="brand">رتبه‌ی {toFaDigits(card.rank)}</Badge> : null}{card.badges.map((b) => <BadgeChip key={b} kind={b} />)}</div>
          <h3 className="font-bold leading-7"><bdi>{card.title}</bdi></h3>
          <p className="text-sm"><strong>{card.priceText}</strong> <span className="text-xs text-ink-2">· {toFaDigits(card.distinctSellers)} فروشنده با پیشنهاد ثبت‌شده (نه موجودی)</span></p>
          {card.reasons.length ? <ul className="list-disc space-y-0.5 ps-5 text-xs leading-6 text-ink-2">{card.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
          {card.cautions.length ? <ul className="space-y-0.5 text-xs leading-6 text-warn-ink">{card.cautions.map((r) => <li key={r} className="flex gap-1"><TriangleAlert aria-hidden size={12} className="mt-1 shrink-0" />{r}</li>)}</ul> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnCls} disabled={h.busy} data-testid="agent-select-product" onClick={() => h.onControl({ type: "select_product", productId: card.productId, variantGroupId: null })}><Store aria-hidden size={14} />انتخاب و دیدن فروشنده‌ها</button>
            <L href={card.hrefs.product}>جزئیات محصول</L>
          </div>
        </Card>
      );
    case "seller": {
      const picked = h.picked.includes(card.shopId);
      return (
        <Card className="space-y-2" data-testid="agent-seller" data-shop-id={card.shopId}>
          <div className="flex flex-wrap items-center gap-1.5"><BadgeChip kind="OFFICIAL_DATASET" /><Badge tone={card.variantStatus === "PLAUSIBLE" ? "ok" : "warn"}>{card.variantStatus === "PLAUSIBLE" ? "احتمالاً همین نسخه" : card.variantStatus === "UNCERTAIN" ? "نسخه‌ی نامطمئن" : card.variantStatus === "CONFLICTING" ? "نسخه‌ی متفاوت" : "نسخه انتخاب نشده"}</Badge></div>
          <p className="text-xs text-ink-2">{GEO_TYPE_FA[card.geoType]}</p>
          <h3 className="flex items-center gap-1.5 font-bold"><Store aria-hidden size={16} className="text-brand" /><bdi>{card.name}</bdi>{card.locationLabel ? <span className="text-sm font-normal text-ink-2"> · {card.locationLabel}</span> : null}</h3>
          <p className="text-sm">{card.priceText} · {card.hoursText}{card.distanceText ? ` · ${card.distanceText}` : ""}</p>
          <div className="flex flex-wrap gap-2">
            {card.geoType === "MATCHED_OFFER_SELLER" ? <button type="button" aria-pressed={picked} data-testid="agent-pick-seller" onClick={() => h.onPick(card.shopId)} className={cn(linkCls, picked && "border-brand bg-brand-soft")}>{picked ? "✓ در مقایسه" : "افزودن به مقایسه"}</button> : null}
            {card.offerId ? <button type="button" className={linkCls} disabled={h.busy} data-testid="agent-ask-seller" onClick={() => h.onControl({ type: "select_offer", shopId: card.shopId, offerId: card.offerId! })}>پیش‌نویس پرسش</button> : null}
            <L href={card.hrefs.shop}>جزئیات فروشگاه</L>
          </div>
        </Card>
      );
    }
    case "comparison":
      return (
        <Card className="space-y-3" data-testid="agent-comparison" data-verdict={card.verdictKind}>
          <div className="flex flex-wrap items-center gap-1.5">{card.badges.map((b) => <BadgeChip key={b} kind={b} />)}</div>
          <h3 className="flex items-start gap-2 font-bold leading-7"><Scale aria-hidden size={18} className="mt-1 shrink-0 text-brand" />{card.headline}</h3>
          <p className="text-sm leading-7 text-ink-2">{card.detail}</p>
          <ul className="space-y-2">
            {card.rows.map((r) => (
              <li key={r.shopId} className="rounded-xl border border-line p-2.5 text-sm" data-testid="agent-compare-row" data-tier={r.tier}>
                <p className="font-semibold"><bdi>{r.name}</bdi> <Badge tone={r.rank ? "brand" : "warn"}>{r.rank ? `رتبه‌ی ${toFaDigits(r.rank)}` : "بدون رتبه"}</Badge> <Badge tone={r.tier === "A" ? "ok" : r.tier === "B" ? "brand" : "danger"}>سطح هویت {r.tier}</Badge></p>
                <p className="text-xs leading-6 text-ink-2">{r.priceText} · {r.hoursText}</p>
                <p className="text-xs leading-6">{r.summary}</p>
                {r.offerId ? <button type="button" className="min-h-11 text-xs text-brand underline" disabled={h.busy} onClick={() => h.onControl({ type: "select_offer", shopId: r.shopId, offerId: r.offerId! })}>پیش‌نویس پرسش برای این فروشگاه</button> : null}
              </li>
            ))}
          </ul>
          <L href={card.hrefs.compare} testid="agent-open-compare">جدول کامل مقایسه</L>
        </Card>
      );
    case "area":
      return (
        <Card className="space-y-2 border-warn-line" data-testid="agent-area" data-geo-type={card.geoType}>
          <div className="flex flex-wrap items-center gap-1.5">{card.badges.map((b) => <BadgeChip key={b} kind={b} />)}<Badge tone="warn">فروشنده نیست</Badge></div>
          <h3 className="flex items-center gap-2 font-bold"><Landmark aria-hidden size={18} className="text-warn-ink" /><bdi>{card.name}</bdi></h3>
          <p className="text-xs text-ink-2">{GEO_TYPE_FA[card.geoType]}</p>
          <p className="text-sm leading-7">{card.reason}</p>
          <p className="text-xs leading-6 text-ink-2">{card.confidenceText} · {card.sourcesText} · بررسی: {card.verifiedAt}{card.distanceText ? ` · ${card.distanceText}` : ""}</p>
          <L href={card.hrefs.map}>نمایش روی نقشه</L>
        </Card>
      );
    case "evidence":
      return (
        <Card className="space-y-3" data-testid="agent-evidence" data-status={card.status} data-mode={card.mode}>
          <div className="flex flex-wrap items-center gap-1.5">{card.badges.map((b) => <BadgeChip key={b} kind={b} />)}{card.mode === "fixture" ? <Badge tone="warn">نمونه‌ی آزمایشی — منبع واقعی نیست</Badge> : null}</div>
          <h3 className="font-bold">مشخصات و نظر بیرونی</h3>
          {card.items.length === 0 ? <p className="text-sm leading-7 text-ink-2" data-testid="evidence-none">{card.notes[0] ?? "شاهد بیرونی‌ای موجود نیست."}</p> : null}
          {card.items.map((it) => (
            <article key={it.id} className="space-y-1.5 rounded-xl border border-line p-3 text-sm" data-testid="evidence-item" data-kind={it.kind} data-fixture={it.fixture ? "1" : "0"}>
              <p className="flex flex-wrap items-center gap-1.5"><BadgeChip kind={it.badge} />{it.linkOnly ? <Badge tone="neutral">فقط پیوند — متن بازتولید نمی‌شود</Badge> : null}<span className="text-xs text-ink-2">{it.kind === "SPEC_CLAIM" ? "ادعای مشخصات" : it.kind === "EXPERT_REVIEW" ? "بررسی کارشناسی" : "خلاصه‌ی نظر کاربران"}</span></p>
              <p className="text-xs leading-6 text-ink-2">منبع: <bdi>{it.sourceName}</bdi> ({it.sourceHost}) · بازیابی: {it.retrievedAt}{it.publishedAt ? ` · انتشار: ${it.publishedAt}` : ""} · {it.matchText}</p>
              <p className="leading-7">{it.summary}</p>
              {it.quotes?.length ? (
                <ul className="space-y-1.5" aria-label="گزیده‌های عینی از منبع" data-testid="evidence-quotes">
                  {it.quotes.map((q, i) => <li key={i} className="rounded-lg border-s-4 border-line bg-surface-2 p-2 text-xs leading-6" dir="ltr" lang="en"><q>{q.text}</q>{q.field ? <span className="block text-[11px] text-ink-2" dir="rtl" lang="fa">{q.field}</span> : null}</li>)}
                </ul>
              ) : null}
              {it.attribution ? <p className="text-[11px] leading-5 text-ink-2" data-testid="evidence-attribution">{it.attribution}</p> : null}
              {it.strengths.length ? <p className="text-xs leading-6"><strong>قوت‌ها (طبق منبع):</strong> {it.strengths.join("؛ ")}</p> : null}
              {it.weaknesses.length ? <p className="text-xs leading-6"><strong>ضعف‌ها (طبق منبع):</strong> {it.weaknesses.join("؛ ")}</p> : null}
              {it.limitations.length ? <ul className="list-disc space-y-0.5 ps-5 text-xs leading-6 text-warn-ink">{it.limitations.map((x) => <li key={x}>{x}</li>)}</ul> : null}
              {safeExternalHref(it.url) ? <a href={safeExternalHref(it.url)!} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-1 text-xs text-brand underline" dir="ltr">{it.sourceHost}<ExternalLink aria-hidden size={12} /></a> : null}
            </article>
          ))}
          {card.conflicts.map((c) => <p key={c} role="note" className="flex gap-2 rounded-xl bg-warn-bg p-3 text-xs leading-6 text-warn-ink" data-testid="evidence-conflict"><Info aria-hidden size={14} className="mt-1 shrink-0" />{c}</p>)}
          <p className="text-xs leading-6 text-ink-2">هیچ امتیاز ستاره‌ای، شمار نظر یا محبوبیتی نمایش داده نمی‌شود، چون در منابع بازیابی‌شده وجود ندارد یا قابل‌اتکا نیست.</p>
        </Card>
      );
    case "inquiry":
      return (
        <Card className="space-y-2" data-testid="agent-inquiry">
          <div className="flex flex-wrap items-center gap-1.5">{card.badges.map((b) => <BadgeChip key={b} kind={b} />)}<Badge tone="warn">ارسال نشده</Badge></div>
          <h3 className="font-bold">پیش‌نویس پرسش (فقط متن)</h3>
          <pre className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm leading-7" dir="rtl">{card.draft}</pre>
          <p className="text-xs leading-6 text-warn-ink">{card.notSentText}</p>
          <L href={card.hrefs.workspace} testid="agent-open-workspace">باز کردن فضای پرسش (کپی و ثبت پاسخ)</L>
          <L href={card.hrefs.mission} testid="agent-start-mission">ساخت ماموریت مراجعه (موقت)</L>
        </Card>
      );
    case "outcome":
      return (
        <Card className="space-y-2" data-testid="agent-outcome">
          <div className="flex flex-wrap items-center gap-1.5">{card.badges.map((b) => <BadgeChip key={b} kind={b} />)}</div>
          <h3 className="font-bold">{card.headline}</h3>
          <p className="text-sm leading-7">{card.claim}</p>
          <p className="text-xs leading-6 text-warn-ink">{card.provenance === "USER_REPORTED" ? "گزارش شما — تأییدنشده؛ در رتبه‌بندی رسمی و داده‌ی ترب اثری ندارد." : "بدون گزارش؛ وضعیت نامعلوم است."}</p>
          <div className="flex flex-wrap gap-2">{card.nextActions.map((a) => <L key={a.label} href={a.href}>{a.label}</L>)}</div>
        </Card>
      );
    case "notice":
      return <p role={card.tone === "error" ? "alert" : "status"} data-testid="agent-notice" className={cn("flex gap-2 rounded-xl p-3 text-sm leading-7", card.tone === "error" ? "bg-danger-bg text-danger-ink" : card.tone === "warn" ? "bg-warn-bg text-warn-ink" : "bg-surface-2")}><Info aria-hidden size={16} className="mt-1 shrink-0" />{card.text}</p>;
  }
}
