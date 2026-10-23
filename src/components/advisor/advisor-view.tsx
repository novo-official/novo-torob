"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronLeft, Compass, Info, Pencil, Search, SkipForward, Sparkles, TriangleAlert } from "lucide-react";
import type { AdvisorResponse, Candidate } from "@/domain/advisor";
import { Badge, Button, Card, Chip, EmptyState, inputStyles } from "@/components/ui";
import { ProductCardView } from "@/components/catalog/product-card";
import { buildAdvisorHref, paramsFromIntent, type AdvisorParams } from "@/lib/advisor-url";
import { formatNumberFa, formatToman, parseBudget, toFaDigits } from "@/lib/format";
import styles from "./advisor.module.css";

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
    <div aria-busy={pending} className={`${styles.advisorContainer} ${pending ? "opacity-70 transition-opacity" : "transition-opacity"}`}>
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
    <div className={styles.progressCard}>
      <div className={styles.progressTop}>
        {response.stage !== "need" ? (
          <Button variant="ghost" onClick={onBack} className="-ms-3 px-3">
            <ArrowRight aria-hidden size={18} />
            مرحله‌ی قبل
          </Button>
        ) : <span />}
        <p className={styles.stepIndicator}>{results ? "پیشنهادها" : `گام ${toFaDigits(current)} از ${toFaDigits(total)}`}</p>
      </div>
      <div role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={results ? total : current} aria-label="پیشرفت مشاور" className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${(100 * (results ? total : current)) / total}%` }} />
      </div>
      {response.category ? (
        <div className={styles.categoryActiveRow}>
          <Badge tone="brand">دسته: {response.category.label}</Badge>
          {response.category.autoSelected ? <span className="text-xs text-ink-2">(از توضیح شما تشخیص داده شد)</span> : null}
          {!response.category.supported ? <Badge tone="warn">پرسش‌های تخصصی این دسته تعریف نشده</Badge> : null}
          <Link href="/discover" className={styles.changeCategoryLink}>
            تغییر دسته
          </Link>
        </div>
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
    <div className="space-y-6">
      <div className={styles.needCard}>
        <div className="space-y-1.5">
          <h2 className={styles.needTitle}>چه چیزی لازم دارید؟</h2>
          <p className={styles.needDescription}>نیازتان را کوتاه بنویسید؛ لازم نیست نام یا مدل دقیق را بدانید.</p>
        </div>
        <form
          className={styles.needForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) go(buildAdvisorHref({ text: text.trim() }));
          }}
        >
          <label htmlFor="need-text" className="sr-only">شرح نیاز خرید</label>
          <div className={styles.needInputGroup}>
            <input
              id="need-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              placeholder="مثلاً: هدفون بی‌سیم برای ورزش، یا دوربین مداربسته"
              className={styles.needInput}
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!text.trim()} className="gap-2">
              <Sparkles aria-hidden size={16} />
              ادامه
            </Button>
          </div>
        </form>
        {response.recovery ? <p role="status" className="rounded-xl bg-warn-bg p-3.5 text-sm leading-7 text-warn-ink border border-warn-line">{response.recovery.message}</p> : null}
      </div>

      <section aria-labelledby="cats-title" className={styles.categorySection}>
        <div className={styles.sectionHeader}>
          <h2 id="cats-title" className={styles.sectionTitle}>یا از یک دسته شروع کنید</h2>
          <p className={styles.sectionSubtitle}>این دسته‌ها پرسش‌های تخصصی دارند و ویژگی‌هایشان در کاتالوگ سنجیده می‌شود.</p>
        </div>
        <ul className={styles.categoryGrid}>
          {response.categoryChoices.map((c) => (
            <li key={c.category}>
              <button
                type="button"
                onClick={() => go(buildAdvisorHref({ category: c.category }))}
                className={styles.categoryBtn}
              >
                <span className={styles.categoryLabel}>{c.label}</span>
                <span className={styles.categoryCount}>{toFaDigits(c.productCount)} محصول</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-2 pt-1">
          دسته‌ی دیگری مدنظر دارید؟ با «جست‌وجوی مدل» پیدایش کنید.{" "}
          <Link href="/search" className="text-brand font-semibold underline underline-offset-2">رفتن به جست‌وجو</Link>
        </p>
      </section>

      {resume ? (
        <div className={styles.resumeCard}>
          <div className="space-y-1">
            <p className="font-semibold text-sm">مشاوره‌ی قبلی شما ذخیره شده است.</p>
            <p className="text-xs text-ink-2">می‌توانید از همان‌جا ادامه دهید یا با نیاز جدید شروع کنید.</p>
          </div>
          <Button variant="secondary" onClick={() => go(resume)}>ادامه از همان‌جا</Button>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ step: clarify category
function ClarifyStep({ response, params, go }: { response: AdvisorResponse; params: AdvisorParams; go: (h: string) => void }) {
  return (
    <div className={styles.questionCard}>
      <div className={styles.questionHeader}>
        <h2 className={styles.questionTitle}>منظورتان کدام دسته است؟</h2>
        <p className={styles.questionHelp}>«{params.text}» به چند دسته می‌خورد. دسته‌ی درست را انتخاب کنید؛ بقیه‌ی توضیح شما حفظ می‌شود.</p>
      </div>
      <ul className={styles.categoryGrid}>
        {response.categoryChoices.map((c) => (
          <li key={c.category}>
            <button
              type="button"
              onClick={() => go(buildAdvisorHref({ ...params, category: c.category }))}
              className={styles.categoryBtn}
            >
              <div className="flex flex-col gap-1">
                <span className={styles.categoryLabel}>{c.label}</span>
                {c.supported ? <Badge tone="brand">مشاور تخصصی</Badge> : null}
              </div>
              <span className={styles.categoryCount}>{toFaDigits(c.productCount)} محصول</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="pt-2">
        <Link href={`/search?q=${encodeURIComponent(params.text)}`} className="inline-block text-sm font-semibold text-brand underline underline-offset-2">به‌جای آن، مستقیم جست‌وجو کنید</Link>
      </div>
    </div>
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
    <div className={styles.questionCard} aria-labelledby="q-title">
      <div className={styles.questionHeader}>
        <h2 id="q-title" className={styles.questionTitle}>{q.text}</h2>
        {q.help ? <p className={styles.questionHelp}>{q.help}</p> : null}
        <p className={styles.questionNature}>{q.hardness === "hard" ? "این پاسخ محصولاتی را که صریحاً نمی‌خوانند کنار می‌گذارد." : "این پاسخ فقط ترتیب پیشنهادها را تغییر می‌دهد."}</p>
      </div>
      {q.kind === "budget" ? <BudgetInput bands={response.budgetBands} base={base} go={go} /> : (
        <div role="radiogroup" aria-labelledby="q-title" className={styles.optionsGroup}>
          {q.options.map((o) => {
            const isSelected = base().answers[q.id] === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => go(answerHref(o.id))}
                className={`${styles.optionCard} ${isSelected ? styles.optionCardActive : ""}`}
              >
                <span className={styles.optionLabel}>{o.label}</span>
                {o.evidenceCount !== undefined && o.id !== "any" ? (
                  <span className={styles.optionEvidence}>{toFaDigits(o.evidenceCount)} محصول با شاهد</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      <div className={styles.questionActions}>
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
    </div>
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
    <div className={styles.budgetWrapper}>
      <div role="group" aria-label="بازه‌های پیشنهادی" className={styles.budgetBands}>
        {bands.map((band) => (
          <button
            key={band.id}
            type="button"
            onClick={() => apply(band.min, band.max)}
            className={styles.bandButton}
          >
            <span className={styles.bandLabel}>{band.label}</span>
            <span className={styles.bandCount}>{toFaDigits(band.count)} محصول با قیمت قابل اتکا</span>
          </button>
        ))}
        {bands.length === 0 ? <p className="text-sm text-ink-2">برای این دسته قیمت قابل اتکای کافی برای ساخت بازه‌ی پیشنهادی نیست؛ عدد دلخواه بنویسید یا رد کنید.</p> : null}
      </div>
      <fieldset className={styles.customBudgetFieldset}>
        <legend className={styles.customBudgetLegend}>یا عدد دلخواه (تومان)</legend>
        <div className={styles.budgetInputsRow}>
          <div>
            <label htmlFor="b-min" className="mb-1 block text-xs font-medium text-ink-2">از</label>
            <input id="b-min" inputMode="numeric" autoComplete="off" value={min} onChange={(e) => setMin(e.target.value)} onBlur={() => lo && setMin(formatNumberFa(lo))} placeholder="۱٬۰۰۰٬۰۰۰" className={inputStyles} />
          </div>
          <div>
            <label htmlFor="b-max" className="mb-1 block text-xs font-medium text-ink-2">تا</label>
            <input id="b-max" inputMode="numeric" autoComplete="off" value={max} onChange={(e) => setMax(e.target.value)} onBlur={() => hi && setMax(formatNumberFa(hi))} placeholder="۵٬۰۰۰٬۰۰۰" className={inputStyles} />
          </div>
        </div>
        {bad ? <p role="alert" className="text-sm text-danger-ink">مبلغ را فقط با عدد وارد کنید (مثلاً ۵٬۰۰۰٬۰۰۰).</p> : null}
        {inverted ? <p role="alert" className="text-sm text-danger-ink">حداقل بودجه از حداکثر بیشتر است.</p> : null}
        <div>
          <Button onClick={() => apply(lo, hi)} disabled={!!bad || inverted || (lo === null && hi === null)}>
            <Check aria-hidden size={16} />
            اعمال بودجه
          </Button>
        </div>
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
    <div className="space-y-6">
      <div className={styles.preferencesCard}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={styles.preferencesTitle}>ترجیحات شما <span className={styles.preferencesSubtitle}>(با زدن هر مورد تغییرش دهید)</span></h2>
        </div>
        <ul className={styles.preferencesList}>
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
          <p className={styles.funnelText} aria-live="polite">
            از {toFaDigits(f.inCategory)} محصول این دسته، {toFaDigits(f.afterHardFilters)} مورد با شرط‌های شما می‌خواند
            {f.outOfBudget ? ` (${toFaDigits(f.outOfBudget)} مورد خارج از بودجه)` : ""}
            {f.budgetUnverified ? ` · ${toFaDigits(f.budgetUnverified)} مورد قیمت قابل اتکا ندارد و بودجه‌اش قابل بررسی نیست` : ""}.
          </p>
        ) : null}
      </div>

      {response.recovery ? <RecoveryPanel response={response} base={base} go={go} /> : null}

      {response.candidates.length === 0 ? (
        <EmptyState icon={<Compass size={22} />} title="محصولی با این ترکیب پیدا نشد">
          <p>یکی از پیشنهادهای بالا را امتحان کنید، یا شرط‌ها را از چیپ‌های ترجیحات تغییر دهید.</p>
        </EmptyState>
      ) : (
        <ol className={styles.resultsList} aria-label="محصولات پیشنهادی">
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

      <details className="rounded-2xl border border-line bg-surface p-4 text-sm shadow-[var(--shadow-card)]">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
          <Info aria-hidden size={16} className="text-brand" />
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
    <details className={styles.candidateExplain}>
      <summary className={styles.candidateSummary}>
        چرا پیشنهاد شد؟ <span className={styles.scoreBadge}>(امتیاز مطابقت {toFaDigits(Math.round(c.score))})</span>
      </summary>
      <ul className={styles.reasonsList}>
        {shown.map((r, i) => (
          <li key={`${r.code}-${i}`} className={styles.reasonItem}>
            <span className={r.effect === "match" ? "text-ok-ink font-bold" : r.effect === "mismatch" ? "text-danger-ink font-bold" : "text-ink-2"}>
              {r.effect === "match" ? "✓ " : r.effect === "mismatch" ? "✗ " : r.effect === "unknown" ? "؟ " : "• "}
            </span>
            <span>{r.text}</span>
            {r.evidence.length ? (
              <span className={styles.reasonEvidence}>
                شاهد{r.evidence[0]!.confidence === "inferred" ? " (استنباطی)" : ""}: {r.evidence.map((e) => `${e.label}: ${e.text}`).join(" ؛ ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {c.cautions.length ? (
        <div className={styles.cautionsBox}>
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
    <div role="status" className={styles.recoveryNotice}>
      <p className={styles.recoveryTitle}>{r.message}</p>
      <ul className={styles.recoverySuggestions}>
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
          <Link href={`/search?q=${encodeURIComponent(response.category?.label ?? "")}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2 transition-colors">
            <Search aria-hidden size={14} />
            جست‌وجوی دستی در این دسته
          </Link>
        </li>
      </ul>
    </div>
  );
}
