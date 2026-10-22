"use client";

import { useMemo, useState } from "react";
import { PlusCircle } from "lucide-react";
import type { InquiryContext, ModelReport, PaymentReport, ReplyEvidence, ReportedUnit, StockReport, WarrantyReport } from "@/domain/inquiry";
import { interpretAmount, LIMITS, sanitizeText, suggestFromText } from "@/domain/inquiry-parse";
import { Button, Card, inputStyles } from "@/components/ui";
import { formatToman, toFaDigits } from "@/lib/format";
import { cn } from "@/lib/cn";

function Radios<T extends string>({ name, label, value, onChange, options }: { name: string; label: string; value: T; onChange: (v: T) => void; options: ReadonlyArray<[T, string]> }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-semibold">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map(([v, t]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} data-testid={`${name}-${v}`} onClick={() => onChange(v)}
            className={cn("min-h-11 rounded-full border px-3.5 text-sm font-medium", value === v ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2")}>{t}</button>
        ))}
      </div>
    </fieldset>
  );
}

const rid = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * User-confirmed interpretation of a seller reply. Pasted text only PRE-FILLS suggestions; nothing becomes stock/price until the user
 * confirms the structured fields. The result is labelled USER_REPORTED (never verified).
 */
export function ReplyForm({ ctx, onSubmit }: { ctx: InquiryContext; onSubmit: (r: ReplyEvidence) => void }) {
  const [text, setText] = useState("");
  const [adv, setAdv] = useState(false); // optional detail fields: one tap away on phones, always shown on large screens
  const [stock, setStock] = useState<StockReport>("unknown");
  const [model, setModel] = useState<ModelReport>("not_asked");
  const [priceText, setPriceText] = useState("");
  const [unitChoice, setUnitChoice] = useState<"toman" | "rial" | null>(null);
  const [rUnit, setRUnit] = useState<ReportedUnit>("same");
  const [warranty, setWarranty] = useState<WarrantyReport>("not_asked");
  const [months, setMonths] = useState("");
  const [payment, setPayment] = useState<PaymentReport>("not_asked");
  const [visitNote, setVisitNote] = useState("");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);

  const amount = useMemo(() => (priceText.trim() ? interpretAmount(priceText, ctx.offer.priceToman, unitChoice) : null), [priceText, ctx.offer.priceToman, unitChoice]);
  const sug = useMemo(() => suggestFromText(text), [text]);
  const hasSuggestion = !!(sug.stock || sug.modelDifferent || sug.amountText);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amount && amount.kind === "ambiguous") return setError("واحد مبلغ روشن نیست: «تومان» یا «ریال» را انتخاب کنید.");
    if (amount && amount.kind === "invalid") return setError("مبلغ معتبر نیست؛ آن را بدون اشتباه (مثلاً «۴٬۲۰۰٬۰۰۰ تومان») بنویسید یا خالی بگذارید.");
    const m = months.trim() ? Number(toFaToLatin(months)) : null;
    if (warranty === "declared" && m !== null && (!Number.isInteger(m) || m < 1 || m > 240)) return setError("مدت گارانتی را به ماه و به‌صورت عدد صحیح بنویسید.");
    const reportedPriceToman = amount && amount.kind === "ok" ? amount.toman : null;
    if (!sanitizeText(text, 5) && stock === "unknown" && reportedPriceToman === null && model === "not_asked" && warranty === "not_asked" && payment === "not_asked" && !visitNote.trim()) return setError("دست‌کم یک مورد از پاسخ فروشنده را وارد کنید.");
    onSubmit({
      id: rid(), provenance: "USER_REPORTED", rawText: sanitizeText(text, LIMITS.reply), stock, reportedPriceToman, reportedUnit: rUnit, model,
      warranty: { report: warranty, months: warranty === "declared" ? m : null }, payment, visitNote: sanitizeText(visitNote, LIMITS.visitNote),
      receivedLabel: when.trim() ? sanitizeText(when, 60) : null, scenarioId: null,
    });
    setText(""); setStock("unknown"); setModel("not_asked"); setPriceText(""); setUnitChoice(null); setRUnit("same"); setWarranty("not_asked"); setMonths(""); setPayment("not_asked"); setVisitNote(""); setWhen("");
  };

  return (
    <Card className="space-y-4" aria-labelledby="reply-h">
      <h2 id="reply-h" className="font-bold">ثبت پاسخ فروشنده (بعد از پرسیدن مستقل خودتان)</h2>
      <p className="text-sm leading-7 text-ink-2">پاسخ را خودتان از فروشنده گرفته‌اید؛ این‌جا فقط یادداشت می‌شود و <strong>مستقلاً تأیید نمی‌شود</strong>. متن چسبانده‌شده خودکار تفسیر نمی‌شود: پیشنهادها را خودتان تأیید کنید.</p>
      <form onSubmit={submit} className="space-y-4" aria-label="فرم ثبت پاسخ">
        <div className="space-y-1.5">
          <label htmlFor="reply-text" className="text-sm font-semibold">متن پاسخ (اختیاری)</label>
          <textarea id="reply-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={LIMITS.reply} rows={3} className={cn(inputStyles, "min-h-24 py-2 leading-7")} />
          <p className="text-xs text-ink-2">{toFaDigits(text.length)} / {toFaDigits(LIMITS.reply)} — فقط به‌صورت متن ساده نمایش داده می‌شود.</p>
        </div>
        {hasSuggestion ? (
          <div className="space-y-1.5 rounded-xl bg-surface-2 p-3" data-testid="suggestions" aria-label="پیشنهادهای تفسیر (تأییدنشده)">
            <p className="text-xs font-semibold text-ink-2">پیشنهاد از روی متن (فقط با کلیک شما اعمال می‌شود):</p>
            <div className="flex flex-wrap gap-2">
              {sug.stock ? <button type="button" className="min-h-11 rounded-full border border-dashed border-brand px-3 text-sm" onClick={() => setStock(sug.stock!)}>{sug.stock === "yes" ? "موجود است" : "موجود نیست"}؟ اعمال</button> : null}
              {sug.modelDifferent ? <button type="button" className="min-h-11 rounded-full border border-dashed border-brand px-3 text-sm" onClick={() => setModel("different")}>مدل دیگری گفته؟ اعمال</button> : null}
              {sug.amountText ? <button type="button" className="min-h-11 rounded-full border border-dashed border-brand px-3 text-sm" onClick={() => setPriceText(sug.amountText!)}>مبلغ: {sug.amountText} — اعمال</button> : null}
            </div>
          </div>
        ) : null}

        <Radios name="stock" label="موجودی طبق گفته‌ی فروشنده" value={stock} onChange={setStock} options={[["yes", "گفت موجود است"], ["no", "گفت موجود نیست"], ["unknown", "نامعلوم / نگفت"]]} />
        <div className="space-y-1.5">
          <label htmlFor="reply-price" className="text-sm font-semibold">قیمت امروزی که فروشنده گفت (اختیاری)</label>
          <input id="reply-price" value={priceText} onChange={(e) => { setPriceText(e.target.value); setUnitChoice(null); }} inputMode="text" placeholder="مثلاً ۴٬۲۰۰٬۰۰۰ تومان" className={cn(inputStyles, "max-w-xs")} />
          {amount ? (
            <div className="space-y-1.5 text-sm" role="status" data-testid="amount-status">
              {amount.kind === "ok" ? <p>خوانده شد: <strong>{formatToman(amount.toman)}</strong>{amount.assumed ? " — واحد «تومان» فرض شد؛ اگر درست نیست اصلاح کنید" : ""}.</p> : null}
              {amount.kind === "invalid" ? <p className="text-danger-ink">مبلغ قابل‌خواندن یا معتبر نیست.</p> : null}
              {amount.kind === "ambiguous" ? (
                <div className="space-y-1.5">
                  <p className="text-warn-ink">این عدد تومان است یا ریال؟ حدس نمی‌زنیم. {amount.hintFa ?? ""}</p>
                  <div className="flex gap-2" role="radiogroup" aria-label="واحد مبلغ">
                    {(["toman", "rial"] as const).map((u) => <button key={u} type="button" role="radio" aria-checked={unitChoice === u} data-testid={`unit-${u}`} onClick={() => setUnitChoice(u)} className={cn("min-h-11 rounded-full border px-4 text-sm font-medium", unitChoice === u ? "border-brand bg-brand-soft" : "border-line")}>{u === "toman" ? "تومان" : "ریال"}</button>)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <Radios name="model" label="مدل / نسخه" value={model} onChange={setModel} options={[["same", "همین مدل را تأیید کرد"], ["different", "مدل متفاوتی گفت"], ["unsure", "مطمئن نیست"], ["not_asked", "نپرسیدم"]]} />
        <button type="button" className="min-h-11 text-start text-sm font-semibold text-brand underline lg:hidden" aria-expanded={adv} aria-controls="reply-advanced" onClick={() => setAdv((v) => !v)} data-testid="reply-adv-toggle">{adv ? "بستن جزئیات اختیاری" : "جزئیات اختیاری (واحد قیمت، گارانتی، پرداخت، شرط مراجعه)"}</button>
        <div id="reply-advanced" className={cn("space-y-4", !adv && "max-lg:hidden")}>
        <Radios name="runit" label="واحد قیمت‌ی که گفت" value={rUnit} onChange={setRUnit} options={[["same", "همان واحد پیشنهاد"], ["per_metre", "هر متر"], ["roll_or_pack", "حلقه / بسته"], ["unknown", "نپرسیدم"]]} />
        <Radios name="warranty" label="گارانتی" value={warranty} onChange={setWarranty} options={[["declared", "گارانتی دارد"], ["none", "گارانتی ندارد"], ["not_asked", "نپرسیدم"]]} />
        {warranty === "declared" ? (
          <div className="space-y-1"><label htmlFor="reply-months" className="text-sm font-semibold">مدت گارانتی (ماه، اختیاری)</label><input id="reply-months" value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" className={cn(inputStyles, "max-w-[8rem]")} /></div>
        ) : null}
        <Radios name="payment" label="پرداخت حضوری/اقساط برای همین کالا" value={payment} onChange={setPayment} options={[["in_person_ok", "ممکن است"], ["not_available", "ممکن نیست"], ["not_asked", "نپرسیدم"]]} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><label htmlFor="reply-visit" className="text-sm font-semibold">شرط/زمان مراجعه که گفت (اختیاری)</label><input id="reply-visit" value={visitNote} onChange={(e) => setVisitNote(e.target.value)} maxLength={LIMITS.visitNote} className={inputStyles} /></div>
          <div className="space-y-1"><label htmlFor="reply-when" className="text-sm font-semibold">زمان دریافت پاسخ (اختیاری، متن آزاد)</label><input id="reply-when" value={when} onChange={(e) => setWhen(e.target.value)} maxLength={60} placeholder="مثلاً امروز ۱۰:۳۰" className={inputStyles} /></div>
        </div>
        </div>
        {error ? <p role="alert" className="text-sm font-semibold text-danger-ink" data-testid="reply-error">{error}</p> : null}
        <Button type="submit" data-testid="reply-submit"><PlusCircle aria-hidden size={18} />ثبت پاسخ (گزارش شما)</Button>
      </form>
    </Card>
  );
}

const toFaToLatin = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
