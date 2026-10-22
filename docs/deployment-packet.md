# بستهٔ آمادگی استقرار (فاز ۱۰A، Gate C) — **هیچ استقرار بیرونی انجام نشده**

> این سند و پوشهٔ `deploy/` فقط **الگو و شواهد محلی** هستند. هیچ میزبان، دامنه، DNS، حساب ابری یا ارائه‌دهندهٔ نقشه انتخاب/ساخته نشده است و هیچ URL عمومی وجود ندارد. «پیشنهاد» در این سند = تأیید نیست.

## ۱. شواهد Docker محلی (پروژهٔ یک‌بارمصرف `hamghadam-gatec`، پورت ۳۰۲۰، ۲۰۲۶‑۱۰‑۲۲ ≈ ۱۹:۲۵)
حجم/پروژهٔ جدا؛ `data/app.sqlite` و `.data/` دست‌نخورده ماندند (sha256 پیش و پس یکسان: `47225ae5…56de5`).

| مورد | مشاهده |
|---|---|
| import از ZIP (volume تازه) | ۲۲۵٬۹۰۳ محصول · ۶٬۴۷۶ فروشگاه · ۳۳۱٬۵۰۶ پیشنهاد · یتیم = ۰ · ≈ ۵۲ s wall (شامل ساخت image از cache) |
| `db:verify` داخل کانتینر | **ALL CHECKS PASSED** |
| بایت‌های DB | ۸۲۷٬۹۲۴٬۴۸۰ B (برابر DB میزبان؛ **sha256 متفاوت است** چون import زمان/متادیتا می‌نویسد — برابری با شمارش‌ها و `db:verify` سنجیده شد، نه با هش) |
| image برنامه (runner) | ≈ ۳۸۸ MB (`docker images`) |
| health / ready | `/api/health` ۲۰۰ · `/api/ready` ۲۰۰ · healthcheck = healthy |
| سخت‌سازی | `user=node` · rootfs فقط‌خواندنی · `no-new-privileges` · `restart=unless-stopped` · `/data` با `rw=false` |
| نوشتن ممنوع | `touch /data/x` و `touch /app/x` ⇒ *Read-only file system*؛ `/tmp` (tmpfs) قابل‌نوشتن؛ اتصال SQLite `readOnly` ⇒ «attempt to write a readonly database» |
| پایداری پس از restart | `docker restart` ⇒ `/api/ready` ظرف **≈ ۰٫۲۸ s**، داده در volume ماند |
| حافظه | بیکار ≈ ۴۶ MiB؛ بعد از اجرای پروفایل عملکرد (≈ ۴۰ درخواست/نقطه) ≈ **۵۷۸ MiB** (بخشی page-cache فایل SQLite که قابل‌بازیابی است) |
| CPU | ≈ ۰٪ در حالت بیکار؛ بار لحظه‌ای ثبت‌شده در `docs/qa/perf-profile-docker.json` |
| تأخیر query (Docker، همان ماشین) | جست‌وجو cold ≈ ۲۲۰ ms / warm p50 ≈ ۵٫۷ ms · مشاور warm ≈ ۵۷ ms · فروشندگان (R‑Tree) warm ≈ ۱۶ ms · مقایسه ≈ ۱۷ ms · بازیابی ماموریت warm ≈ ۱۵۴ ms · نوبت دستیار mock ≈ ۱۳ ms |

**قید اعتبار:** همهٔ اعداد از **همین ماشین توسعه** (i5‑14450HX، ۱۶ رشته، ۱۵ GB RAM، NVMe) آمده‌اند. اندازهٔ VPS، شبکهٔ موبایل و تأخیر واقعی کاربر **اندازه‌گیری نشده** و نباید از این اعداد استنتاج شود. توصیهٔ محافظه‌کارانهٔ اولیه (نه اندازه‌گیری): حافظهٔ ≥ ۲ GB، دیسک ≥ ۳ GB (image ≈ ۰٫۴ + DB ≈ ۰٫۸ + ZIP ≈ ۰٫۱ + ثبت‌ها).

یک ناهنجاری ثبت‌شده: در این اجرا پیش از پاک‌سازی، `docker run busybox` برای فهرست‌کردن volume باعث **pull یک image کوچک (≈ ۴ MB) از رجیستری عمومی** شد؛ این کار برنامه‌ریزی‌شده نبود، بلافاصله حذف شد و در گزارش آورده شده است (جزئیات: `docs/phase-10a-release-gate.md` §۷).

پاک‌سازی: `docker compose -p hamghadam-gatec down -v` و حذف image‌های همان پروژه انجام شد؛ volume اصلی `novo-torob_torob-data` دست نخورد.

## ۲. روش بازتولید محلی (volume یک‌بارمصرف)
```bash
export COMPOSE_PROJECT_NAME=hamghadam-gatec APP_PORT=3020
docker compose --profile tools run --rm importer            # DB تازه در volume جدا (ZIP فقط‌خواندنی)
docker compose up -d --build app
curl -s localhost:3020/api/health; curl -s localhost:3020/api/ready
docker compose --profile tools run --rm importer npm run db:verify
docker compose down -v                                      # پاک‌سازی (volume یک‌بارمصرف)
```

## ۳. وضعیت کنترل‌ها (Gate B) — خلاصه
| کنترل | وضعیت | شاهد |
|---|---|---|
| مدل زنده قفل‌شده در کد، بدون fallback خاموش | ✅ | `scripts/gate-b-proof.mjs` → `docs/qa/gate-b-proof.json` (۸ حالت «شبیه‌زنده»: همه ۵۰۳؛ اتصال به sink محلی = ۰) |
| برچسب mock / disabled | ✅ | `mock` = «برنامه‌ریز قطعی، نه مدل زبانی»؛ `disabled` = «دستیار غیرفعال است» |
| `Cache-Control` | ✅ | تمام صفحات: `private, no-cache, no-store`؛ تمام API: `no-store` |
| CSP با nonce در build تولید | ✅ | nonce متفاوت در هر درخواست؛ ۰ نقض در مسیرها |
| CSRF | ✅ با محدودیت | نک. §۵ |
| SSRF / خروجی | ✅ | `safe-fetch.ts`؛ تنها مقصد خروجی سرور: رجیستری شواهد (پیش‌فرض link‑only ⇒ بدون fetch) |
| افشای راز در bundle/لاگ | ✅ | ۴۰ فایل `.next/static` اسکن شد: ۰ رشتهٔ راز/مدل؛ لاگ سرور: ۰ نشت کلید جعلی |
| rate limit | ⚠️ فقط درون‌پردازه‌ای | §۴ |

## ۴. تک‌نمونه (single instance) پیش‌فرض
حد نرخ (`RateLimiter`)، سقف هم‌زمانی (`Semaphore`) و کش شواهد **داخل حافظهٔ هر فرایند** هستند. با N نمونه، سقف مؤثر ≈ N برابر می‌شود و هیچ تضمین چند‑replica وجود ندارد.
* **الزام:** یک نمونه (`replicas: 1`، بدون autoscaling) تا زمانی که حد نرخ مشترک (Redis یا نرخ‌دهی در proxy) ساخته و آزمایش نشده است.
* `X-Forwarded-For` فقط با `TRUST_PROXY_HEADERS=1` معتبر است و آن هم **فقط** پشت proxy ای که آن را بازنویسی می‌کند (`deploy/Caddyfile.example`، `nginx.conf.example`). بدون آن همهٔ کلاینت‌ها یک سطل مشترک دارند (جعل هدر دور نمی‌زند).
* ساخت‌نشده (مستند): store مشترک؛ بدون آن، حمله با چند نمونه/چند IP پشت proxy فقط با WAF/نرخ‌دهی لبه مهار می‌شود.

## ۵. CSRF و POSTها
سه مسیر POST وجود دارد (`/api/sellers`، `/api/compare/sellers`، `/api/agent/turn`)؛ **هر سه خواندنی** (محاسبه) هستند، کوکی/نشست ندارند و تغییری در سرور نمی‌دهند. ساختن حالت ماندگار فقط در مرورگر کاربر است.
* اصلاح این فاز: دو مسیر اول پیش‌تر رد cross‑site، الزام `application/json`، سقف اندازه و حد نرخ نداشتند؛ اکنون `readGuardedJson` (`src/server/api.ts`) همان رفتار `agent/turn` را دارد: `Sec-Fetch-Site: cross-site` یا `Origin` بیگانه ⇒ ۴۰۳؛ `text/plain` ⇒ ۴۱۵؛ بدنهٔ > ۸ KB ⇒ ۴۱۳؛ حد نرخ ⇒ ۴۲۹. (شاهد: `gate-b-proof.json › csrf`.)
* **محدودیت صادقانه:** درخواست **بدون** `Origin` و `Sec-Fetch-Site` (کلاینت غیرمرورگری مثل curl) رد نمی‌شود؛ چنین کلاینتی کوکی ambient ندارد، پس CSRF نیست؛ فقط حد نرخ/اندازه محافظ است. هدرها به‌تنهایی «حل CSRF» نیستند؛ حل واقعی = نبود احراز هویت ambient + عدم تغییر حالت سروری.
* ادعای «CSRF حل‌شده» نمی‌شود؛ فقط «بدون مسیر بهره‌برداری شناخته‌شده برای تغییر حالت».

## ۶. CSP
* پیش‌فرض: `script-src 'self' 'nonce-…' 'strict-dynamic'`؛ **`style-src 'self' 'unsafe-inline'`** (ریسک باقی‌مانده: تزریق CSS در صورت وجود XSS؛ پایین‌تر از تزریق اسکریپت).
* حالت سخت‌تر opt‑in: `CSP_STRICT_STYLES=1` ⇒ `style-src 'self' 'nonce-…'` + `style-src-attr 'unsafe-inline'`. نتیجهٔ اجرا: در `docs/phase-10a-release-gate.md` §۳ (Chromium). روی Firefox/WebKit **اندازه‌گیری نشده**؛ موتورهای بدون پشتیبانی از `style-src-attr` استایل inline را رد می‌کنند، پس پیش‌فرض عوض نشد.
* `img-src` از `map-config.ts` مشتق می‌شود (تنها `image.torob.com` + میزبان کاشی پیکربندی‌شده). تغییر ارائه‌دهنده ⇒ build جدید (مقادیر `NEXT_PUBLIC_*` در زمان build درج می‌شوند؛ Dockerfile اکنون `ARG` آن‌ها را دارد).

## ۷. تصمیم ارائه‌دهندهٔ کاشی نقشه (بدون انتخاب؛ جدول تصمیم)
هیچ ثبت‌نام، کلید یا طرح پولی انجام نشده. OSM community **SLA ندارد** و برای بار تولید نیست؛ سیاست رسمی OSM باید در روز راه‌اندازی دوباره خوانده شود (در این نشست بازبینی زنده نشد ⇒ NOT VERIFIED).

| ارائه‌دهنده | شرایط حقوقی | attribution | استفادهٔ مجاز | سهمیه | `img-src` | حریم | هزینه | fallback |
|---|---|---|---|---|---|---|---|---|
| OSM community (`tile.openstreetmap.org`) | سیاست کاشی OSM (ODbL داده) | «© OpenStreetMap contributors» + پیوند | کاربر تعاملی و کم‌حجم؛ بدون bulk/prefetch؛ بدون SLA | سهمیهٔ رسمی ندارد؛ ممکن است مسدود شود | `https://tile.openstreetmap.org` | IP/ناحیهٔ دیده‌شده به سرور OSM می‌رود (در UI افشا شده) | ۰ | لیست/بدون‌کاشی (`tiles=0`) — تست‌شده |
| سرویس تجاری/میزبانی‌شده (مثلاً MapTiler/Stadia/Mapbox یا مشابه) | شرایط ارائه‌دهنده + طرح | طبق شرایط آن | طبق طرح | طبق طرح | یک میزبان صریح | همین + حساب | **پولی/نیازمند حساب** ⇒ تأیید مالک | همان |
| کاشی خودمیزبان | ODbL + خودمیزبانی | OSM | نامحدود در توان سرور | سخت‌افزار خودتان | دامنهٔ خودتان | بدون نشت به ثالث | هزینهٔ زیرساخت و داده | همان |
| بدون کاشی (`NEXT_PUBLIC_MAP_TILES_DISABLED=1`) | — | — | فهرست + پین‌های خام | — | هیچ میزبان کاشی | هیچ نشت | ۰ | خود حالت fallback |

پیشنهاد فنی (نه تأیید): برای دمو/داوری OSM با attribution و بار کم یا «بدون کاشی»؛ برای تولید، تصمیم مالک.

## ۸. الگوهای استقرار (`deploy/`، اعمال‌نشده)
`Caddyfile.example` / `nginx.conf.example` (TLS، HTTPS، Host ثابت، بازنویسی XFF، سقف بدنه، لاگ بدون query/body) · `docker-compose.prod.example.yml` (تک‌نمونه، non‑root، rootfs فقط‌خواندنی، `cap_drop: ALL`، volume `:ro`، rotation لاگ، healthcheck) · `hamghadam.env.example` (بدون راز) · `backup-restore.sh.example`.
* **Host معتبر:** فقط دامنهٔ مجاز در proxy (`server_name`/Caddy site)، و `Host`/`X-Forwarded-Proto` درست ارسال شود؛ بررسی Origin برنامه با `Host` کار می‌کند (`isCrossSite`).
* **لاگ:** برنامه فقط خطوط بی‌محتوا می‌نویسد؛ proxy نباید query/body ثبت کند (مختصات و متن جست‌وجو). نگهداری ≈ ۷ روز، ≤ ۵۰ MB.
* **پشتیبان:** DB از ZIP قابل بازسازی است (≈ ۱ دقیقه)؛ اسنپ‌شات = کپی فایل ساکن + sha256؛ بازیابی = بررسی هش → جایگزینی اتمیک → `db:verify` → restart.

## ۹. انتشار، rollback و smoke پس از استقرار
1. **انتشار:** `git` پاک و مشخص (نک. §۱۰) → `docker build --target runner -t hamghadam-app:<TAG> .` (و `--target tools`) → import در volume جدا → `db:verify` → `compose up -d` → health/ready.
2. **DB:** اسنپ‌شات پیش از جایگزینی؛ بررسی `ALL CHECKS PASSED`؛ شمارش‌ها = ۲۲۵٬۹۰۳ / ۶٬۴۷۶ / ۳۳۱٬۵۰۶.
3. **Smoke خواندنی روی URL مستقر:** `SMOKE_BASE_URL=https://<DOMAIN> npx playwright test e2e/smoke.spec.ts e2e/release-journey.spec.ts e2e/title-nav.spec.ts` (هیچ پیامی به فروشنده نمی‌رود؛ فقط ذخیرهٔ سمت مرورگر). چهار مرحلهٔ رسمی: ۱ انتخاب محصول (`journeys`، search) · ۲ فروشندگان نزدیک (`sellers`) · ۳ مقایسه (`compare`) · ۴ پرسش دستی/شبیه‌سازی‌شدهٔ برچسب‌دار (`inquiry`, `demo-rehearsal`).
4. **Rollback:** نگه‌داشتن `hamghadam-app:<TAG‑قبلی>` و اسنپ‌شات قبلی؛ `compose up -d` با TAG قبلی؛ در صورت خرابی DB بازیابی اسنپ‌شات؛ هیچ مهاجرت یک‌طرفه‌ای وجود ندارد.
5. **تغییر CSP/کاشی:** build جدید با `--build-arg`؛ سپس `security.spec` و smoke.

## ۱۰. وضعیت Git (فقط‌خواندنی؛ بدون add/commit/push)
* `git ls-files` فقط **۱ فایل** را ردیابی می‌کند؛ ۵۵۶ فایل کد/تست/مستند **untracked** هستند (src ۲۶۹، docs ۲۲۸، e2e، tests، scripts، پیکربندی‌ها، Dockerfile، compose). **استقرار از روی مخزن فعلی ممکن نیست** تا مالک سیاست Git را تعیین کند.
* ignore تأییدشده: `.data/`، `data/`، `.env*`، `.next/`، `node_modules/`، `test-results/`، `*.zip`، `*.mp4`، `*.sqlite`، `.live-kill`. `public/.gitkeep` وجود دارد (برای `COPY public`).
* تصمیم لازم: `docs/qa/` ≈ ۵۱ MB اسکرین‌شات است (در `.dockerignore` هست) — commit، LFS یا ignore؟
* image نهایی نباید شامل DB یا ZIP باشد (`.dockerignore`)؛ تأیید شده است.

## ۱۱. انتخاب‌های لازم از مالک (هیچ‌کدام تأیید نشده)
میزبان · دامنه/DNS/TLS · ارائهٔ کاشی نقشه · سیاست Git (و `docs/qa`) · دانلود Firefox/WebKit · اجازهٔ استقرار عمومی · (جدا) آزمایش BoxAPI.
