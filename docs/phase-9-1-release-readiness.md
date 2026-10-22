# فاز ۹.۱ — بستن آمادگی انتشار (بدون هیچ فراخوانی BoxAPI)

> **وضعیت: PARTIAL** — کد/تست/امنیت/مستندات برای نسخه‌ی mock کامل و سبز است؛ ولی چهار مورد خارج از اختیار این فاز باز می‌ماند: Firefox/WebKit (نیاز به مجوز دانلود)، صفحه‌خوان و گوشی واقعی (انسانی)، مدل زنده (قفل؛ تأیید مالک)، استقرار (میزبان تأییدنشده). هیچ امتیازی ادعا نمی‌شود.
> **۰ درخواست مدل پولی · ۰ تماس با فروشنده · ۰ دانلود · ۰ commit/push/استقرار.** `LIVE_MODEL_CALLS_ENABLED_IN_CODE=false`.

## ۱. ماتریس گیت انتشار
«mock‑verified» یعنی با برنامه‌ریز قطعی و داده‌ی واقعی تورب آزموده شد. «real‑model» همیشه جدا و **NOT VERIFIED** است.

| # | گیت | سطح | وضعیت | شاهد |
|---|---|---|---|---|
| G1 | `tsc` / lint بدون خطا | BLOCKING | ✅ | §۲ |
| G2 | تست واحد/یکپارچگی | BLOCKING | ✅ | §۲ |
| G3 | `db:verify` + `data/app.sqlite` دست‌نخورده (sha256 = `47225ae5…56de5`) | BLOCKING | ✅ | §۲ |
| G4 | build standalone + اجرای Docker (health/ready/هدرها) | BLOCKING | ✅ | §۲ |
| G5 | Playwright Chromium (سفرها، a11y axe، کیبورد، امنیت، شبکه‌ی بدون‌ارسال) | BLOCKING | ✅ | §۲ |
| G6 | `agent:eval` ۸۰/۸۰ (mock) | BLOCKING | ✅ mock‑verified | §۲ |
| G7 | هیچ درخواست مدل پولی؛ env «شبیه زنده» ⇒ fail‑closed، ۰ اتصال | BLOCKING | ✅ | §۷ |
| G8 | هیچ ارسال/شماره‌ی عملیاتی/ادعای موجودی؛ DEMO برچسب‌دار و ماندگار‌نشدنی | BLOCKING | ✅ | `release-journey.spec`، `inquiry.spec` |
| G9 | حقوق منبع بیرونی: پیش‌فرض link‑only | BLOCKING | ✅ | §۶ |
| G10 | CSP با nonce، ۰ نقض در e2e | HIGH | ✅ | §۷ |
| G11 | هدف لمسی ≥۴۴px در مسیرهای اصلی ۳۹۰px | HIGH | ✅ (استثنا: پیوند درون‌متنی «این‌جا» در `/compare` و skip‑link پنهان) | §۴ |
| G12 | Firefox / WebKit | HIGH | ⬜ **NOT VERIFIED** | §۵ |
| G13 | صفحه‌خوان واقعی، گوشی واقعی، کیبورد مجازی واقعی | HIGH | ⬜ **NOT VERIFIED** (انسانی) | §۴ |
| G14 | مدل زنده (grounding/tool‑calling با مدل واقعی) | HIGH | ⬜ **NOT VERIFIED** — برای فاز ۱۰B | `docs/live-ai-trial-runbook.md` |
| G15 | منبع سازنده‌ی زنده (Soundcore) | OPTIONAL | ⛔ مسدود (Cloudflare 403؛ دور زده نشد) | §۶ |
| G16 | Lighthouse | OPTIONAL | ⬜ نصب نشد | — |
| G17 | استقرار عمومی | HIGH (فاز ۱۰A) | ⬜ میزبان تأییدنشده | §۹ |
| G18 | ویدیوی ۵ دقیقه‌ای | BLOCKING برای تحویل نهایی | ⬜ ضبط نشده؛ اسکریپت: `docs/demo-script.md` | — |

## ۲. اجرای مستقل مجدد (۲۰۲۶‑۱۰‑۲۲، هم‌زمان با این فاز)
| دستور | نتیجه | زمان آغاز |
|---|---|---|
| `npx tsc --noEmit` | ✅ exit 0 | 18:41:13+03:30 |
| `npm run lint` | ✅ exit 0 (بدون هشدار) | |
| `npm test` (Vitest) | ✅ ۸۵۱ تست / ۵۷ فایل (فاز ۹: ۸۴۵/۵۶) | |
| `npm run db:verify` | ALL CHECKS PASSED؛ sha256 دیتابیس = مرجع قبل از فاز | 18:34:55+03:30 |
| `npm run build` (standalone) | ✅ | 18:36 |
| `npx playwright test` (Chromium سیستمی) | اجرای کامل نهایی (۱۸:۴۱–۱۸:۴۳:۴۹، ۳۸۲ تست): **۳۷۹ موفق، ۲ skip، ۱ ناموفق** — `a11y.spec` «mission states @1440» (`document-title` روی mission-visit؛ یک‌بار دیده شد). تکرار ×۵ (۱۰ اجرا در ۲ اندازه) همه سبز؛ علت محتمل: تأخیر یک‌تیک عنوان پس از ناوبری کلاینت. helper با انتظار برای عنوان سخت‌تر شد و `a11y.spec`+`keyboard.spec` (۹ تست) سبز شد؛ **اجرای کامل ۳۸۲‌تایی پس از این اصلاح تکرار نشده است**. اجرای قبلی همین روز (پیش از دو تست فوکوس/کیبورد): ۳۷۸ موفق، ۲ skip، ۰ ناموفق | |
| `npm run agent:eval` | ۸۰/۸۰ سناریو، `externalCalls=0`، `costUsd=0`، p50 14ms / p95 46ms | 18:39:25 |
| Docker `compose up --build app` | `/api/health` 200 `{"status":"ok"}` · `/api/ready` 200 · healthcheck = healthy · CSP با nonce متفاوت در هر درخواست | 18:39:57 |

**Skipهای واقعی (برچسب‌نخورده):** ۲ — (الف) `smoke.spec`: «فقط وقتی DB نیست» (DB هست ⇒ بی‌موضوع)؛ (ب) `evidence.spec`: تست `live` شواهد، فقط با `HAMGHADAM_LIVE_EVIDENCE_E2E=1` و سرور live (اجرا نشد؛ NOT VERIFIED).
در اجرای میانی فاز قبل، ۱۶ تست `inquiry.spec` قرمز شده بودند (پیش از اصلاح UI مرحله‌ای/هلپر)؛ در اجرای کامل نهایی همه سبز است.

## ۳. نقشه‌ی پوشش لبه‌ها (واقعی؛ بدون ادعای بیش از تست)
| سناریو | تست |
|---|---|
| کالای معلوم (مدل دقیق) | `journeys.spec:138`، `release-journey.spec` (hdw1200clqp) |
| کالای نامطمئن / «مطمئن نیستم» | `journeys.spec:109,117` |
| صفر نتیجه + بازیابی کارا | `journeys.spec:128`، `search`: املا/stop‑word `journeys.spec:157` |
| قیمت پرت | `compare.spec:122` (دو رکورد مشکوک نشان‌داده، کنار گذاشته، ادعا مشروط) |
| variant نامطمئن | `compare.spec:145`، `journeys.spec:178` |
| واحد قیمت متفاوت (متر/حلقه) | `compare.spec:153` |
| بدون کانال ارتباطی | `inquiry.spec:238` (D) |
| ساعت نامعلوم | `hours-table.test` + چیدمان مقایسه (`compare.spec:291`)؛ متن «ساعت اعلام نشده» |
| قیمت گزارش‌شده‌ی تغییر‌کرده | `inquiry.spec:52` (A) |
| ریست دمو / URL کپی‌شده دمو را باز نمی‌کند | `inquiry.spec:179` |
| بدون GPS / GPS رد | `compare.spec:216,231`، `sellers.spec` (GPS) |
| انتخاب جعلی/نامعتبر | `inquiry.spec:278` (E)، `compare.spec:196` |
| تأیید حذف: فوکوس (جدید) | `keyboard.spec` «destructive confirmation» |
| کیبورد باز (ارتفاع ۳۶۰) بدون سرریز | `keyboard.spec` (جدید؛ شبیه‌سازی با viewport کوتاه، **نه** کیبورد مجازی واقعی) |

## ۴. یافته‌های UX / دسترس‌پذیری / موبایل (Chromium؛ بدون ادعای دستگاه واقعی)
* **رفع‌شده:** هدف لمسی کوتاه‌تر از ۴۴px در لوگوی هدر، «تغییر دسته»، پیوندهای ناوبری `/missions/new` و `/compare`، و پیوند عنوان محصول در `/sellers` (358×۴۰ ⇒ `min-h-11`). ممیزی ۳۹۰px روی ۱۰ مسیر: فقط skip‑link پنهان و یک پیوند درون‌متنی باقی ماند (مستثنا در WCAG 2.5.8).
* **رفع‌شده:** تأیید حذف (هاب و تب دستگاه) فوکوس را به «انصراف» (پیش‌فرض امن) می‌برد و با لغو به دکمه‌ی آغاز برمی‌گرداند.
* **موجود از پیش:** axe ۲۸ مسیر × ۲ اندازه ۰ serious/critical؛ کیبورد‑فقط چهار مرحله؛ نواحی `aria-live`؛ بدون سرریز افقی در ۵ اندازه؛ شیت نقشه/ترک فوکوس در تست‌های `sellers.spec`.
* **NOT VERIFIED:** صفحه‌خوان واقعی (NVDA/VoiceOver/TalkBack)، لمس واقعی، موقعیت کیبورد مجازی روی iOS/Android، `visualViewport` واقعی. چک‌لیست دستی: `docs/qa/README.md`.
* **حریم/مجوز:** ذخیره‌ی دستگاه فقط با opt‑in؛ حذف کامل (هاب) سشن/ایندکس‌دی‌بی را پاک می‌کند؛ مختصات دقیق در URL/ذخیره‌سازی نمی‌رود (تست‌شده).
* **محیط کارایی:** Intel i5‑14450HX، ۱۶ رشته، ۱۵GB RAM، Node 24.19، Fedora، Chrome سیستمی، سرور محلی `next start`/standalone، DB SQLite ۲۲۵٬۹۰۳ محصول / ۶٬۴۷۶ فروشگاه / ۳۳۱٬۵۰۶ پیشنهاد. اعداد (`docs/qa/perf-profile.json`، `browser-perf.json`) نمایانگر **این ماشین** هستند، نه میزبان تولید یا شبکه‌ی موبایل.

## ۵. Firefox / WebKit — درخواست مجوز (**اجرا نشد؛ NOT VERIFIED**)
وضعیت: نه Firefox و نه WebKit از Playwright نصب نیستند. دانلود نشد.

| مورد | مقدار (اندازه‌گیری با HEAD، فقط‌خواندنی) |
|---|---|
| Firefox (Playwright build) | ≈ ۱۱۶٬۳۷۷٬۶۳۹ B (~۱۱۱ MiB) |
| WebKit | ≈ ۱۰۸٬۱۲۲٬۷۳۹ B (~۱۰۳ MiB) |
| ffmpeg | ≈ ۲٬۳۰۲٬۷۰۱ B |
| فضای دیسک پس از باز‌کردن | حدود ۲–۳ برابر دانلود؛ زیر `~/.cache/ms-playwright` |
| دستور (فقط پس از تأیید) | `npx playwright install firefox webkit` و `sudo npx playwright install-deps firefox webkit` (وابستگی‌های Fedora/dnf ممکن است لازم شود: بسته‌های GTK/gstreamer/woff2/enchant/… که Playwright گزارش می‌کند؛ نصب سیستمی ⇒ تأیید جدا) |
| انتخاب تست | `npx playwright test --project=firefox --project=webkit e2e/smoke.spec.ts e2e/release-journey.spec.ts e2e/a11y-routes.spec.ts e2e/keyboard.spec.ts e2e/security.spec.ts` (نیازمند افزودن projectها به `playwright.config.ts`؛ با زیرمجموعه‌ی بالا، نه کل ۳۸۰ تست) |
| ریسک | WebKit روی Fedora ممکن است کتابخانه‌ی کم داشته باشد؛ نتیجه‌ی قرمز = یافته، نه ادعای سبز |

## ۶. بازبینی حقوق منابع بیرونی و نقشه
* **Scarbir (K20i):** robots.txt مجوز بازنشر **نیست**. شرایط استفاده/مجوز صریح برای بازتولید متن پیدا نشد ⇒ **حقوق نامشخص** ⇒ پیش‌فرض تولید = **link‑only**: بدون fetch، بدون بازتولید نقل/خلاصه؛ فقط پیوند برچسب‌دار + fallback «دیدگاه‌های کاربران یافت نشد». بازتولید فقط با `AGENT_EVIDENCE_REPRODUCE=1` (opt‑in مالک پس از بازبینی حقوقی) و همیشه با ارجاع کوتاه/مبدأ/زمان.
* **Soundcore:** مسدود (`access.state="blocked"`)؛ به‌کار گرفته نمی‌شود، دور زده نمی‌شود.
* **fixtureها:** `tests/fixtures/evidence/*` اکنون **ساختگی و فقط تست** (بدون عبارت‌های شخص ثالث). `docs/qa/external-evidence-live-check.json` link‑only بازتولید شد؛ تصویر نمونه‌ی قبلی حذف شد.
* **هر ادعای بیرونی** دارای: مبدأ، زمان بازیابی، نوع شاهد، وضعیت تطبیق، ارجاع، `linkOnly`. شواهد تورب همیشه مقدم است.
* **OSM:** سرور community `tile.openstreetmap.org` برای دمو/توسعه قابل قبول با attribution (پیوند «© OpenStreetMap») است؛ سیاست کاشی OSM بار سنگین/تولید را نمی‌پذیرد ⇒ **قبل از استقرار عمومی** باید ارائه‌دهنده‌ی کاشی تأییدشده (یا میزبانی خودی/سرویس تجاری) انتخاب شود. نیاز دارد: ارائه‌دهنده + شرایط + کلید (اگر لازم). `src/lib/map-config.ts` اکنون provider‑neutral است (`attributionHtml`، `tileImgSources`، الگوی `{s}`) و CSP `img-src` فقط از میزبان کاشی پیکربندی‌شده مشتق می‌شود؛ هیچ میزبان تأییدنشده‌ای به CSP اضافه نشد. شرایط OSM باید در روز راه‌اندازی دوباره خوانده شود (از این نشست بازبینی زنده‌ی صفحه‌ی سیاست انجام نشد ⇒ **NOT VERIFIED** در سطح متن فعلی).

## ۷. امنیت (بازبینی کد) و CSP
| محور | یافته |
|---|---|
| **SSRF** | `safeFetchText`: فقط `https`، allowlist رجیستری بازبینی‌شده، فقط پورت ۴۴۳ و بدون credentials، بلوک IP خصوصی/loopback/link‑local/reserved (روی هر آدرس resolve‌شده)، redirect دستی ≤۲ با اعتبارسنجی مجدد هر گام، سقف اندازه/زمان؛ پیش‌فرض link‑only ⇒ اصلاً fetch نمی‌شود |
| **CSRF / origin** | `POST /api/agent/turn`: `isCrossSite` (Origin/Sec‑Fetch‑Site)، `content-type: application/json` اجباری، سقف بدنه؛ بدون کوکی/نشست سروری ⇒ سطح CSRF کوچک. محدودیت: درخواست بدون Origin/Sec‑Fetch‑Site (کلاینت غیرمرورگری) رد نمی‌شود؛ حفاظت آن‌ها حد نرخ و سقف‌هاست |
| **اعتبارسنجی state** | وضعیت گفت‌وگو را کلاینت نگه می‌دارد؛ سرور هر نوبت با zod strict + بررسی DB دوباره اعتبارسنجی می‌کند؛ مبدأ خارج تهران snap/رد |
| **Grounding** | مدل/mock فقط عبارت‌بندی می‌کند؛ اعداد/شناسه‌ها از ابزار؛ validator ادعای ناموجود/موجودی/ارسال را رد می‌کند (۸۰ سناریو، ۱۲ خصمانه) |
| **ذخیره‌ی کلاینت** | zod strict + `rev` compare‑and‑set؛ رکورد مسموم رد؛ opt‑in برای IndexedDB |
| **allowlist خروجی** | مدل: فقط یک `AGENT_BASE_URL` و **قفل کد**؛ شواهد: رجیستری کد. (allowlist مدل/میزبان سخت‌گیرانه‌تر و ledger قبل از ۱۰B باید اضافه شود؛ `docs/live-ai-trial-runbook.md` §۲) |
| **ریداکشن لاگ** | `redact()` کلید را از هر لاگ/خطا حذف می‌کند؛ `agentLog` بی‌محتوا (بدون متن کاربر/نتیجه‌ی ابزار) |
| **rate limit چند‑instance** | حد نرخ، سقف هم‌زمانی و کش شواهد **درون‌پردازه‌ای**اند ⇒ با N replica سقف مؤثر ≈ N× است؛ برای تولید چند‑replica نیاز به store مشترک یا نرخ‌دهی در proxy (مستند، ساخته نشده) |
| **CSP** | `src/proxy.ts` برای هر درخواست nonce می‌سازد: `script-src 'self' 'nonce-…' 'strict-dynamic'`، `object-src 'none'`، `frame-ancestors 'none'`، `connect-src 'self'`؛ `style-src` هنوز `'unsafe-inline'` (Leaflet/Tailwind inline style) — باقی‌مانده‌ی مستند. `layout.tsx` `force-dynamic` است (nonce ⇒ رندر پویا؛ هزینه‌ی کش استاتیک). zod با `jitless` (بدون eval). تست‌ها: `csp.test.ts`، `security.spec.ts` (nonce متفاوت، ۰ نقض) |
| **شواهد ۰ فراخوانی مدل** | (۱) قفل در کد؛ (۲) آداپتور بدون `fetch` واقعی throw می‌کند؛ (۳) `vitest.setup.ts` fetch را مسدود می‌کند؛ (۴) **آزمایش محلی ۲۰۲۶‑۱۰‑۲۲:** سرور standalone با `AGENT_PROVIDER=openai-compatible` + `AGENT_BASE_URL=http://127.0.0.1:9099/v1` (سینک محلی) + کلید ساختگی + approval + سقف‌ها ⇒ ۳ درخواست = ۳×HTTP 503 `AGENT_LIVE_LOCKED`، `/api/agent/status` = `enabled:false`، **اتصال به سینک = ۰**؛ (۵) Docker پیش‌فرض mock است و کلید عبور نمی‌دهد |

## ۸. شکاف‌ها
**بحرانی (قبل از ویدیو/انتشار):** ضبط ویدیو؛ تصمیم میزبان؛ تصمیم کاشی نقشه؛ بازبینی حقوقی Scarbir (یا ماندن در link‑only).
**موکول‌شونده:** Firefox/WebKit؛ صفحه‌خوان و گوشی واقعی؛ Lighthouse؛ چندکالایی (P1)؛ منبع سازنده‌ی زنده؛ `style-src` بدون `unsafe-inline`؛ حد نرخ مشترک؛ آزمایش مدل زنده.

## ۹. پیش‌نیازهای فاز ۱۰A (استقرار) — **میزبان تأییدنشده**
میزبان + DNS/TLS/reverse proxy · اسرار فقط در env سرور · volume داده (importer ⇒ DB ≈ ۲۷ ثانیه) و `:ro` برای app · انتخاب/تأیید کاشی و به‌روزرسانی `map-config` · `AGENT_PROVIDER=mock` یا `disabled` (بدون ادعای مدل) · `AGENT_EVIDENCE_MODE=off|fixture` (بدون `live`) · مانیتورینگ/لاگ · smoke پس از استقرار با `release-journey.spec` علیه URL · تصمیم تعداد replica و حد نرخ · پشتیبان DB (بازسازی‌پذیر).

## ۱۰. فاز ۱۰B (مدل زنده) — **اجرا نشد**
طرح کامل، سقف‌ها، handshake تأیید، rollback: `docs/live-ai-trial-runbook.md` و `docs/phase-10-live-trial-plan.md`. مستندات رسمی BoxAPI/قیمت‌ها از جست‌وجوی عمومی **پیدا نشد** ⇒ هیچ قیمت/مدلی ساخته نشد.

## ۱۱. تأییدهای لازم از مالک
۱) میزبان استقرار · ۲) دانلود Firefox/WebKit (+ وابستگی‌های سیستمی) · ۳) ارائه‌دهنده‌ی کاشی نقشه · ۴) بازبینی حقوقی/تصمیم برای بازتولید متن Scarbir · ۵) لینک رسمی مستندات/قیمت BoxAPI + سقف دلار + تأیید سهم از ۶ دلار مشترک + پیام handshake · ۶) تست انسانی صفحه‌خوان/گوشی · ۷) اجازه‌ی ضبط ویدیو/انتشار URL.
