import type { Metadata } from "next";
import { Database, ShieldCheck, Store, Package, Tag, AlertTriangle, Clock, CreditCard } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
import { toFaDigits } from "@/lib/format";

export const metadata: Metadata = { title: "درباره‌ی داده‌ها و محدودیت‌ها" };

const n = (v: number) => new Intl.NumberFormat("fa-IR").format(v);

const STATS = [
  { label: "محصولات ثبت‌شده", value: 225903, icon: Package },
  { label: "پیشنهادهای فروشگاهی", value: 331506, icon: Tag },
  { label: "فروشگاه‌های اطراف", value: 6476, icon: Store },
  { label: "فروشگاه با اطلاعات پرداخت", value: 266, icon: CreditCard },
];

const COUNTS: Array<[string, number]> = [
  ["فروشگاه", 6476],
  ["محصول", 225903],
  ["پیشنهاد (offer)", 331506],
  ["فروشگاه بدون هیچ پیشنهاد", 2684],
  ["پیشنهاد بدون قیمت", 15083],
  ["پیشنهاد بدون زمان تغییر قیمت", 769],
  ["جفت فروشگاه–محصول با چند پیشنهاد", 9557],
  ["فروشگاه دارای اطلاعات پرداخت", 266],
];

const RULES: Array<[string, string, typeof ShieldCheck]> = [
  ["موجودی", "در داده نیست. وجود پیشنهاد به معنی موجود بودن نیست.", AlertTriangle],
  ["قیمت", "ممکن است قدیمی یا پرت باشد؛ با سن قیمت و پرچم کیفیت نشان داده می‌شود. «بدون قیمت» هرگز صفر حساب نمی‌شود.", Tag],
  ["هویت کالا", "یک شناسه‌ی محصول می‌تواند چند نسخه و واحد قیمت (عدد، متر، حلقه) داشته باشد؛ قبل از مقایسه نسخه‌ی دقیق تأیید می‌شود.", Package],
  ["ساعت کاری", "ساعت‌های ۰۰:۰۰ تا ۰۰:۰۰ جای‌خالی‌اند، نه «۲۴ ساعته». فروشگاه بدون برنامه «نامشخص» است، نه «بسته».", Clock],
  ["پرداخت", "نبودِ اطلاعات یعنی «اعلام نشده»، نه «پشتیبانی نمی‌شود».", CreditCard],
  ["ارتباط", "نام بیشتر فروشگاه‌ها و همه‌ی شماره‌ها ساختگی‌اند؛ تماس یا پیام خودکار وجود ندارد.", ShieldCheck],
  ["پوشش جغرافیایی", "بیشتر فروشگاه‌ها اطراف فردوسی، شیخ‌هادی و بهارستان‌اند؛ پوشش کل تهران ادعا نمی‌شود.", Store],
  ["کیفیت و نقد", "امتیاز یا نقد مستقل در داده نیست؛ کیفیت فقط از مشخصات و گارانتی ثبت‌شده توضیح داده می‌شود.", Database],
];

export default function DataPage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="شفافیت و اعتماد" title="درباره‌ی داده‌ها و محدودیت‌ها">
        آنچه از ممیزی دیتاست می‌دانیم و آنچه هرگز ادعا نمی‌کنیم. داده‌ها بر اساس کاتالوگ رسمی هکاتون ترب است.
      </PageHeader>

      <section aria-label="خلاصه آمار" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATS.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-center gap-2 text-brand">
              <Icon aria-hidden size={18} />
              <span className="text-xs font-semibold text-ink-2">{label}</span>
            </div>
            <p className="mt-2 text-xl font-black text-ink">{n(value)}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
            <h2 className="flex items-center gap-2 font-bold">
              <Database aria-hidden size={18} className="text-brand" />
              شمارش‌های ممیزی داده
            </h2>
            <Badge tone="brand">ممیزی کاتالوگ</Badge>
          </div>
          <table className="w-full text-sm">
            <caption className="sr-only">شمارش‌های ممیزی دیتاست</caption>
            <tbody>
              {COUNTS.map(([k, v]) => (
                <tr key={k} className="border-b border-line last:border-0 hover:bg-surface-2 transition-colors">
                  <th scope="row" className="py-2.5 text-start font-normal text-ink-2">
                    {k}
                  </th>
                  <td className="py-2.5 text-end font-bold text-ink">{n(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs leading-6 text-ink-2">
            این اعداد از ممیزی فایل‌های کاتالوگ گرفته شده‌اند؛ کاتالوگ واقعی در پایگاه داده‌ی محلی وارد شده است. {toFaDigits(90)} فروشگاه وب‌سایت و {toFaDigits(22)} فروشگاه اینستاگرام ثبت‌شده دارند.
          </p>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
            <h2 className="flex items-center gap-2 font-bold">
              <ShieldCheck aria-hidden size={18} className="text-ok-ink" />
              قواعد اعتماد و تعهد به کاربر
            </h2>
            <Badge tone="ok">اصول صداقت</Badge>
          </div>
          <dl className="grid gap-3.5 text-sm">
            {RULES.map(([k, v, Icon]) => (
              <div key={k} className="rounded-xl border border-line bg-surface-2/60 p-3">
                <dt className="flex items-center gap-1.5 font-bold text-ink">
                  <Icon aria-hidden size={15} className="text-brand shrink-0" />
                  {k}
                </dt>
                <dd className="mt-1 leading-7 text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
