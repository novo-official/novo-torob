# ماتریس rubric ۳۰۰ امتیازی ← ویژگی ← تست ← شواهد دمو

> **هیچ امتیازی ادعا نمی‌شود.** فقط مجموع هر محور (۷۵/۷۵/۵۰/۴۰/۴۰/۲۰) از مالک پروژه گرفته شده؛ زیرمعیارها و وزن‌هایشان در دسترس نیست و اینجا ساخته نشده است. ستون «وضعیت» فقط می‌گوید چه چیزی **واقعاً ساخته و اجرا شده**.
>
## محصول — ۷۵
> راهنما: ✅ پیاده‌شده و تست‌شده · 🟡 جزئی/قالب · ⬜ شروع نشده. وضعیت به‌روز در پایان **فاز ۹**.

| قابلیت | مرحله | وضعیت | تست/شاهد | شاهد دمو (آینده) |
|---|---|---|---|---|
| دو ورودی «کمکم کن انتخاب کنم» / «مدل محصول رو می‌دونم» که به یک محصول قابل‌انتخاب می‌رسند | M1 | ✅ تست‌شده با داده‌ی واقعی | `journeys.spec` (سفر بی‌مدل ×۳ اندازه، سفر با مدل) | ضبط هر دو مسیر |
| مشاور نیاز‌محور (≤۲ پرسش + بودجه)، ۵ دسته‌ی دارای پرسش تخصصی + مشاور عمومی | M1 | ✅ | `real-advisor.test` ×۳۶ | سفر هدفون/دوربین/موتور برق |
| پیشنهاد با دلیل و شاهد نقل‌شده؛ بدون امتیاز کیفیت/محبوبیت ساختگی | M1 | ✅ | تست ۱۳ و ۱۹ در `real-advisor.test` | بخش «چرا پیشنهاد شد؟» |
| تغییر ترجیحات/بودجه بدون شروع دوباره؛ بازیابی بدون‌نتیجه | M1 | ✅ | `journeys.spec` (بودجه، بازیابی، Back/refresh) | — |
| مقایسه‌ی ۲–۴ محصول با شاهد و عدم‌قطعیت | M1 | ✅ | `compare` در `real-advisor.test`؛ `journeys.spec` | — |
| هویت نسخه/واحد قیمت در صفحه‌ی محصول، انتقال `Selection` به فاز ۴ | M1→M2 | ✅ (فقط انتقال؛ فروشنده‌ها در فاز ۴) | `variants.test`، تست‌های «identity honesty» | — |
| یافتن فروشنده‌ی نزدیک (join واقعی offer، نسخه، فاصله، نقشه/فهرست، جزئیات فروشگاه، بازیابی منطقه) | M2 | ✅ | `real-sellers.test` ×۲۲، `sellers-api.test`، `sellers.spec` (۵۱) | ضبط مسیر کالا→فروشگاه‌های اطراف→نقشه→فروشگاه |
| مقایسه‌ی فروشنده (سطح هویت A–D، قیمت قابل‌اتکا، حکم مشروط/بدون‌برنده، اولویت‌ها، ساعت در زمان بازدید، پرداخت/گارانتی، بودجه سه‌حالته) | M3 | ✅ (heuristic هویت؛ تأیید نسخه با فروشنده) | `engine.test` ×۵۷، `real-compare.test` ×۱۲، `compare-sellers-api.test`، `compare.spec` (۳۹) | ضبط سه‌ مسیر: حکم مشروط داهوا، ناهم‌خوانی کابل، بدون‌برنده |
| پرسش و پیگیری از فروشنده: زمینه‌ی سرور‌ساخت، پرسش دسته‌آگاه، پیگیری دستی، ثبت پاسخ، تفسیر مبلغ، جمع‌بندی و گام بعد | M4 | ✅ (بدون ارسال/تماس؛ پاسخ دستی = «گزارش شما») | `inquiry.test` (domain)، `inquiry-context.test` (DB واقعی)، `inquiry-workspace.test`، `inquiry.spec` | ضبط ردگیری «تغییر قیمت» |
| حالت «شبیه‌سازی پاسخ فروشنده — فقط دمو» (۶ سناریو، برچسب روی هر پیام، فقط حافظه) | M4 (دمو) | ✅ | `inquiry.spec` B/C، `inquiry-workspace.test` | ضبط ردگیری «ناموجود» با برچسب |
| پیش‌نویس سؤال + ثبت دستی پاسخ + وضعیت ماموریت | M4 | ✅ محلی (فاز ۱) | `seller-qa.test` ×۵، `smoke.spec: mission Q&A` | ضبط جریان پرسش |
| دموی ~۵ دقیقه‌ای | الزام | ⬜ | — | فاز ۶ |

## UX/UI — ۷۵
| قابلیت | وضعیت | تست/شاهد |
|---|---|---|
| RTL بومی، `lang=fa`، اعداد فارسی، ایزوله‌سازی نام‌های لاتین | ✅ | `smoke.spec`؛ `format.test` |
| موبایل‌اول، بدون سرریز افقی در ۳۶۰/۳۹۰/۷۶۸/۱۴۴۰ روی ۱۴ صفحه/حالت | ✅ | `screens.spec` (۵۶ مورد) + `docs/qa/` |
| یک سؤال متمرکز در هر گام، نوار پیشرفت (`role=progressbar`)، «مطمئن نیستم»، «نتایج همین حالا» | ✅ | `journeys.spec` |
| وضعیت در URL؛ refresh/Back چیزی را گم نمی‌کند | ✅ | `journeys.spec: preferences survive refresh and Back` |
| حالت‌های بارگذاری (اسکلت)، خالی، بدون‌نتیجه، خطا، «داده در دسترس نیست»، ۴۰۴ محصول | ✅ | `smoke.spec`، `journeys.spec`، `loading.tsx`/`error.tsx` |
| جست‌وجوی typeahead (combobox/listbox، پیکان‌ها/Enter/Esc) | ✅ | `journeys.spec: search…` |
| صفحه‌کلید: انتخاب پاسخ با Tab+Enter | ✅ | `journeys.spec: keyboard only` |
| حرکت: ورود با CSS خالص؛ Motion فقط برای تعامل؛ احترام به `prefers-reduced-motion` | ✅ | `journeys.spec: reduced motion` |
| مقایسه‌ی ۲–۴ محصول: جدول در دسکتاپ، بلوک‌های متوالی در موبایل | ✅ | `screens.spec` |
| حالت تاریک | 🟡 توکن‌ها هست؛ بازبینی بصری نشده | — |
| کنتراست AA / axe | 🟡 axe-core خودکار روی `/assistant` (۸ حالت ×۲ اندازه) و خانه: بدون نقض serious/critical؛ **صفحه‌خوان تست نشد**؛ سایر صفحه‌ها axe نشدند | `e2e/a11y.spec.ts` |
| bottom sheet (جزئیات فروشگاه/منطقه روی نقشه) | ✅ | `sellers.spec` |
| نقشه + فهرست، نشانگرهای متمایز، حالت بدون کاشی | ✅ | `nearby-map.test`, `sellers.spec` |
| GPS اختیاری (رد/پشتیبانی‌نشدن/بدون مختصات در URL) | ✅ | `gps.test`, `sellers.spec` |

## هوشمندی — ۵۰
| قابلیت | وضعیت | شاهد |
|---|---|---|
| مشاور قطعی (بدون LLM): سخت/نرم، جریمه‌ی نبود شاهد، کدهای دلیل | ✅ | `real-advisor.test`، `docs/phase-3-advisor.md` |
| جست‌وجوی فارسی: نرمال‌سازی، stop-word، مترادف (اعتبارسنجی‌شده با واژگان داده)، ترکیب/جداسازی کلمه، تصحیح املا، رتبه‌بندی قطعی | ✅ | `analyze.test`, `rank.test`, `real-search.test` (۳۰) |
| ارزیابی با برچسب‌های جدا (ساخت‌شده / تعریف دستیار / قضاوت دستی) | ✅ — اعداد در `docs/phase-3-evaluation.md` (نمونه‌های کوچک؛ ادعای دقت کلی نمی‌شود) | `npm run eval` |
| استخراج صفت سه‌حالته با شاهد و تشخیص تناقض عنوان/مشخصات | ✅ | `schemas.test` (۳۶) |
| ابزار تایپ‌شده `adviseProducts` (Route Handler) برای فاز ۷ | ✅ | `api.test` |
| اورکستریتور عامل، ۱۲ ابزار تایپ‌شده، اعتبارسنج grounding، fallback قطعی (فاز ۷) | ✅ تست‌شده با **mock قطعی** | `src/server/agent/*.test`، `docs/phase-7-agent.md` |
| مدل زبانی واقعی | 🟡 آداپتور OpenAI‑سازگار نوشته و با fetch ساختگی تست شد؛ **NOT LIVE VERIFIED** (هیچ تماس پولی) | `config.test` |
| شواهد بیرونی (مشخصات/نظر) | 🟡 قرارداد + fixture برچسب‌دار + `safeFetch` ضد SSRF + آداپتور سازنده با HTML ساختگی؛ **EXTERNAL LIVE RETRIEVAL NOT VERIFIED** | `evidence.test` |
| ارزیابی ۴۸ سناریو (mock؛ زنده اجرا نشد) | ✅ ۴۸/۴۸ | `npm run agent:eval`، `docs/qa/agent-eval-mock.json` |
| پرسش‌نامه‌ی قطعی فارسی برای فروشنده | ✅ | `seller-questions.test` |

## استقرار — ۴۰
| قابلیت | وضعیت |
|---|---|
| ساخت و اجرای محلی (`npm run build && npm start`) | ✅ |
| Docker + volume SQLite + health/ready (اجرای محلی) | ✅ فاز ۲؛ **در فاز ۳ دوباره اجرا شد**: ساخت image، importer، `/api/ready`، `/api/search`، `/api/advisor`، `/discover`، `/products/<id>` و ۴۰۴ محصول ناموجود همگی درست و container سالم (healthy) |
| استقرار بیرونی | ⬜ منتظر اجازه‌ی مالک |

## پیاده‌سازی فنی — ۴۰
| قابلیت | وضعیت | شاهد |
|---|---|---|
| TypeScript strict + `noUncheckedIndexedAccess` | ✅ | `npm run typecheck` |
| ESLint (+ قانون جداسازی کد سرور از کلاینت) | ✅ | `npm run lint` |
| تست واحد/کامپوننت/یکپارچه | ✅ ۸۴۵ تست (۵۶ فایل) | `npm test` |
| تست e2e چند-viewport | ✅ ۲۲۹ موفق + ۱ skip عمدی | `npm run test:e2e` |
| Route Handler با zod؛ سقف limit/offset؛ no-store | ✅ | `api.test` (۱۱) |
| معماری ماژولار: دامنه‌ی خالص + سرویس‌های مشترک بین صفحه و API | ✅ | `architecture.md` |
| پایگاه داده + مهاجرت‌ها (۲) | ✅ | `db:verify` |

## دیتاست — ۲۰
| قابلیت | وضعیت | تست/شاهد |
|---|---|---|
| ممیزی کامل دیتاست (فاز ۰) و ثبت محدودیت‌ها | ✅ سند + صفحه‌ی `/data` | `docs/requirements.md`, `/data` |
| import کامل سه CSV به SQLite (۶٬۴۷۶ / ۲۲۵٬۹۰۳ / ۳۳۱٬۵۰۶، ۰ یتیم) | ✅ **اجرا و تست‌شده** | `npm run db:verify` (۲۰ بررسی PASS روی DB واقعی)، `import.test.ts` |
| حفظ offerهای متفاوت، خام‌ها، قیمت خالی/زمان خالی | ✅ | `db:verify` (۹٬۵۵۷ جفت، ۱٬۸۱۸ تکراری دقیق، ۱۵٬۰۸۳ NULL، ۷۶۹ زمان خالی)، `import.test.ts` |
| پرچم‌های کیفیت قابل‌توضیح با نسخه‌ی قواعد | ✅ (دقت مدل: نمونه‌ی دستی ≈۱۷/۲۰، نه benchmark) | `docs/phase-2-data.md` §۵ |
| ساعت کاری سه‌حالته (placeholder، شیفت دوم، جمعه، شب‌گذر، تهران) | ✅ تست‌شده (شب‌گذر فقط با fixture/واحد؛ در داده‌ی واقعی موردی نیست) | `hours.test.ts` (۲۳)، `import.test.ts` |
| import idempotent / crash-safe / ZIP امن | ✅ | اثر انگشت یکسان ×۲، SIGINT واقعی، ۱۰ تست |
| FTS5 فارسی + R-Tree + مخزن‌های خواندنی محدود | ✅ پایه (بدون تصحیح املا) | `import.test.ts`, `db:verify` |
| UI جست‌وجو و نقشه‌ی فروشنده‌ها روی داده‌ی واقعی | ✅ فاز ۳ و ۴ | `docs/phase-4-sellers.md` |
| مناطق خرید: ۳ مورد منبع‌دار + ۱۱۷ برآورد تراکم | ✅ (پوشش گسترده‌ی بورس‌ها → فاز ۷) | `areas.test` |

## استقرار — به‌روزرسانی فاز ۲
> فاز ۴: Docker دوباره اجرا و مسیرهای `/sellers`, `/api/sellers`, `/api/areas`, ۴۰۴ فروشگاه تأیید شد؛ کاشی OSM برای بار تولید NOT VERIFIED.

| قابلیت | وضعیت | شاهد |
|---|---|---|
| Dockerfile + compose + volume SQLite + healthcheck | ✅ **اجرا و تأیید محلی** (image ‏۳۸۴ MB، non-root، read-only، `/api/ready` 200، restart با حفظ داده) | `docs/deployment.md` |
| استقرار بیرونی (staging/production) | ⬜ **انجام نشده**، نیازمند اجازه‌ی مالک | — |

## فاز ۵ — افزوده‌ها
| قابلیت | وضعیت | شاهد |
|---|---|---|
| قرارداد شواهد بیرونی (نظر ≠ ادعا ≠ موجودی) + اعتبارسنج | ✅ تعریف و تست (بدون بازیابی) | `provenance.test` ×۹ |
| درز تأمین‌کننده‌ی کاشی نقشه | ✅ `map-config` + مستند سیاست OSM؛ **انتخاب تولیدی باز (فاز ۱۰)** | `map-config.test`، `docs/phase-5-compare.md` §۷ |
| جدول مقایسه با ستون چسبان، بدون سرریز صفحه | ✅ ۳۶۰/۳۹۰/۷۶۸/۱۴۴۰ | `compare.spec` layout، `docs/qa/compare-*.png` |
| Docker فاز ۵ | ✅ build + `/compare` + `/api/compare/sellers` + `/missions/new` روی container سالم | اجرای دستی |

## فاز ۶ — افزوده‌ها
| قابلیت | وضعیت | شاهد |
|---|---|---|
| مرز اعتماد DATASET_RECORDED / USER_REPORTED / DEMO_SIMULATED / UNKNOWN در UI و حالت | ✅ | `provenance-badge`, `inquiry.test` |
| بدون ارسال/تماس/شماره: ردیابی شبکه + اسکن ۲۰۰ فروشگاه | ✅ | `inquiry.spec` (assertNoSend)، `inquiry-context.test` ۰۷ |
| جعل URL (offer/shop/product/variant) | ✅ ۶ حالت + انتخاب offer | `inquiry.spec` E |
| Docker فاز ۶ | ✅ | اجرای دستی |
| دسترس‌پذیری: axe/صفحه‌خوان | 🟡 axe فقط برای دستیار/خانه در فاز ۷؛ صفحه‌خوان ⬜ | `docs/qa/README.md` |

## فاز ۷ — افزوده‌ها
| قابلیت | وضعیت | شاهد |
|---|---|---|
| دستیار گفت‌وگومحور برای هر چهار مرحله‌ی رسمی (`/assistant`) روی سرویس‌های قطعی | ✅ mock | `e2e/assistant.spec` (دموی A/B/C)، `orchestrator.test` |
| «داده‌ی رسمی اول»: شاهد بیرونی فقط با کد مدل دقیق و opt-in؛ تعارض گزارش می‌شود نه ادغام | ✅ | `evidence.test`، سناریوهای S20–S23، S46 |
| «در نمونه نیست» ≠ «در تهران نیست»؛ بازیابی با منطقه‌ی منبع‌دار | ✅ | S17، دموی B |
| امنیت: CSRF، rate-limit، concurrency، اندازه، state strict، injection | ✅ | `agent-api.test`، `state.test`، corpus |
| رفع باگ فاز ۶ (`deriveOutcome` با پاسخ بدون موجودی/قیمت) | ✅ | `inquiry.test` |
| دسترس‌پذیری، سه دمو، Docker (mock/disabled/fixture) | ✅ محلی | `docs/phase-7-agent.md` §۱۲–۱۳ |
| استقرار بیرونی / مدل زنده / منبع بیرونی زنده | ⬜ **NOT VERIFIED** | — |


## فاز ۸ — افزوده‌ها
| قابلیت | وضعیت | شاهد |
|---|---|---|
| ماموریت ماندگار با رضایت صریح، حذف کامل، بدون سرور | ✅ | `mission-store.test`، `missions-storage.spec` |
| فهرست آمادگی و زمان مراجعه (وقت تهران، ساعت اعلام‌شده، نامعلوم≠بسته) | ✅ | `mission.test`، `missions.spec` |
| بازیابی قطعی با شناسه‌ی واقعی (ناموجود/قیمت/مدل/بی‌پاسخ/خارج از ساعت/گارانتی) | ✅ | `recovery.test`، `missions.spec` ×۳ ماموریت |
| جداسازی کامل شبیه‌سازی از ماموریت و ذخیره‌سازی | ✅ | `missions.spec` (demo isolation) |
| رکورد مسموم/جعلی/دو تب/رقابت | ✅ | `missions-storage.spec` |
| axe روی حالت‌های ماموریت | ✅ (صفحه‌خوان ⬜) | `a11y.spec` |
| چندکالایی (P1)، مدل زنده، منبع بیرونی زنده | ⬜ NOT VERIFIED / موکول | — |


## فاز ۹ — افزوده‌ها
| قابلیت | وضعیت | شاهد |
|---|---|---|
| سفر انتشار ۴ مرحله‌ای + ماموریت ماندگار + Back/refresh، با کیبورد | ✅ | `release-journey.spec`، `keyboard.spec` |
| `/missions/new` موبایل: ۶٬۹۹۹px → ۲٬۵۰۷px (تب‌های مرحله‌ای) | ✅ | `docs/phase-9-quality.md` §۳، `p9-*` |
| axe روی ۲۸ مسیر/حالت × ۲ اندازه: ۰ serious/critical | ✅ (صفحه‌خوان ⬜؛ Firefox/WebKit ⬜) | `a11y-routes.spec` |
| CSP/هدرها، ۰ نقض CSP، XSS/open‑redirect | ✅ | `security.spec` |
| شواهد بیرونی: یک منبع زنده‌ی مستقل واقعی (K20i) با ارجاع/تاریخ/نقل عینی | ✅ (سازنده‌ی زنده ⛔ مسدود) | `reviewed-sources.test`، `external-evidence-live-check.json` |
| قفل مدل زنده در کد؛ ۰ درخواست مدل (تست/e2e/Docker) | ✅ (مدل زنده NOT LIVE VERIFIED) | `config.test`، `agent-api.test`، `vitest.setup.ts` |
| ارزیابی ۸۰ سناریو mock (۳۲ «team-judgment-user-like») | ✅ (مدل زنده ⬜) | `npm run agent:eval` |
| کارایی (p50/p95 روی DB واقعی) و بار مرورگر | ✅ (Lighthouse ⬜) | `docs/qa/perf-profile.json`، `browser-perf.json` |

## فاز ۹.۱ — افزوده‌ها
| قابلیت | وضعیت | شاهد |
|---|---|---|
| منبع شخص‌ثالث link‑only (حقوق نامشخص)؛ fixtureها ساختگی | ✅ | `reviewed-sources.test`، `e2e/evidence.spec` |
| CSP با nonce + `strict-dynamic` | ✅ | `csp.test`، `security.spec` |
| ممیزی هدف لمسی ۳۹۰px؛ فوکوس تأیید حذف | ✅ | `keyboard.spec` |
| کاشی نقشه provider‑neutral + CSP مشتق | ✅ (ارائه‌دهنده‌ی تولید ⬜) | `map-config.test` |
| Runbook آزمایش زنده / اسکریپت دمو | ✅ سند (اجرا ⬜) | `docs/live-ai-trial-runbook.md`، `docs/demo-script.md` |
| Firefox/WebKit، صفحه‌خوان، گوشی واقعی، مدل زنده، استقرار | ⬜ NOT VERIFIED | `docs/phase-9-1-release-readiness.md` |

## فاز ۱۰A — افزوده‌ها
| قابلیت | وضعیت | شاهد |
|---|---|---|
| اجرای کامل پس از اصلاح + لاگ بازتولیدپذیر | ✅ | `scripts/release-gate.sh` → `docs/qa/release-gate-latest.txt` |
| محافظ POST (cross‑site/نوع/اندازه/نرخ) و اعتماد به XFF فقط پشت proxy | ✅ | `sellers-api.test`, `guard.test`, `gate-b-proof.json` |
| محافظ درخواست زنده (قفل) + دست‌دادن زمان‌دار | ✅ ساخته؛ ⬜ اجرا | `live-guard.test` |
| تمرین دمو (mock) و آزمون عنوان/اعلام‌گر | ✅ | `demo-rehearsal.spec`, `title-nav.spec` |
| بستهٔ استقرار و الگوها | ✅ سند؛ ⬜ استقرار | `docs/deployment-packet.md`, `deploy/` |
| صفحه‌خوان/گوشی/Firefox/WebKit/مدل زنده | ⬜ NOT VERIFIED | `docs/qa/human-test-protocols.md` |
