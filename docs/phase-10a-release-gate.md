# فاز ۱۰A — بستن گیت انتشار و پیش‌استقرار بدون هزینه

> **نتیجه:** Gate A ✅ PASS · Gate B ✅ PASS (با محدودیت‌های مستند) · Gate C 🟡 PARTIAL (بسته‌ی محلی کامل؛ استقرار واقعی و سیاست Git بدون تصمیم مالک) · Gate D 🟡 PARTIAL (خودکار ✅؛ انسانی/Firefox/WebKit NOT VERIFIED) · Gate E ✅ PASS (طراحی + ساخت قفل‌شده + آزمون صفر‌هزینه؛ اجرا نشد) · Gate F ✅ PASS (mock).
> **هیچ استقرار، دانلود مرورگر، فراخوانی مدل/BoxAPI، پیام به فروشنده، `git add/commit/push` انجام نشد.** `LIVE_MODEL_CALLS_ENABLED_IN_CODE=false`.

## ۱. Gate A — اجرای کامل پس از اصلاح
* `bash scripts/release-gate.sh` ⇒ `docs/qa/release-gate-latest.txt` (بدون راز؛ کلید در محیط ⇒ توقف). هش پایگاه داده پیش/پس: `47225ae564418042bc6f558e0653f63d3fb570228460074e0f43b4a99b156de5`، ۸۲۷٬۹۲۴٬۴۸۰ بایت، **بدون تغییر**؛ هش ZIP نیز بدون تغییر.
* نتایج (نهایی در بخش «اجرای نهایی» پایین): tsc ✅ · lint ✅ · Vitest ✅ · `db:verify` ✅ · build standalone ✅ · `agent:eval` ۸۰/۸۰ (`externalCalls=0`, `costUsd=0`) · Playwright Chromium کامل.
* **ریشهٔ شکست قبلی (`document-title`، `mission-visit`):** Next هنگام گذار کلاینت `<title>` را جایگزین می‌کند؛ لحظه‌ای `document.title` تهی است (اثبات با MutationObserver روی اعلام‌گر مسیر: در یک ناوبری، مقدار title هنگام اعلام تهی بود و اعلام‌گر به h1 رجوع کرد). احتمالاً axe در همان تیک اجرا شده بود ⇒ علت محتمل: **گذرا و مربوط به زمان‌بندی نمونه‌برداری آزمون** (نه عنوان نادرست در حالت پایدار؛ شکست فقط یک‌بار دیده شد و ۱۰+۳۶ تکرار بعدی سبز بود). اصلاح آزمون: انتظار کران‌دار (`expect.poll` پیش‌فرض ۵ s، نه انتظار بی‌پایان).
* **آزمون جدید `e2e/title-nav.spec.ts` (۱۲ تست):** عنوان درست پس از load کامل و refresh برای ۱۰ مسیر؛ ناوبری کلاینت واقعی با کلیک نوار پایین ×۳ دور ×۵ مقصد (`title` + `#__next-route-announcer__` با `aria-live="assertive"` و متن برابر عنوان) و جریان ماموریت ×۳ با تعویض تب و reload. ۳ تکرار متوالی کل فایل (۳۶ اجرا) سبز.
* یافته‌ٔ فرعی ثبت‌شده (بدون ادعای باگ محصول): با `router.push` برنامه‌ای (نه کلیک لینک) اولین ناوبری گاهی اعلام نمی‌شود؛ با کلیک واقعی لینک همه‌ٔ ناوبری‌ها اعلام شدند. رفتار مسیریاب Next است؛ **با صفحه‌خوان واقعی هنوز آزموده نشده**.

## ۲. Gate B — پیکربندی تولید و fail‑closed
`node scripts/gate-b-proof.mjs` روی build تولید (سرور standalone، کلید و آدرس **جعلی**، sink TCP محلی به‌جای میزبان مدل) ⇒ `docs/qa/gate-b-proof.json`:
| سناریو | نتیجه |
|---|---|
| env شبیه‌زندهٔ کامل، approval ناقص (`APPROVED-x`)، شکل جعلی (حروف کوچک)، approval منقضی، اعتبار > ۷۲ ساعت، kill=1، مدل خارج از allowlist، فقط کلید | ۳×۵۰۳ `AGENT_LIVE_LOCKED` در هر کدام؛ `enabled:false`؛ UI کارت «مدل زنده قفل است»، **بدون** بنر mock؛ **اتصال sink = ۰ (جمع کل ۰)** |
| `AGENT_PROVIDER=mock` | بنر `data-provider="mock"` + «هیچ مدل زبانی‌ای در کار نیست» |
| `AGENT_PROVIDER=disabled` | «دستیار غیرفعال است»؛ turn ⇒ ۵۰۳ |
| Cache-Control | همهٔ صفحات `private, no-cache, no-store`؛ همهٔ APIها `no-store` |
| CSP | nonce متفاوت در هر درخواست؛ `strict-dynamic`؛ `style-src 'unsafe-inline'` (باقی‌مانده، جدا گزارش می‌شود) |
| CSRF/POST | `cross-site`/Origin بیگانه ⇒ ۴۰۳؛ `text/plain` ⇒ ۴۱۵؛ بزرگ ⇒ ۴۱۳ — برای هر سه مسیر POST |
| راز | bundle (۴۰ فایل): ۰ رشتهٔ AGENT_API_KEY/مدل/openai؛ لاگ سرور: ۰ نشت کلید جعلی |
**اصلاحات واقعی کد:** (۱) دو POST (`/api/sellers`, `/api/compare/sellers`) محافظ cross‑site/نوع/اندازه/نرخ نداشتند ⇒ `readGuardedJson`؛ (۲) `clientKey` به هدر `X-Forwarded-For` اعتماد می‌کرد ⇒ جعل هدر حد نرخ را دور می‌زد؛ اکنون فقط با `TRUST_PROXY_HEADERS=1` (پشت proxy بازنویس‌کننده) و در غیر این صورت سطل مشترک؛ (۳) دست‌دادن live اکنون انقضا (≤ ۷۲ ساعت)، allowlist مقصد/مدل و قیمت‌های تأییدشده را می‌طلبد.
**باقی‌مانده/محدودیت:** حد نرخ درون‌پردازه‌ای ⇒ فقط تک‌نمونه (`docs/deployment-packet.md` §۴)؛ درخواست بدون Origin/Sec‑Fetch‑Site رد نمی‌شود (بدون کوکی ⇒ CSRF نیست؛ محافظ = نرخ/اندازه)؛ نبود احراز هویت ⇒ کلاینت غیرمرورگری فقط با نرخ مهار می‌شود. Scarbir همچنان link‑only. تمایز قیمت ثبت‌شده و گزارش‌شدهٔ کاربر، عدم تأیید موجودی و عدم ادغام variant مبهم با آزمون‌های موجود (`inquiry`, `compare`, `journeys`, `demo-rehearsal`) حفظ شد.

## ۳. CSP سخت‌تر برای style — شاهد اندازه‌گیری‌شده
* `CSP_STRICT_STYLES=1` ⇒ `style-src 'self' 'nonce-…'; style-src-attr 'unsafe-inline'`. **اجرای کامل Playwright Chromium با این حالت: ۳۹۳ موفق، ۰ ناموفق، ۲ skip** (۱۹:۳۹–۱۹:۴۱؛ شامل آزمون «۰ نقض CSP»، نقشه و سفرها). سربرگ روی سرور standalone تأیید شد و `security.spec` در هر دو حالت (پیش‌فرض/سخت) سبز است.
* پیش‌فرض عوض **نشد**: Firefox/WebKit اندازه‌گیری نشده و موتورهای بدون `style-src-attr` استایل‌های inline (Leaflet) را رد می‌کنند. تصمیم فعال‌سازی = مالک پس از آزمون مرورگرهای دیگر.

## ۴. Gate C — بستهٔ استقرار
`docs/deployment-packet.md` + `deploy/*.example` (اعمال‌نشده). Docker محلی با volume یک‌بارمصرف: import، `db:verify`، health/ready، restart ≈ ۰٫۲۸ s، نوشتن در `/data` و `/app` رد، حافظه ≈ ۴۶ MiB بیکار/≈ ۵۷۸ MiB پس از بار، image ≈ ۳۸۸ MB، DB ≈ ۷۹۰ MiB. اعداد فقط برای این ماشین‌اند.
**یافتهٔ بحرانی:** `git ls-files` = ۱ فایل؛ ۵۵۶ فایل untracked ⇒ استقرار از مخزن فعلی ممکن نیست (تصمیم Git با مالک؛ `docs/qa` ≈ ۵۱ MB). همچنین Dockerfile اکنون `ARG` برای تنظیمات کاشی دارد (قبلاً در Docker قابل تغییر نبود)، و `playwright.config.ts` گزینهٔ `SMOKE_BASE_URL` برای smoke پس از استقرار گرفت.

## ۵. Gate D
خودکار (Chromium): axe ۲۸ مسیر × ۲ اندازه، کیبورد‑فقط چهار مرحله، فوکوس تأیید حذف، viewport کوتاه (۳۶۰) بدون سرریز، هدف ۴۴px (ممیزی ۳۹۰px)، سرریز افقی در ۵ اندازه ⇒ همه در اجرای کامل سبز. پروتکل‌های انسانی ۱۰ دقیقه‌ای (صفحه‌خوان، گوشی واقعی) و دستورهای اجرانشدهٔ Firefox/WebKit: `docs/qa/human-test-protocols.md`. **انطباق WCAG ادعا نمی‌شود.**

## ۶. Gate E — آزمایش ارزان BoxAPI (فقط طراحی/ساخت قفل‌شده)
`src/server/agent/live-guard.ts` (allowlist مقصد/مدل، سقف token/درخواست/دلار، هم‌زمانی ۱، رزرو بدترین‌حالت، ledger بدون محتوا، stop switch، circuit breaker، fail‑closed در نبود usage/قیمت)، `live-gate.ts` (دست‌دادن زمان‌دار)، `runtime.ts` (فقط با گیت باز ⇒ هرگز در این فاز)، retry=۰ برای live. ۱۷ تست محلی. جزئیات و محدودیت «سقف سمت برنامه ≠ توقف صورتحساب»: `docs/live-ai-trial-runbook.md` §۲. صفحهٔ رسمی قیمت BoxAPI در این نشست پیدا/تأیید نشد؛ **هیچ قیمت یا مدلی حدس زده نشد**؛ سقف دلار مجموع سه چالش = **تأییدنشده**.

## ۷. شفافیت دربارهٔ یک اتفاق
هنگام فهرست کردن volume، `docker run busybox` یک image کوچک (≈ ۴ MB) را از رجیستری عمومی pull کرد (برنامه‌ریزی‌نشده؛ مجوز مرورگر/مدل نبود ولی «دانلود» بود). بلافاصله `docker rmi busybox` شد و از آن پس فقط image خودِ پروژه استفاده شد. تأثیری بر داده/هزینه نداشت؛ برای شفافیت ثبت می‌شود.

## ۸. Gate F — تمرین دمو (mock)
`e2e/demo-rehearsal.spec.ts` ده صحنهٔ `docs/demo-script.md` را روی UI واقعی با شناسه‌های واقعی اجرا می‌کند (خروجی `docs/qa/demo-rehearsal.json`: زمان هر صحنه + فهرست درخواست‌های non‑GET که فقط سه POST خواندنی هستند)؛ هیچ درخواستی به هاست بیرونی غیر از کاشی/عکس محصول، و هیچ مدل/فروشنده‌ای. زمان خالص عمل UI ≈ ۱۱ ثانیه (بدون گفتار)، پس ۵ دقیقه با روایت جا می‌شود؛ تنها ریسک: کندی کاشی OSM (راهکار: `tiles=0`). صحنهٔ «بدون نتیجه با محله‌های تخصصی و منبع» و «variant مبهم» اکنون در اسکریپت و تست هستند.

## ۹. چک‌لیست ارسال (فقط از اطلاعات موجود؛ قواعد داوری ساخته نشده)
| مورد | وضعیت |
|---|---|
| URL عمومی | ⬜ ندارد (استقرار تأییدنشده) |
| مخزن و ردیابی نسخه | ⬜ ۵۵۶ فایل untracked؛ تصمیم Git با مالک |
| بنیاد build | ✅ `scripts/release-gate.sh` و Dockerfile |
| ویدیوی ~۵ دقیقه (اجباری) | ⬜ ضبط نشد؛ اسکریپت + تمرین آماده |
| اسکرین‌شات‌ها | ✅ `docs/qa/*.png` (۵ اندازه) |
| جدول ویژگی‌ها | ✅ `docs/rubric-matrix.md` (بدون امتیاز ادعایی) |
| محدودیت‌های شناخته‌شده | ✅ `docs/phase-9-1-release-readiness.md` §۸، این سند، `docs/deployment-packet.md` |
| مهلت/قالب رسمی | ⬜ در مواد داده‌شده نیست؛ ساخته نشد |

## ۱۰. ریسک‌های باقی‌مانده rubric
Product: محصول چندکالایی (P1) ساخته نشد. UX: تست انسانی/Firefox/WebKit نشده. Intelligence: مدل زنده تأیید نشده (فقط mock و قفل‌شده). Deployment: میزبان، TLS، کاشی تولید، حد نرخ مشترک و Git. Technical: `style-src` سخت‌تر opt‑in، تک‌نمونه. Dataset: پوشش جغرافیایی محدود به فردوسی/شیخ‌هادی/بهارستان (در UI گفته شده).

## ۱۱. اجرای نهایی (جایگزین پس از آخرین ویرایش فایل‌ها)
اجرای `bash scripts/release-gate.sh` روی **حالت نهایی فایل‌ها** (۱۹:۴۳:۵۹ تا ۱۹:۴۶:۵۹+۰۳:۳۰، `docs/qa/release-gate-latest.txt`):
| گام | نتیجه |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` (Vitest) | **۸۷۱ تست / ۵۸ فایل** همه سبز (فاز ۹.۱: ۸۵۱/۵۷) |
| `npm run db:verify` | exit 0 (ALL CHECKS PASSED) |
| `npm run build` standalone | exit 0 |
| `npm run agent:eval` (mock) | **۸۰/۸۰**، `externalCalls=0`، `costUsd=0` |
| Playwright Chromium (Chrome سیستمی) کامل | **۳۹۳ موفق · ۰ ناموفق · ۰ flaky · ۲ skip** · ۱۴۱ s |
| هش DB / ZIP پس از همه | بدون تغییر |
**دو skip عمدی:** (۱) `evidence.spec.ts:36` فقط با سرور live‑evidence و `HAMGHADAM_LIVE_EVIDENCE_E2E=1` (NOT VERIFIED، اجرا نشد)؛ (۲) `smoke.spec.ts:52` فقط وقتی DB نباشد (DB هست). اجرای هم‌ارز با `CSP_STRICT_STYLES=1`: ۳۹۳ موفق، ۲ skip (§۳). اجرای قبلی همین روز (پیش از افزودن یک ادعای `security.spec` دربارهٔ حالت style): ۳۹۳/۰/۲ هم‌چنین.
