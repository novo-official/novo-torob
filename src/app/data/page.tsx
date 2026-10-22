import type { Metadata } from "next";
import { Badge, Card, PageHeader } from "@/components/ui";
import { toFaDigits } from "@/lib/format";

export const metadata: Metadata = { title: "درباره‌ی داده‌ها و محدودیت‌ها" };

const n = (v: number) => new Intl.NumberFormat("fa-IR").format(v);

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

const RULES: Array<[string, string]> = [
  ["موجودی", "در داده نیست. وجود پیشنهاد به معنی موجود بودن نیست."],
  ["قیمت", "ممکن است قدیمی یا پرت باشد؛ با سن قیمت و پرچم کیفیت نشان داده می‌شود. «بدون قیمت» هرگز صفر حساب نمی‌شود."],
  ["هویت کالا", "یک شناسه‌ی محصول می‌تواند چند نسخه و واحد قیمت (عدد، متر، حلقه) داشته باشد؛ قبل از مقایسه نسخه‌ی دقیق تأیید می‌شود."],
  ["ساعت کاری", "ساعت‌های ۰۰:۰۰ تا ۰۰:۰۰ جای‌خالی‌اند، نه «۲۴ ساعته». فروشگاه بدون برنامه «نامشخص» است، نه «بسته»."],
  ["پرداخت", "نبودِ اطلاعات یعنی «اعلام نشده»، نه «پشتیبانی نمی‌شود»."],
  ["ارتباط", "نام بیشتر فروشگاه‌ها و همه‌ی شماره‌ها ساختگی‌اند؛ تماس یا پیام خودکار وجود ندارد."],
  ["پوشش", "بیشتر فروشگاه‌ها اطراف فردوسی، شیخ‌هادی و بهارستان‌اند؛ پوشش کل تهران ادعا نمی‌شود."],
  ["کیفیت", "امتیاز یا نقد مستقل در داده نیست؛ کیفیت فقط از مشخصات و گارانتی ثبت‌شده توضیح داده می‌شود."],
];

export default function DataPage() {
  return (
    <>
      <PageHeader eyebrow="شفافیت" title="درباره‌ی داده‌ها و محدودیت‌ها">
        آنچه از ممیزی دیتاست می‌دانیم و آنچه هرگز ادعا نمی‌کنیم.
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-bold">شمارش‌های ممیزی</h2>
            <Badge tone="brand">ممیزی فاز ۰</Badge>
          </div>
          <table className="w-full text-sm">
            <caption className="sr-only">شمارش‌های ممیزی دیتاست</caption>
            <tbody>
              {COUNTS.map(([k, v]) => (
                <tr key={k} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 text-start font-normal text-ink-2">
                    {k}
                  </th>
                  <td className="py-2 text-end font-semibold">{n(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs leading-6 text-ink-2">
            این اعداد از ممیزی فایل‌های CSV گرفته شده‌اند؛ کاتالوگ واقعی از فاز ۲ در پایگاه داده‌ی محلی وارد شده است. {toFaDigits(90)} فروشگاه وب‌سایت و {toFaDigits(22)} فروشگاه اینستاگرام ثبت‌شده دارند.
          </p>
        </Card>

        <Card>
          <h2 className="mb-3 font-bold">قواعد اعتماد</h2>
          <dl className="space-y-3 text-sm">
            {RULES.map(([k, v]) => (
              <div key={k}>
                <dt className="font-semibold">{k}</dt>
                <dd className="leading-7 text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
