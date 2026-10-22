"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronLeft, Compass, Info, Pencil, Search, SkipForward, TriangleAlert } from "lucide-react";
import type { AdvisorResponse, Candidate } from "@/domain/advisor";
import { Badge, Button, Card, Chip, EmptyState, inputStyles } from "@/components/ui";
import { ProductCardView } from "@/components/catalog/product-card";
import { buildAdvisorHref, paramsFromIntent, type AdvisorParams } from "@/lib/advisor-url";
import { formatNumberFa, formatToman, parseBudget, toFaDigits } from "@/lib/format";

const LAST_KEY = "hamghadam.advisor.last.v1";

export function AdvisorView({ response, params }: { response: AdvisorResponse; params: AdvisorParams }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (href: string) => start(() => router.push(href));
  const replace = (href: string) => start(() => router.replace(href));
  const base = (): AdvisorParams => ({ ...paramsFromIntent(response.intent), show: params.show, ask: null, offset: 0 });

  // remember the last non-sensitive advisor state so a later visit can offer to continue
  useEffect(() => {
    if (response.stage !== "need" && response.category) {
      try { localStorage.setItem(LAST_KEY, window.location.pathname + window.location.search); } catch { /* storage blocked */ }
    }
  }, [response.stage, response.category]);

  return (
    <div aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
      <ProgressHeader response={response} onBack={() => (window.history.length > 1 ? router.back() : go("/discover"))} />
      {response.stage === "need" ? <NeedStep response={response} params={params} go={go} /> : null}
      {response.stage === "clarify_category" ? <ClarifyStep response={response} params={params} go={go} /> : null}
      {response.stage === "question" && response.question ? <QuestionStep response={response} base={base} go={go} /> : null}
      {response.stage === "results" ? <ResultsStep response={response} params={params} base={base} go={go} replace={replace} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ progress
function ProgressHeader({ response, onBack }: { response: AdvisorResponse; onBack: () => void }) {
  const { current, total } = response.progress;
  const results = response.stage === "results";
  return (
    <div className="mb-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        {response.stage !== "need" ? (
          <Button variant="ghost" onClick={onBack} className="-ms-3 px-3">
            <ArrowRight aria-hidden size={18} />
            مرحله‌ی قبل
          </Button>
        ) : <span />}
        <p className="text-sm text-ink-2">{results ? "پیشنهادها" : `گام ${toFaDigits(current)} از ${toFaDigits(total)}`}</p>
      </div>
      <div role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={results ? total : current} aria-label="پیشرفت مشاور" className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${(100 * (results ? total : current)) / total}%` }} />
      </div>
      {response.category ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="brand">دسته: {response.category.label}</Badge>
          {response.category.autoSelected ? <span className="text-ink-2">(از توضیح شما تشخیص داده شد)</span> : null}
          {!response.category.supported ? <Badge tone="warn">پرسش‌های تخصصی این دسته تعریف نشده</Badge> : null}
          <Link href="/discover" className="inline-flex min-h-11 items-center text-brand underline underline-offset-2">
            تغییر دسته
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ step: need
function NeedStep({ response, params, go }: { response: AdvisorResponse; params: AdvisorParams; go: (h: string) => void }) {
  const [text, setText] = useState(params.text);
  const stored = useSyncExternalStore(
    () => () => {},
    () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } },
    () => null,
  );
  const resume = stored && /^\/discover\?/.test(stored) ? stored : null;
  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <h2 className="text-lg font-bold">چه چیزی لازم دارید؟</h2>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) go(buildAdvisorHref({ text: text.trim() }));
          }}
        >
          <label htmlFor="need-text" className="block text-sm text-ink-2">نیازتان را کوتاه بنویسید؛ لازم نیست مدل را بدانید.</label>
          <input id="need-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="مثلاً: هدفون بی‌سیم برای ورزش" className={inputStyles} autoComplete="off" />
          <Button type="submit" disabled={!text.trim()}>ادامه</Button>
        </form>
        {response.recovery ? <p role="status" className="rounded-xl bg-warn-bg p-3 text-sm leading-7 text-warn-ink">{response.recovery.message}</p> : null}
      </Card>

      <section aria-labelledby="cats-title" className="space-y-3">
        <h2 id="cats-title" className="font-bold">یا از یک دسته شروع کنید</h2>
        <p className="text-sm text-ink-2">این دسته‌ها پرسش‌های تخصصی دارند و ویژگی‌هایشان در داده سنجیده می‌شود.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {response.categoryChoices.map((c) => (
            <li key={c.category}>
              <button type="button" onClick={() => go(buildAdvisorHref({ category: c.category }))} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-start hover:border-brand">
                <span className="font-semibold">{c.label}</span>
                <span className="text-xs text-ink-2">{toFaDigits(c.productCount)} محصول</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-2">
          دسته‌ی دیگری مدنظر دارید؟ با «جست‌وجوی مدل» پیدایش کنید.{" "}
          <Link href="/search" className="text-brand underline underline-offset-2">رفتن به جست‌وجو</Link>
        </p>
      </section>

      {resume ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">مشاوره‌ی قبلی شما ذخیره شده است.</p>
          <Button variant="secondary" onClick={() => go(resume)}>ادامه از همان‌جا</Button>
        </Card>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ step: clarify category
function ClarifyStep({ response, params, go }: { response: AdvisorResponse; params: AdvisorParams; go: (h: string) => void }) {
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-bold">منظورتان کدام دسته است؟</h2>
      <p className="text-sm text-ink-2">«{params.text}» به چند دسته می‌خورد. دسته‌ی درست را انتخاب کنید؛ بقیه‌ی توضیح شما حفظ می‌شود.</p>
      <ul className="space-y-2">
        {response.categoryChoices.map((c) => (
          <li key={c.category}>
            <button type="button" onClick={() => go(buildAdvisorHref({ ...params, category: c.category }))} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-start hover:border-brand">
              <span>
                <span className="font-semibold">{c.label}</span>
                {c.supported ? <Badge tone="brand" className="ms-2">مشاور تخصصی</Badge> : null}
              </span>
              <span className="text-xs text-ink-2">{toFaDigits(c.productCount)} محصول</span>
            </button>
          </li>
        ))}
      </ul>
      <Link href={`/search?q=${encodeURIComponent(params.text)}`} className="inline-block text-sm text-brand underline underline-offset-2">به‌جای آن، مستقیم جست‌وجو کنید</Link>
    </Card>
  );
}

// ------------------------------------------------------------------ step: question
function QuestionStep({ response, base, go }: { response: AdvisorResponse; base: () => AdvisorParams; go: (h: string) => void }) {
  const q = response.question!;
  const results = response.progress.current === response.progress.total && base().show;
  const answerHref = (optionId: string): string => {
    const b = base();
    return buildAdvisorHref({ ...b, answers: { ...b.answers, [q.id]: optionId }, skipped: b.skipped.filter((s) => s !== q.id) });
  };
  const skipHref = (): string => {
    const b = base();
    const { [q.id]: _drop, ...rest } = b.answers;
    void _drop;
    return buildAdvisorHref({ ...b, answers: rest, skipped: [...new Set([...b.skipped, q.id])] });
  };
  return (
    <Card className="space-y-5" aria-labelledby="q-title">
      <div>
        <h2 id="q-title" className="text-lg font-bold">{q.text}</h2>
        {q.help ? <p className="mt-1 text-sm leading-7 text-ink-2">{q.help}</p> : null}
        <p className="mt-2 text-xs text-ink-2">{q.hardness === "hard" ? "این پاسخ محصولاتی را که صریحاً نمی‌خوانند کنار می‌گذارد." : "این پاسخ فقط ترتیب پیشنهادها را تغییر می‌دهد."}</p>
      </div>
      {q.kind === "budget" ? <BudgetInput bands={response.budgetBands} base={base} go={go} /> : (
        <div role="radiogroup" aria-labelledby="q-title" className="grid gap-2">
          {q.options.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={base().answers[q.id] === o.id} onClick={() => go(answerHref(o.id))} className={`flex min-h-12 items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-start ${base().answers[q.id] === o.id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand"}`}>
              <span className="font-medium">{o.label}</span>
              {o.evidenceCount !== undefined && o.id !== "any" ? <span className="shrink-0 text-xs text-ink-2">{toFaDigits(o.evidenceCount)} محصول با شاهد</span> : null}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Button variant="secondary" onClick={() => go(skipHref())}>
          <SkipForward aria-hidden size={16} />
          مطمئن نیستم / رد کردن
        </Button>
        {!results ? (
          <Button variant="ghost" onClick={() => go(buildAdvisorHref({ ...base(), show: true }))}>
            همین حالا نتایج را نشان بده
            <ChevronLeft aria-hidden size={16} />
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function BudgetInput({ bands, base, go }: { bands: AdvisorResponse["budgetBands"]; base: () => AdvisorParams; go: (h: string) => void }) {
  const b0 = base();
  const [min, setMin] = useState(b0.bmin ? formatNumberFa(b0.bmin) : "");
  const [max, setMax] = useState(b0.bmax ? formatNumberFa(b0.bmax) : "");
  const bad = (min.trim() && parseBudget(min) === null) || (max.trim() && parseBudget(max) === null);
  const lo = parseBudget(min);
  const hi = parseBudget(max);
  const inverted = lo !== null && hi !== null && lo > hi;
  const apply = (bmin: number | null, bmax: number | null) => go(buildAdvisorHref({ ...base(), bmin, bmax, skipped: base().skipped.filter((s) => s !== "budget") }));
  return (
    <div className="space-y-4">
      <div role="group" aria-label="بازه‌های پیشنهادی" className="grid gap-2">
        {bands.map((band) => (
          <button key={band.id} type="button" onClick={() => apply(band.min, band.max)} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-start hover:border-brand">
            <span className="font-medium">{band.label}</span>
            <span className="text-xs text-ink-2">{toFaDigits(band.count)} محصول با قیمت قابل اتکا</span>
          </button>
        ))}
        {bands.length === 0 ? <p className="text-sm text-ink-2">برای این دسته قیمت قابل اتکای کافی برای ساخت بازه‌ی پیشنهادی نیست؛ عدد دلخواه بنویسید یا رد کنید.</p> : null}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">یا عدد دلخواه (تومان)</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="b-min" className="mb-1 block text-xs text-ink-2">از</label>
            <input id="b-min" inputMode="numeric" autoComplete="off" value={min} onChange={(e) => setMin(e.target.value)} onBlur={() => lo && setMin(formatNumberFa(lo))} placeholder="۱٬۰۰۰٬۰۰۰" className={inputStyles} />
          </div>
          <div>
            <label htmlFor="b-max" className="mb-1 block text-xs text-ink-2">تا</label>
            <input id="b-max" inputMode="numeric" autoComplete="off" value={max} onChange={(e) => setMax(e.target.value)} onBlur={() => hi && setMax(formatNumberFa(hi))} placeholder="۵٬۰۰۰٬۰۰۰" className={inputStyles} />
          </div>
        </div>
        {bad ? <p role="alert" className="text-sm text-danger-ink">مبلغ را فقط با عدد وارد کنید (مثلاً ۵٬۰۰۰٬۰۰۰).</p> : null}
        {inverted ? <p role="alert" className="text-sm text-danger-ink">حداقل بودجه از حداکثر بیشتر است.</p> : null}
        <Button onClick={() => apply(lo, hi)} disabled={!!bad || inverted || (lo === null && hi === null)}>
          <Check aria-hidden size={16} />
          اعمال بودجه
        </Button>
      </fieldset>
    </div>
  );
}

// ------------------------------------------------------------------ results
function ResultsStep({ response, params, base, go, replace }: { response: AdvisorResponse; params: AdvisorParams; base: () => AdvisorParams; go: (h: string) => void; replace: (h: string) => void }) {
  const b = response.intent.budget;
  const f = response.funnel;
  const withContext = (c: Candidate) => {
    const sp = new URLSearchParams({ from: buildAdvisorHref({ ...base(), show: true }) });
    if (b.min) sp.set("bmin", String(b.min));
    if (b.max) sp.set("bmax", String(b.max));
    return `/products/${c.card.id}?${sp.toString()}`;
  };
  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">ترجیحات شما <span className="text-sm font-normal text-ink-2">(با زدن هر مورد تغییرش دهید)</span></h2>
        <ul className="flex flex-wrap gap-2">
          {response.answered.map((a) => (
            <li key={a.questionId}>
              <Chip onClick={() => go(buildAdvisorHref({ ...base(), show: true, ask: a.questionId }))} aria-label={`${a.optionLabel} ${a.hardness === "hard" ? "شرط" : "ترجیح"} — تغییر پاسخ: ${a.questionText}`}>
                <Pencil aria-hidden size={13} />
                {a.optionLabel}
                <span className="text-xs text-ink-2">{a.hardness === "hard" ? "شرط" : "ترجیح"}</span>
              </Chip>
            </li>
          ))}
          <li>
            <Chip onClick={() => go(buildAdvisorHref({ ...base(), show: true, ask: "budget" }))} aria-label="تغییر بودجه">
              <Pencil aria-hidden size={13} />
              {b.min || b.max ? `بودجه: ${b.min ? formatToman(b.min)?.replace(" تومان", "") : ""}${b.min && b.max ? " تا " : b.max ? "تا " : "از "}${b.max ? formatToman(b.max) : ""}` : "بودجه: مشخص نشده"}
            </Chip>
          </li>
          {response.intent.text ? <li><Badge>توضیح: {response.intent.text}</Badge></li> : null}
        </ul>
        {f ? (
          <p className="text-sm text-ink-2" aria-live="polite">
            از {toFaDigits(f.inCategory)} محصول این دسته، {toFaDigits(f.afterHardFilters)} مورد با شرط‌های شما می‌خواند
            {f.outOfBudget ? ` (${toFaDigits(f.outOfBudget)} مورد خارج از بودجه)` : ""}
            {f.budgetUnverified ? ` · ${toFaDigits(f.budgetUnverified)} مورد قیمت قابل اتکا ندارد و بودجه‌اش قابل بررسی نیست` : ""}.
          </p>
        ) : null}
      </Card>

      {response.recovery ? <RecoveryPanel response={response} base={base} go={go} /> : null}

      {response.candidates.length === 0 ? (
        <EmptyState icon={<Compass size={22} />} title="محصولی با این ترکیب پیدا نشد">
          <p>یکی از پیشنهادهای بالا را امتحان کنید، یا شرط‌ها را از چیپ‌های ترجیحات تغییر دهید.</p>
        </EmptyState>
      ) : (
        <ol className="space-y-4" aria-label="محصولات پیشنهادی">
          {response.candidates.map((c) => (
            <li key={c.card.id}>
              <ProductCardView card={c.card} href={withContext(c)} badge={<><Badge tone="brand">#{toFaDigits(c.rank)}</Badge>{c.budget === "in_budget" ? <Badge tone="ok">قیمت تأییدشده در بودجه</Badge> : c.budget === "unverified" ? <Badge tone="warn">بودجه قابل بررسی نیست</Badge> : null}</>}>
                <CandidateExplain c={c} />
              </ProductCardView>
            </li>
          ))}
        </ol>
      )}

      {response.hasMore ? <Button variant="secondary" onClick={() => go(buildAdvisorHref({ ...base(), show: true, offset: (params.offset || 0) + response.candidates.length }))} className="w-full">نمایش بیشتر</Button> : null}

      {response.refinement.length ? (
        <Card className="space-y-4">
          <h2 className="font-bold">برای دقیق‌تر شدن پیشنهادها (اختیاری)</h2>
          {response.refinement.map((q) => (
            <div key={q.id} className="space-y-2">
              <p className="text-sm font-semibold">{q.text}</p>
              <div className="flex flex-wrap gap-2">
                {q.options.filter((o) => o.id !== "any").map((o) => (
                  <Chip key={o.id} onClick={() => replace(buildAdvisorHref({ ...base(), show: true, answers: { ...base().answers, [q.id]: o.id } }))}>
                    {o.label}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      <details className="rounded-2xl border border-line bg-surface p-4 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
          <Info aria-hidden size={16} />
          محدودیت‌ها و منشأ داده
        </summary>
        <ul className="mt-2 list-disc space-y-1.5 ps-5 leading-7 text-ink-2">
          {response.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </details>
    </div>
  );
}

function CandidateExplain({ c }: { c: Candidate }) {
  const shown = c.reasons.filter((r) => r.code !== "SPEC_COVERAGE" || true);
  return (
    <details className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">چرا پیشنهاد شد؟ <span className="ms-2 text-xs font-normal text-ink-2">(امتیاز مطابقت {toFaDigits(Math.round(c.score))})</span></summary>
      <ul className="mt-2 space-y-2">
        {shown.map((r, i) => (
          <li key={`${r.code}-${i}`} className="leading-7">
            <span className={r.effect === "match" ? "text-ok-ink" : r.effect === "mismatch" ? "text-danger-ink" : "text-ink-2"}>
              {r.effect === "match" ? "✓ " : r.effect === "mismatch" ? "✗ " : r.effect === "unknown" ? "؟ " : "• "}
            </span>
            {r.text}
            {r.evidence.length ? (
              <span className="block text-xs text-ink-2">
                شاهد{r.evidence[0]!.confidence === "inferred" ? " (استنباطی)" : ""}: {r.evidence.map((e) => `${e.label}: ${e.text}`).join(" ؛ ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {c.cautions.length ? (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 flex items-center gap-1 font-semibold text-warn-ink"><TriangleAlert aria-hidden size={14} />پیش از اعتماد بررسی کنید</p>
          <ul className="list-disc space-y-1 ps-5 text-xs leading-6 text-ink-2">{c.cautions.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null}
    </details>
  );
}

function RecoveryPanel({ response, base, go }: { response: AdvisorResponse; base: () => AdvisorParams; go: (h: string) => void }) {
  const r = response.recovery!;
  return (
    <div role="status" className="space-y-3 rounded-2xl border border-warn-line bg-warn-bg p-4 text-warn-ink">
      <p className="font-semibold">{r.message}</p>
      <ul className="flex flex-wrap gap-2">
        {r.suggestions.map((s) => (
          <li key={s.id}>
            <Button variant="secondary" className="text-start" onClick={() => {
              const b = base();
              const answers = { ...b.answers };
              if (s.patch.dropAnswer) delete answers[s.patch.dropAnswer];
              go(buildAdvisorHref({ ...b, answers, show: true, bmin: s.patch.budget ? s.patch.budget.min : b.bmin, bmax: s.patch.budget ? s.patch.budget.max : b.bmax }));
            }}>{s.label}</Button>
          </li>
        ))}
        <li>
          <Link href={`/search?q=${encodeURIComponent(response.category?.label ?? "")}`} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink">
            <Search aria-hidden size={14} />
            جست‌وجوی دستی در این دسته
          </Link>
        </li>
      </ul>
    </div>
  );
}
