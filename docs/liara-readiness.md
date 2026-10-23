# آمادگی استقرار روی Liara (Pack 1.5) — فقط قالب و مستندات؛ **هیچ استقرار، ثبت‌نام، دیسک یا آپلودی انجام نشده**

وضعیت: `NOT DEPLOYED` · `DOCKER RUNTIME NOT VERIFIED` · BoxAPI قفل (`LIVE_MODEL_CALLS_ENABLED_IN_CODE=false`).

## ۱. منابع رسمی (خوانده‌شده فقط‌خواندنی، ۲۰۲۶‑۱۰‑۲۳)
| موضوع | منبع | نکتهٔ مؤثر |
|---|---|---|
| ساخت دیسک | https://docs.liara.ir/paas/disks/create/ | `liara disk:create -a <app> -n <name> -s <GB>` (اعشار مجاز)؛ حجم باید در «فضای قابل رزرو» پلن بگنجد؛ صفحه حداقل/حداکثر و قیمت نمی‌دهد |
| مسیر دیسک | https://docs.liara.ir/paas/disks/route/ | `liara.json` ← `"disks":[{"name":"…","mountTo":"…"}]`؛ مسیر مطلق/نسبی مجاز؛ **ریشه (`/`) مجاز نیست**؛ `liara deploy` اعمال می‌کند؛ صفحه دربارهٔ replica چیزی نمی‌گوید |
| دیسک در Docker | https://docs.liara.ir/paas/docker/how-tos/use-disk/ | بدون دیسک، تغییرات فایل با ری‌استارت از بین می‌رود؛ مسیر باید **مطلق و شامل نام WORKING DIRECTORY** باشد (مثال `/app/uploads/`)؛ خط `VOLUME` باید از Dockerfile حذف شود |
| استقرار Docker | https://docs.liara.ir/paas/docker/how-tos/deploy-app/ | `Dockerfile` در ریشه (یا `build.dockerfile`)، `port`، `liaraignore.`/`.dockerignore`؛ `EXPOSE` اختیاری؛ فقط یک پورت HTTP عمومی؛ سازندهٔ ایمیج روی سرورهای Liara است (دانلود پایه به‌عهدهٔ Liara، نه این ماشین) |
| دسترسی FTP به دیسک | https://docs.liara.ir/paas/disks/ftp-access/ | FTPS پیش‌فرض؛ FTP ساده توصیه نمی‌شود؛ **محدودیت حجم/انتقال ذکر نشده** → انتقال ≈۰٫۸۳ GB تأییدنشده است |
| پشتیبان/بازیابی دیسک | `/paas/disks/create-backup/`، `/restore-backup-using-ftp|wget|console/` | خوانده نشد؛ قبل از تصمیم مالک باید خوانده شود |

مواردی که **تأیید نشد** (نباید حدس زده شوند): قیمت/ظرفیت پلن و دیسک، سقف اندازهٔ فایل FTP، رفتار دیسک با چند replica، سیاست هدرهای forwarded در لبهٔ Liara، دسترسی shell/`exec` برای اجرای importer روی خود دیسک.

## ۲. منطق WORKDIR و مسیر دیسک
- `Dockerfile` فعلی: `WORKDIR /app`، سرور standalone در `/app/server.js`، دادهٔ SQLite در `/data` با `VOLUME /data` (حالت **محلی اثبات‌شده**؛ دست‌نخورده).
- Liara مسیر مطلق شامل WORKDIR می‌خواهد و `VOLUME` را باید حذف کرد ⇒ قالب جدا: `deploy/liara/Dockerfile.liara` با `DATABASE_PATH=/app/data/app.sqlite`، بدون `VOLUME`، و `mountTo: "/app/data"`.
- دیسک فقط روی `/app/data` سوار می‌شود، نه `/app` (کد را نمی‌پوشاند). ایمیج بدون دیسک هم بوت می‌شود (`/api/health` سبز، `/api/ready` = `not_ready`).
- دو حالت مستند می‌مانند: محلی (`Dockerfile` + compose، `/data`) و Liara (`Dockerfile.liara`، `/app/data`). تست رگرسیون: `src/server/deploy/deploy-config.test.ts`.
- `deploy/liara/liara.json.example` عمداً **`.example`** است تا `liara deploy` تصادفی با نام دیسک ساختگی ممکن نباشد. نام دیسک/app همه placeholder هستند و ساختگی نیستند.

## ۳. ارزیابی ظرفیت (از اعداد واقعی)
| مورد | اندازه |
|---|---|
| `data/app.sqlite` | 827,924,480 B ≈ 0.83 GB (0.77 GiB) |
| ZIP اصلی | 60,178,644 B ≈ 0.06 GB |
| CSVهای بازشده (در importer) | ≈ 285 MB |
| DB دوم برای جایگزینی اتمیک/rollback | +0.83 GB |
| WAL/journal | سرور فقط‌خواندنی است ⇒ ≈ 0 (importer جدا) |

حداقل منطقی: DB فعلی + نسخهٔ قبلی/پشتیبان + ZIP ≈ **1.8 GB**؛ با حاشیهٔ import درون‌دیسک (CSV + DB موقت) ≈ **3 GB**. دیسک ۱ GB **کافی نیست** (فقط یک DB، بدون rollback). قیمت و سقف پلن Liara باید از کنسول مالک خوانده شود؛ این سند عدد قیمت نمی‌دهد.

روش انتقال (تأییدنشده، فقط گزینه‌ها): (الف) ساخت DB با importer **روی ماشین مالک** و انتقال `app.sqlite` از طریق FTPS به دیسک (حجم ≈۰٫۸۳ GB؛ سقف FTP نامعلوم)، و تأیید `sha256sum` + `db:verify` پس از انتقال؛ (ب) اجرای importer روی خود Liara (نیازمند shell/exec و ZIP روی دیسک؛ تأییدنشده). هیچ‌کدام اکنون انجام نشد. ZIP/DB هرگز وارد Git یا context ساخت نمی‌شوند (`.gitignore`، `.dockerignore`، `.liaraignore`).

## ۴. تک‌نمونه و هدرهای پروکسی
- یک replica (rate limit و cache درون‌پروسه‌اند). `liara.json.example` عمداً `replicas` ندارد.
- `TRUST_PROXY_HEADERS` **تنظیم نشود** تا اثبات شود لبهٔ Liara `X-Forwarded-For` جعلی را overwrite می‌کند. پیامد fail-safe: همهٔ کلاینت‌ها یک سطل rate-limit مشترک دارند (یک کاربر پرتکرار می‌تواند بقیه را کند کند) ولی دور زدن با جعل هدر ممکن نیست. اثبات: درخواست آزمایشی با هدر `X-Forwarded-For` ساختگی بعد از استقرار و بررسی اینکه سرور مقدار لبه را می‌بیند.

## ۵. نقشه، CSP، امنیت
- ارائه‌دهندهٔ کاشی نقشه و attribution همچنان **منتظر تأیید مالک** (`docs/deployment-packet.md` §7)؛ بدون نقشه ← فهرست (fallback) کار می‌کند.
- متغیرهای محیطی سرور: فقط `AGENT_PROVIDER=mock`، `AGENT_EVIDENCE_MODE=off`. هیچ کلید/توکن مدل تنظیم نشود.
- `read_only: true` و `no-new-privileges` در compose محلی روی Liara قابل اعمال نیست؛ ریسک باقیمانده در چک‌لیست.

## ۶. چک‌لیست Go/No-Go برای Liara (همه باز)
- [ ] مالک: حساب، app، پلن (قیمت/ظرفیت خوانده‌شده از کنسول)، بودجه
- [ ] دامنه + TLS
- [ ] نام/حجم/مسیر دیسک (`/app/data`، ≥ 3 GB پیشنهادی) تأیید مالک
- [ ] روش انتقال DB (FTPS از ماشین مالک) + سقف FTP تأیید شده + `sha256` و `db:verify` پس از انتقال
- [ ] یک replica، پورت 3000، readiness = `/api/ready`
- [ ] انتخاب کاشی نقشه (یا بدون نقشه)
- [ ] env: بدون هیچ کلید مدل؛ `TRUST_PROXY_HEADERS` تنظیم‌نشده تا اثبات
- [ ] پشتیبان دیسک + برنامهٔ rollback (نسخهٔ قبلی DB کنار فعلی)
- [ ] یک تست smoke دادهٔ واقعی پس از استقرار (`SMOKE_BASE_URL=… npx playwright test`، فقط specs فقط‌خواندنی)
- [ ] تأیید صریح مالک برای Pack 2؛ Pack 3 (BoxAPI) جداگانه و پس از آن
