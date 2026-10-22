import Link from "next/link";
import { ChevronLeft, Compass, Lock, Search, ShieldCheck, Sparkles } from "lucide-react";
import { ButtonLink, Card, Badge } from "@/components/ui";
import { Rise } from "@/components/rise";
import { SearchForm } from "@/components/search-form";
import { StageIcon } from "@/components/stage-icon";
import { QUICK_STARTS, STAGES } from "@/lib/constants";
import { toFaDigits } from "@/lib/format";

export default function HomePage() {
  return (
    <div className="space-y-12">
      <Rise>
        <section
          aria-labelledby="hero-title"
          className="grid gap-8 rounded-3xl bg-gradient-to-br from-brand-soft to-surface p-6 sm:p-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-center"
        >
          <div>
            <Badge tone="brand" className="mb-4">
              خرید حضوری در بازار تهران
            </Badge>
            <h1 id="hero-title" className="max-w-2xl text-balance text-3xl font-extrabold leading-[1.5] sm:text-4xl">
              قبل از رفتن به بازار، بدانید چه بخرید و کجا بروید
            </h1>
            <p className="mt-3 max-w-xl text-[0.98rem] leading-8 text-ink-2">
              هم‌قدم کمک می‌کند محصول مناسب را انتخاب کنید، فروشنده‌های نزدیک را مقایسه کنید و پیش از مراجعه سؤال‌های درست را بپرسید — بدون
              ادعای موجودی یا قیمتی که تأیید نشده است.
            </p>

            <div className="mt-6 max-w-2xl space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <ButtonLink href="/discover" className="min-h-14 text-base">
                  <Compass aria-hidden size={20} />
                  کمکم کن انتخاب کنم
                </ButtonLink>
                <ButtonLink href="/search" variant="secondary" className="min-h-14 text-base">
                  <Search aria-hidden size={20} />
                  مدل محصول رو می‌دونم
                </ButtonLink>
              </div>
              <p className="text-sm leading-7 text-ink-2">
                ترجیح می‌دهید گفت‌وگو کنید؟{" "}
                <Link href="/assistant" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand underline underline-offset-4" data-testid="home-assistant-link">
                  <Sparkles aria-hidden size={16} />
                  با دستیار خرید حرف بزنید
                </Link>{" "}
                — همان چهار گام، در یک گفت‌وگو.
              </p>
              <p className="text-sm text-ink-2">یا مستقیم جست‌وجو کنید:</p>
              <SearchForm id="home-q" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink-2">مثال‌ها:</span>
                {QUICK_STARTS.map((s) => (
                  <Link
                    key={s.q}
                    href={`/discover?text=${encodeURIComponent(s.q)}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink-2 hover:bg-surface-2"
                  >
                    {s.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <aside aria-labelledby="before-title" className="rounded-2xl border border-line bg-surface/80 p-5">
            <h2 id="before-title" className="mb-3 text-base font-bold">
              پیش از رفتن به مغازه
            </h2>
            <ol className="space-y-3 text-sm leading-7 text-ink-2">
              <li>
                <strong className="text-ink">موجودی را بپرسید.</strong> وجود پیشنهاد در فهرست به معنی موجود بودن کالا نیست؛ باید تأیید شود.
              </li>
              <li>
                <strong className="text-ink">نسخه‌ی دقیق را مشخص کنید.</strong> مدل، رنگ و واحد قیمت (عدد، متر، حلقه) را بنویسید.
              </li>
              <li>
                <strong className="text-ink">قیمت روز را بگیرید.</strong> قیمت‌های ثبت‌شده ممکن است قدیمی باشند.
              </li>
            </ol>
          </aside>
        </section>
      </Rise>

      <section aria-labelledby="stages-title">
        <h2 id="stages-title" className="mb-1 text-xl font-extrabold">
          چهار گام تا یک خرید مطمئن
        </h2>
        <p className="mb-5 text-sm text-ink-2">هر گام جداگانه قابل‌استفاده است و ترجیحات شما بین گام‌ها حفظ می‌شود.</p>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((s, i) => (
            <li key={s.id}>
              <Rise delay={0.05 * i} className="h-full">
                <Link href={s.href} className="block h-full">
                  <Card className="h-full transition-colors hover:border-brand">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-soft-ink">
                        <StageIcon name={s.icon} />
                      </span>
                      <span className="text-sm font-bold text-ink-2">گام {toFaDigits(i + 1)}</span>
                    </div>
                    <h3 className="mb-1 font-bold">{s.title}</h3>
                    <p className="text-sm leading-7 text-ink-2">{s.desc}</p>
                  </Card>
                </Link>
              </Rise>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="trust-title" className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 id="trust-title" className="mb-2 flex items-center gap-2 text-lg font-bold">
            <ShieldCheck aria-hidden size={20} className="text-brand" />
            ما چه چیزی را هرگز ادعا نمی‌کنیم
          </h2>
          <ul className="list-disc space-y-1.5 ps-5 text-sm leading-7 text-ink-2">
            <li>موجود بودن کالا: وجود «پیشنهاد» به معنی موجودی نیست.</li>
            <li>باز بودن فروشگاه: فقط ساعت اعلام‌شده نمایش داده می‌شود؛ نبودِ ساعت یعنی «نامشخص».</li>
            <li>امتیاز یا نقد کاربران: چنین داده‌ای در دیتاست نیست.</li>
            <li>ارسال پیام به فروشنده: هیچ پیامی خودکار فرستاده نمی‌شود.</li>
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
            <Lock aria-hidden size={20} className="text-brand" />
            حریم خصوصی موقعیت
          </h2>
          <p className="text-sm leading-7 text-ink-2">
            برای شروع کافی است محله را انتخاب کنید. مختصات دقیق شما در نشانی صفحه یا حافظه‌ی دائمی ذخیره نمی‌شود.
          </p>
          <ButtonLink href="/data" variant="ghost" className="mt-2 -ms-3">
            درباره‌ی داده‌ها و محدودیت‌ها
            <ChevronLeft aria-hidden size={16} />
          </ButtonLink>
        </Card>
      </section>
    </div>
  );
}
