"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Info, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { buildQuestionDraft, MANUAL_RESPONSE_LABEL, QUESTION_INTENTS, unresolvedIntents } from "@/domain/seller-questions";
import type { QuestionIntent } from "@/domain/types";
import { toFaDigits } from "@/lib/format";
import { Badge, Button, Card, Chip, inputStyles } from "./ui";

interface ManualResponse {
  id: number;
  intent: QuestionIntent;
  text: string;
}

const labelOf = (id: QuestionIntent) => QUESTION_INTENTS.find((q) => q.id === id)?.label ?? id;

/**
 * Seller Q&A workspace — LOCAL ONLY.
 *  - nothing is ever sent to a seller (no network call exists in this component);
 *  - the dataset has no verified contact channel, so the safe default is always shown;
 *  - recorded responses are user-typed and labelled as unverified.
 */
export function SellerQa() {
  const [product, setProduct] = useState("");
  const [variant, setVariant] = useState("");
  const [intents, setIntents] = useState<QuestionIntent[]>(["stock_availability", "fresh_price"]);
  const [copy, setCopy] = useState<"idle" | "ok" | "fail">("idle");
  const [responses, setResponses] = useState<ManualResponse[]>([]);
  const [respIntent, setRespIntent] = useState<QuestionIntent | null>(null);
  const [respText, setRespText] = useState("");
  const [nextId, setNextId] = useState(1);

  const draft = useMemo(
    () =>
      product.trim() && intents.length ? buildQuestionDraft({ productTitle: product, variantNote: variant, intents, channels: [] }) : null,
    [product, variant, intents],
  );
  const unresolved = draft ? unresolvedIntents(draft.intents, responses) : [];
  const activeIntent = respIntent && draft?.intents.includes(respIntent) ? respIntent : (draft?.intents[0] ?? null);

  const toggle = (id: QuestionIntent) => {
    setCopy("idle");
    setIntents((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopy("ok");
    } catch {
      setCopy("fail");
    }
  };

  const addResponse = () => {
    if (!activeIntent || !respText.trim()) return;
    setResponses((r) => [...r, { id: nextId, intent: activeIntent, text: respText.trim() }]);
    setNextId((n) => n + 1);
    setRespText("");
  };

  const status = !draft
    ? "در حال آماده‌سازی پرسش‌ها"
    : unresolved.length > 0
      ? `در انتظار ثبت پاسخ — ${toFaDigits(unresolved.length)} پرسش بی‌پاسخ`
      : "برای همه‌ی پرسش‌ها پاسخ ثبت‌شده (خوداظهاری شما)";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card className="space-y-5">
          <h2 className="text-lg font-bold">۱. پرسش‌ها را انتخاب کنید</h2>
          <div className="space-y-2">
            <label htmlFor="qa-product" className="block text-sm font-semibold">
              نام یا مدل کالا
            </label>
            <input
              id="qa-product"
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setCopy("idle");
              }}
              maxLength={120}
              placeholder="مثلاً: دوربین داهوا DH-HAC-HDW1200CLQP"
              className={inputStyles}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="qa-variant" className="block text-sm font-semibold">
              جزئیات نسخه <span className="font-normal text-ink-2">(اختیاری: رنگ، ظرفیت، واحد قیمت…)</span>
            </label>
            <input id="qa-variant" value={variant} onChange={(e) => setVariant(e.target.value)} maxLength={200} className={inputStyles} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">می‌خواهید چه چیزی را بپرسید؟</legend>
            <div className="flex flex-wrap gap-2">
              {QUESTION_INTENTS.map((q) => (
                <Chip key={q.id} selected={intents.includes(q.id)} onClick={() => toggle(q.id)}>
                  {q.label}
                </Chip>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-bold">۲. پیش‌نویس پیام</h2>
          {draft ? (
            <>
              <label htmlFor="qa-draft" className="sr-only">
                پیش‌نویس پیام
              </label>
              <textarea id="qa-draft" readOnly rows={8} value={draft.text} className={`${inputStyles} min-h-40 py-3 leading-8 [field-sizing:content]`} />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={copyDraft}>
                  <Copy aria-hidden size={18} />
                  کپی متن
                </Button>
                <p role="status" aria-live="polite" className="text-sm text-ink-2">
                  {copy === "ok" ? (
                    <>
                      <Check aria-hidden size={14} className="me-1 inline text-ok-ink" />
                      متن کپی شد. ارسال آن کاملاً با خودتان است؛ هیچ پیامی از این برنامه فرستاده نمی‌شود.
                    </>
                  ) : null}
                  {copy === "fail" ? "کپی خودکار انجام نشد؛ متن را دستی انتخاب و کپی کنید." : null}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-2">نام کالا را بنویسید و دست‌کم یک موضوع را انتخاب کنید تا پیش‌نویس ساخته شود.</p>
          )}

          <div role="note" className="flex gap-2 rounded-xl bg-warn-bg p-3 text-sm leading-7 text-warn-ink">
            <Info aria-hidden size={18} className="mt-1 shrink-0" />
            <div>
              <strong>راه ارتباطی تأییدشده در داده‌ها موجود نیست</strong>
              <p>
                شماره‌های دیتاست ساختگی‌اند و استفاده نمی‌شوند. اگر خودتان راه معتبری برای ارتباط دارید متن را کپی کنید، یا همین پرسش‌ها را
                هنگام مراجعه‌ی حضوری بپرسید.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">۳. پاسخ فروشنده را ثبت کنید</h2>
            <Badge tone="neutral">فقط در همین صفحه نگه‌داری می‌شود</Badge>
          </div>
          {draft ? (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">پاسخ مربوط به کدام پرسش است؟</legend>
                <div className="flex flex-wrap gap-2">
                  {draft.intents.map((i) => (
                    <Chip key={i} selected={activeIntent === i} onClick={() => setRespIntent(i)}>
                      {labelOf(i)}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-2">
                <label htmlFor="qa-resp" className="block text-sm font-semibold">
                  پاسخی که شنیدید یا خواندید
                </label>
                <textarea
                  id="qa-resp"
                  rows={3}
                  value={respText}
                  maxLength={400}
                  onChange={(e) => setRespText(e.target.value)}
                  className={`${inputStyles} py-2`}
                />
              </div>
              <Button onClick={addResponse} disabled={!respText.trim() || !activeIntent} variant="secondary">
                ثبت پاسخ
              </Button>
            </>
          ) : (
            <p className="text-sm text-ink-2">ابتدا پیش‌نویس را بسازید؛ سپس می‌توانید پاسخ‌ها را این‌جا ثبت کنید.</p>
          )}
        </Card>

        <Card className="space-y-3" aria-live="polite">
          <h2 className="text-lg font-bold">وضعیت ماموریت</h2>
          <p className="text-sm font-semibold text-brand">{status}</p>
          {responses.length > 0 ? (
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {responses.map((r) => (
                  <motion.li
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden rounded-xl border border-line p-3 text-sm"
                  >
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold">{labelOf(r.intent)}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone="warn">{MANUAL_RESPONSE_LABEL}</Badge>
                        <button
                          type="button"
                          aria-label={`حذف پاسخ ${labelOf(r.intent)}`}
                          onClick={() => setResponses((rs) => rs.filter((x) => x.id !== r.id))}
                          className="grid size-11 place-items-center rounded-lg text-ink-2 hover:bg-surface-2"
                        >
                          <Trash2 aria-hidden size={16} />
                        </button>
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap leading-7 text-ink-2">{r.text}</p>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          ) : (
            <p className="text-sm text-ink-2">هنوز پاسخی ثبت نشده است.</p>
          )}
          {draft && unresolved.length > 0 ? (
            <p className="text-sm text-ink-2">
              پرسش‌های بی‌پاسخ: <strong>{unresolved.map(labelOf).join("، ")}</strong>
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
