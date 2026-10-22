import Link from "next/link";
import { ArrowLeft, ArrowLeftRight, ClipboardCheck, FileSearch, Repeat2, Search } from "lucide-react";
import { PROVENANCE_FA, STATUS_FA, type InquiryOutcome, type NextAction, type NextActionId, type OutcomeFlag } from "@/domain/inquiry";
import { ProvenanceBadge } from "@/components/inquiry/provenance-badge";
import { Card } from "@/components/ui";
import { formatToman, toFaDigits } from "@/lib/format";
import { cn } from "@/lib/cn";

const FLAG_FA: Record<OutcomeFlag, string> = {
  STOCK_REPORTED_YES: "گزارش: موجود", STOCK_REPORTED_NO: "گزارش: ناموجود", PRICE_HIGHER: "قیمت گزارش‌شده بالاتر از قیمت ثبت‌شده", PRICE_LOWER: "قیمت گزارش‌شده پایین‌تر از قیمت ثبت‌شده",
  PRICE_SAME: "قیمت گزارش‌شده با قیمت ثبت‌شده برابر است", PRICE_NOT_COMPARABLE: "قیمتی برای مقایسه ثبت نشده", MODEL_DIFFERENT: "مدل متفاوت", MODEL_UNSURE: "مدل نامطمئن", UNIT_DIFFERENT: "واحد قیمت متفاوت",
  WARRANTY_MISMATCH: "گارانتی با داده نمی‌خواند", PAYMENT_NOT_AVAILABLE: "پرداخت حضوری اعلام‌شده ممکن نیست", VISIT_OUTSIDE_DECLARED_HOURS: "زمان بازدید خارج از ساعت اعلام‌شده", VISIT_HOURS_UNKNOWN: "ساعت کاری برای زمان بازدید نامعلوم",
};
const ICON: Record<NextActionId, typeof Search> = { FIND_OTHER_SELLER: Search, ALTERNATIVE_PRODUCT: FileSearch, COMPARE_AGAIN: ArrowLeftRight, RECONFIRM_BEFORE_VISIT: ClipboardCheck, CLARIFY_VARIANT: FileSearch, FOLLOW_UP: Repeat2, CHECK_VISIT_HOURS: Repeat2, AWAIT_REPLY: ArrowLeft };

export function DecisionPanel({ outcome, onAction, selected }: { outcome: InquiryOutcome; onAction: (a: NextAction) => void; selected: NextActionId | null }) {
  const demo = outcome.mode === "DEMO";
  const d = outcome.priceDelta;
  return (
    <Card className={cn("space-y-4", demo && "border-dashed border-warn-line bg-warn-bg/40")} aria-labelledby="decision-h" data-testid="decision-panel" data-mode={outcome.mode}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="decision-h" className="font-bold">{demo ? "نتیجه‌ی شبیه‌سازی (فقط دمو)" : "جمع‌بندی و گام بعد"}</h2>
        <ProvenanceBadge kind={outcome.provenance} />
      </div>
      <div className="space-y-1" role="status" aria-live="polite">
        <p className="text-lg font-bold" data-testid="outcome-headline">{outcome.headlineFa}</p>
        <p className="text-sm leading-7" data-testid="outcome-claim">{outcome.claimFa}</p>
        <p className="text-xs text-ink-2">وضعیت: {STATUS_FA[outcome.status]}</p>
      </div>
      {d ? (
        <div className="grid gap-2 rounded-xl border border-line bg-surface p-3 text-sm sm:grid-cols-3" data-testid="price-compare" aria-label="مقایسه‌ی قیمت گزارش‌شده با قیمت ثبت‌شده">
          <p><span className="block text-xs text-ink-2">ثبت‌شده در داده</span><strong>{formatToman(d.recordedToman)}</strong></p>
          <p><span className="block text-xs text-ink-2">{demo ? "قیمت نمونه (شبیه‌سازی)" : "گزارش شما از فروشنده"}</span><strong>{formatToman(d.reportedToman)}</strong></p>
          <p><span className="block text-xs text-ink-2">اختلاف</span><strong data-testid="price-delta">{d.direction === "same" ? "برابر" : `${formatToman(Math.abs(d.deltaToman))} ${d.direction === "higher" ? "بیشتر" : "کمتر"} (${toFaDigits(String(Math.abs(d.pct)).replace(".", "٫"))}٪)`}</strong></p>
          <p className="text-xs leading-6 text-ink-2 sm:col-span-3">قیمت ثبت‌شده‌ی دیتاست تغییر نمی‌کند و گزارش شما در رتبه‌بندی رسمی اثری ندارد.</p>
        </div>
      ) : null}
      {outcome.flags.length ? <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="نشانه‌ها">{outcome.flags.map((f) => <li key={f} className="rounded-full bg-surface-2 px-2.5 py-1">{FLAG_FA[f]}</li>)}</ul> : null}
      {outcome.blocksExactConfirmation ? <p role="alert" data-testid="blocked" className="rounded-xl bg-danger-bg p-3 text-sm font-semibold leading-7 text-danger-ink">تأیید «همین کالا» مسدود است تا مدل و واحد دقیق روشن شود.</p> : null}
      <div className="space-y-2" aria-label="گام‌های بعد">
        <h3 className="text-sm font-bold">گام بعد</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {outcome.nextActions.map((a) => {
            const Icon = ICON[a.id];
            const cls = cn("flex min-h-11 w-full items-start gap-2 rounded-xl border p-3 text-start text-sm", a.primary ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface hover:bg-surface-2", selected === a.id && "ring-2 ring-brand");
            const body = <><Icon aria-hidden size={16} className="mt-1 shrink-0" /><span><span className="block font-semibold">{a.labelFa}</span><span className="block text-xs leading-6 text-ink-2">{a.descriptionFa}</span></span></>;
            return (
              <li key={a.id}>
                {a.href ? <Link href={a.href} onClick={() => onAction(a)} data-testid={`next-${a.id}`} className={cls}>{body}</Link> : <button type="button" onClick={() => onAction(a)} data-testid={`next-${a.id}`} className={cls}>{body}</button>}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-xs leading-6 text-ink-2">{PROVENANCE_FA[outcome.provenance].help}</p>
    </Card>
  );
}
