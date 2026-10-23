# Runbook استقرار Liara (mock عمومی) — آماده؛ **اجرا نشده** (نیازمند حساب/پلن/تأیید مالک)

آخرین شواهد محلی (سورس فعلی): `tsc`/lint پاک · vitest ۶۵ فایل/۹۰۳ تست سبز · `db:verify` PASS · mock eval ۸۰/۸۰ (۰ فراخوانی خارجی) · **Playwright کامل روی image نامزد با DB واقعی: ۳۹۸ pass، ۰ fail، ۰ flaky، ۱۱۴ skip برچسب‌دار** (۱۰۹ فقط‑fixture، ۳ «کاشی خاموش»، ۱ live‑evidence، ۱ «فقط وقتی DB نیست») · سه suite ساختگی جدا: ۱۱ + ۴۳ + ۵۵ pass.

## ۱. تنظیمات دقیق (غیرمخفی)
`liara.json` (کپی از `deploy/liara/liara.json.example`؛ نام اپ/دیسک را مالک می‌گذارد):
```json
{ "platform": "docker", "app": "<APP_ID>", "port": 3000,
  "build": { "dockerfile": "deploy/liara/Dockerfile.liara", "cache": true, "args": ["NEXT_PUBLIC_MAP_TILES_DISABLED=1"] },
  "disks": [ { "name": "<DISK_NAME>", "mountTo": "/app/data" } ] }
```
محیط (در کنسول Liara، بخش متغیرهای محیطی): `AGENT_PROVIDER=mock` — **همین**. تنظیم **نکنید**: `AGENT_API_KEY`, `AGENT_BASE_URL`, `AGENT_MODEL`, `AGENT_LIVE_*`, `AGENT_EVIDENCE_MODE`, `AGENT_EXTERNAL_LIVE`, `TRUST_PROXY_HEADERS`, `TRUST_PROXY_HOPS`. حدود نرخ پیش‌فرض (دستیار ۳۰/دقیقه، POST ها ۱۲۰/دقیقه) می‌مانند؛ چون `TRUST_PROXY_HEADERS` خاموش است همهٔ بازدیدکنندگان یک سطل مشترک دارند ⇒ **ریسک عملیاتی شناخته‌شده**: داورانِ هم‌زمان ممکن است 429 ببینند؛ عدد را بدون اندازه‌گیری بالا نبرید. صفحات/جست‌وجو/مقایسه GET هستند و محدود نمی‌شوند؛ فقط نوبت‌های دستیار و POSTهای GPS/مقایسه شمرده می‌شوند.
تک‌replica (در `liara.json` هیچ `replicas` نیست). پورت ۳۰۰۰. image: `Dockerfile.liara` (بدون `VOLUME`، کاربر `node`، `REQUIRE_MIN_PRODUCTS=225903` ⇒ fixture/ناقص هرگز ready نمی‌شود).

## ۲. گام‌ها (فرمان‌های بدون راز؛ فقط پس از Gate L)
| # | عمل | بررسی |
|---|---|---|
| 1 | `liara login` (مالک در ترمینال خودش؛ اعتبارنامه به Claude داده نمی‌شود) · `liara plan list` (قیمت/RAM) · `liara app create -a <APP_ID> --platform docker --plan <PLAN> -r true` (rootfs فقط‌خواندنی؛ آزموده‌شده محلی) · `liara env set AGENT_PROVIDER=mock -a <APP_ID>` — **قیمت و فضای قابل‌رزرو را از داشبورد/`plan list` بخوانید** (مستندات عمومی نشان نداد) | RAM ≥ ۱ GB (ترجیحاً ۲ GB)؛ فضای دیسک ≥ ۲٫۵ GB (برآورد: DB فعال + دریافت جدید + rollback) |
| 2 | `liara disk:create -a <APP_ID> -n <DISK_NAME> -s 3` (اعشار مجاز) | وضعیت دیسک «آماده» |
| 3 | `liara deploy` از ریشهٔ پروژه (با `.liaraignore`؛ از **commit/working tree نهایی**) | build سبز؛ `/api/health`=200؛ `/api/ready`=**503** (DB هنوز نیست) |
| 4 | کنسول: FTP access برای دیسک بسازید؛ `rclone config` با `explicit_tls=true` (FTPS) | اتصال TLS |
| 5 | از ماشین مالک، با نام موقت (اپ فایل `.part` را نمی‌بیند): `rclone copyto data/app.sqlite <remote>:/app.sqlite.part -P` | اندازه = 827,924,480 |
| 6 | `liara shell -a <APP_ID> -c "sha256sum /app/data/app.sqlite.part"` (دستور `liara shell` در CLI 9.5.1 موجود است؛ کار کردن آن روی این اپ هنگام اجرا تأیید می‌شود) — معادل: `sha256sum /app/data/app.sqlite.part` | = `47225ae564418042bc6f558e0653f63d3fb570228460074e0f43b4a99b156de5` |
| 7 | همان shell (`liara shell -a <APP_ID> -c '…'`): `node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/app/data/app.sqlite.part',{readOnly:true});console.log(d.prepare('PRAGMA integrity_check').get(),d.prepare('select count(*) n from products').get())"` | `ok` و ۲۲۵٬۹۰۳ |
| 8 | `[ -f /app/data/app.sqlite ] && mv /app/data/app.sqlite /app/data/app.prev.sqlite; mv /app/data/app.sqlite.part /app/data/app.sqlite` (rename در همان فایل‌سیستم اتمیک است) | — |
| 9 | **`liara restart -a <APP_ID>`** (اتصال SQLite در حافظه کش می‌شود؛ تا restart فایل جدید دیده نمی‌شود) | `/api/ready`=200 با `snapshotRef 2026-10-13T00:02:35.297Z` |
| 10 | smoke عمومی: `SMOKE_BASE_URL=https://<دامنه> npx playwright test e2e/smoke.spec.ts e2e/security.spec.ts` + دستی ۳۶۰/۳۹۰/۷۶۸/۱۴۴۰ (چهار مرحله + بازیابی) | بدون خطای کنسول؛ برچسب mock |
اگر shell در دسترس نبود: مسیر جایگزین = اندازهٔ بایتی از لیست FTP + `/api/ready`/شمارش‌ها پس از restart؛ هش `NOT VERIFIED` گزارش شود.
**Rollback:** `mv app.sqlite app.bad.sqlite; mv app.prev.sqlite app.sqlite` + restart؛ یا استقرار image قبلی. هیچ حذف دیسک/اپ بدون تأیید.

## ۳. چیزهایی که فقط حساب مالک می‌داند
قیمت/RAM/CPU پلن، فضای قابل‌رزرو، سقف FTPS (مستند نشده؛ rclone با `-P` پیشرفت/ازسرگیری می‌دهد)، دسترسی shell اپ Docker، دامنهٔ پیش‌فرض و TLS، رفتار هدر `X-Forwarded-For` لبه، استفاده‌ی Liara از HEALTHCHECK، اعتبار حساب.

## ۴. هنگام استقرار (به‌ترتیب تصمیم لازم)
حساب/اپ/پلن (+ سقف ماهانه) · نام و حجم دیسک · پوش به GitHub یا deploy از پوشه · دامنه · اجازهٔ استقرار عمومی. برای تأیید BoxAPI جدا: بخش ۰ در `docs/live-ai-trial-runbook.md`.
