# معماری

## ۱. تصمیم کلی: مونولیت ماژولار
یک اپلیکیشن Next.js (App Router, TypeScript strict) با مرزهای دامنه‌ای صریح. دلیل: تیم/زمان کوچک، استقرار ساده (یک فرایند)، تست‌پذیری، و امکان استخراج بعدی سرویس‌ها.

```
src/
  app/            # مسیرها، layout، UI صفحه‌ها (لایه‌ی ارائه)
  components/     # اجزای UI مشترک (Button, Card, EmptyState, …)
  domain/         # انواع و منطق خالص (بدون وابستگی به UI/DB)
    types.ts            # قراردادهای داده
    tools.ts            # رابط ابزارهای عامل (طراحی)
    mission-state.ts    # ماشین حالت ماموریت (پیاده‌شده و تست‌شده)
    seller-questions.ts # تولید پیش‌نویس پرسش (قطعی، محلی)
    errors.ts           # کدهای خطای قرارداد
  lib/            # قالب‌دهی فارسی، ابزارهای کمکی
```

فازهای بعد:
```
  server/
    db/            # SQLite + مهاجرت‌ها + import
    search/        # نرمال‌سازی فارسی، FTS5
    services/      # پیاده‌سازی ابزارها (قطعی)
    agent/         # اورکستریتور LLM + adapter ارائه‌دهنده
  app/api/         # قراردادمحور (OpenAPI/zod)
```

## ۲. مرزهای دامنه (bounded contexts)
| دامنه | مسئولیت | وابستگی |
|---|---|---|
| Catalog | محصول، variant، دسته، مشخصات | — |
| Offers | offer خام، واحد قیمت، پرچم‌های کیفیت | Catalog, Shops |
| Shops | موقعیت، ساعت، پرداخت، منشأ داده | — |
| Geo | فاصله، منطقه، پوشش | Shops |
| Advisor | سؤال‌ها، کاندیدا، دلایل | Catalog, Offers |
| Comparison | رتبه‌بندی قابل‌توضیح | Offers, Shops, Geo |
| Mission | ماشین حالت، context، Q&A | همه (فقط ارجاع) |

## ۳. قرارداد-محور
انواع در `src/domain/types.ts` و رابط ابزارها در `src/domain/tools.ts` **طراحی‌اند** (پیاده‌سازی ندارند). در فاز ۲ شِمای ران‌تایم (zod) از همین انواع ساخته می‌شود و ورودی/خروجی API در برابرش اعتبارسنجی می‌شود. هر ابزار `Result<T, ToolError>` برمی‌گرداند؛ خطاها کد مشخص دارند (`src/domain/errors.ts`).

## ۴. داده: SQLite + FTS5 (پیشنهاد) و محدودیت‌ها
**چرا SQLite:** ۲۸۵ مگابایت CSV، بیش از ۳۳۱ هزار offer، بدون نیاز به سرویس جدا؛ فایل واحد؛ تست آسان؛ استقرار ساده.

**جست‌وجو (FTS5) و محدودیت‌های فارسی:**
- توکنایزر `unicode61` بدون ریشه‌یابی فارسی؛ باید پیش از ایندکس نرمال‌سازی شود: یکسان‌سازی ی/ي، ک/ك، تبدیل ارقام فارسی/عربی به لاتین، حذف اعراب/کشیده، یکسان‌سازی نیم‌فاصله/فاصله.
- مدل‌های لاتین (`HDW1200CLQP-IL-A`) باید با و بدون خط تیره/فاصله قابل یافتن باشند → ستون کمکی نرمال‌شده + trigram/prefix.
- بدون ریشه‌یابی: «موتورها» ≠ «موتور»؛ جبران با prefix و فهرست مترادف محدود.
- رتبه‌بندی BM25 برای عنوان‌های کوتاه ناپایدار است؛ باید با تطبیق دقیق مدل/برند تقویت شود.
- جغرافیا: ۶٬۴۷۶ مغازه با ایندکس ساده‌ی bounding-box + haversine در حافظه؛ SpatiaLite لازم نیست.

**معیارهای ارتقا به Postgres (آینده):** نیاز به نوشتن هم‌زمان کاربران متعدد؛ بیش از چند میلیون ردیف؛ نیاز به PostGIS؛ جست‌وجوی فازی/embedding با pgvector؛ چندنمونه‌ای شدن سرویس. تا آن زمان SQLite کافی است.

## ۵. لایه‌ی هوش مصنوعی و مرز تأیید قطعی
```
کاربر → [تفسیر نیت: LLM یا قواعد] → برنامه‌ی فراخوانی ابزار
      → [ابزارهای قطعی: جست‌وجو، قیمت، فاصله، ساعت] → شواهد ساخت‌یافته
      → [LLM فقط برای عبارت‌بندی] → [اعتبارسنج: هر عدد/نام در پاسخ باید در شواهد باشد] → پاسخ
```
- **Provider adapter:** رابط `LlmProvider { interpretIntent(); phrase(); }` با پیاده‌سازی‌های: `RulesProvider` (بدون مدل، پیش‌فرض)، `LocalProvider` (ollama؛ نیازمند تأیید دانلود)، `RemoteProvider` (فقط با تأیید هزینه). فاز ۱ هیچ‌کدام را نصب نمی‌کند.
- **قطعی‌ها (هرگز LLM):** مقایسه‌ی قیمت، محاسبه‌ی فاصله، بررسی ساعت کاری، فیلتر variant/واحد، پرچم کیفیت قیمت.
- **اعتبارسنج خروجی:** مبلغ، نام مغازه، فاصله، ساعت و ادعای موجودی در متن نهایی در برابر شواهد بررسی می‌شود؛ مغایرت = رد/بازتولید با قالب.
- **ممنوع:** ادعای موجودی، قیمت جدید، امتیاز کیفیت و پاسخ فروشنده.

## ۶. مرزهای اعتماد
| مرز | قاعده |
|---|---|
| ورودی کاربر | داده است؛ دستور به ابزار نمی‌شود (جلوگیری از prompt injection) |
| متن‌های دیتاست (عنوان، توضیح) | داده‌اند؛ هیچ دستوری در آن‌ها اجرا نمی‌شود |
| LLM | هیچ دسترسی نوشتن/ارسال ندارد؛ فقط ابزارهای خواندنی |
| ارتباط با فروشنده | هیچ ارسال خودکار؛ فقط پیش‌نویس |
| شماره‌ها | ساختگی؛ در UI عملیاتی نمی‌شوند |

## ۷. فرانت‌اند
- Server Components پیش‌فرض؛ Client Components فقط برای تعامل (فرم‌ها، Q&A).
- Tailwind v4 با توکن‌های CSS؛ `cva` برای واریانت‌ها؛ shadcn/ui **استفاده نشد** (عمداً: نیازی به کل مجموعه‌ی Radix نبود؛ مولفه‌های کوچک خودمان کافی‌اند). در فاز ۴ برای Dialog/Sheet می‌توان Radix را اضافه کرد.
- Motion فقط در ورود و تغییر وضعیت؛ `MotionConfig reducedMotion="user"`.
- بدون CDN: فونت از `@fontsource-variable/vazirmatn`.

## ۸. تست
- Vitest (واحد + RTL)، Playwright (دود e2e و اسکرین‌شات چند-viewport با Chrome سیستمی).
- گیت: `npm run check` + `npm run build` + `npm run test:e2e`.

## ۹. استقرار (آینده)
یک کانتینر Node (Dockerfile در فاز ۲–۳)، SQLite روی volume. استقرار بیرونی در فاز ۱ ممنوع بود؛ `docs/phase-plan.md` نقطه‌ی «استقرار زودهنگام» را تعریف می‌کند.


## به‌روزرسانی فاز ۲ — تصمیم‌های تثبیت‌شده
- **SQLite از طریق `node:sqlite`** (Node ≥ 22.5؛ هدف: Node 24). بدون addon بومی؛ FTS5/R-Tree تأیید شد. جزئیات و هزینه‌ها: `docs/phase-2-data.md` §۲.
- **مرز سرور:** `src/server/**` فقط از route handler/اسکریپت/تست import می‌شود؛ قانون ESLint از رسیدن آن (و `node:sqlite`) به `src/components`, `src/lib`, `src/domain` جلوگیری می‌کند.
- **دامنه‌ی خالص در `src/domain` و `src/server/domain`** (بدون I/O): کاتالوگ پرچم‌ها، ماشین حالت، متن/مدل/واحد، ساعت کاری، مسافت.
- **تک نویسنده:** فقط importer روی فایل DB می‌نویسد (staging + rename)؛ سرور با اتصال `readOnly` و `query_only`.
- **خواندنی‌های محدود:** سقف `limit/offset/radius/payload` در `LIMITS`.
- مسیر ارتقا به Postgres بدون تغییر معیارهای بخش ۴ (نوشتن هم‌زمان، PostGIS، pgvector، چند replica).


## به‌روزرسانی فاز ۳
- **سرویس‌های مشترک:** `searchCatalog`, `adviseProducts`, `compareProducts`, `getProductDetail` در `src/server/**`؛ Server Component ها و Route Handler ها همه همین‌ها را صدا می‌زنند (بدون تکرار منطق).
- **قراردادهای JSON:** `src/domain/advisor.ts` (قابل ورود در کلاینت؛ بدون وابستگی به سرور).
- **وضعیت UI در URL**؛ `localStorage` فقط آخرین URL مشاور، `sessionStorage` فقط سبد مقایسه.
- **Route Handler ها:** `src/app/api/{search,suggest,advisor,compare,products/[id]}` با zod؛ مصرف توسط عامل فاز ۷ (`src/server/agent/tools.ts` همان سرویس‌ها را مستقیماً فرا می‌خواند؛ هیچ HTTP داخلی‌ای ندارد).
- مهاجرت `002`: جدول `product_price_evidence` و `product_fts_vocab`.


## به‌روزرسانی فاز ۴
- `src/server/sellers/{find,activity,origins,params}.ts`، `src/server/areas/{validate,curated,density,recommend}.ts`؛ `src/lib/{geo,gps,map-model,sellers-url,seller-labels,hours-table}.ts` (قابل ورود در کلاینت).
- نقشه: Leaflet فقط در کلاینت (`dynamic import`)؛ منطق نشانگرها در `map-model.ts` خالص و تست‌پذیر است.
- حریم خصوصی: مبدأ همیشه به ≈۱۰۰ متر گرد می‌شود؛ GPS فقط با POST؛ URL فقط `o=gps`.
- API: `/api/sellers` (GET/POST)، `/api/areas`، `/api/activity`.
- جزئیات: `docs/phase-4-sellers.md`.


## به‌روزرسانی فاز ۵
- `src/server/compare/{identity,engine,service,time,params}.ts`: موتور خالص (`compareSellers`) جدا از بارگذاری DB (`compareSellersForProduct`)؛ ورودی/خروجی یکسان ⇒ خروجی بایت‌به‌بایت یکسان.
- قراردادها: `src/domain/comparison.ts`، `src/domain/provenance.ts` (فقط تعریف).
- UI: `src/components/compare/{compare-table,compare-view}.tsx`؛ API: `/api/compare/sellers` (GET/POST).
- URL: `src/lib/compare-url.ts`، `src/lib/mission-url.ts`؛ نقشه: `src/lib/map-config.ts`.
- جزئیات: `docs/phase-5-compare.md`.


## به‌روزرسانی فاز ۶
- `src/domain/inquiry*.ts` (خالص)، `src/server/inquiry/context.ts` (تنها منبع حقیقت زمینه؛ از سرویس مقایسه‌ی فاز ۵ می‌خواند)، `src/lib/inquiry-storage.ts`، `src/components/inquiry/*`.
- مرز: شبیه‌سازی فقط در حافظه‌ی کلاینت؛ هیچ endpoint نوشتنی؛ هیچ تماس شبکه‌ای در کپی/شبیه‌سازی/ثبت پاسخ.
- جزئیات: `docs/phase-6-communication.md`.


## فاز ۷ — لایه‌ی عامل
`/api/agent/turn` (POST، stateless؛ state تایپ‌شده را کلاینت نگه می‌دارد و سرور هر بار strict اعتبارسنجی می‌کند) و `/api/agent/status`. جزئیات، نمودار جریان، فهرست ابزارها و مرزهای اعتماد: `docs/phase-7-agent.md`. قاعده‌ی وابستگی: `src/server/agent/**` فقط سرویس‌های سرور/دامنه را می‌خواند؛ کلیدها فقط از env سمت سرور؛ UI فقط `src/domain/agent.ts` (قرارداد) را import می‌کند.


## فاز ۸ — ماموریت‌ها (سمت کلاینت)
دامنه‌ی خالص `src/domain/mission.ts` (reducer، آمادگی، فهرست)، اعتبارسنج strict `src/lib/mission-schema.ts`، ذخیره‌سازی `src/lib/mission-store.ts` (TAB=sessionStorage پیش‌فرض، DEVICE=IndexedDB فقط با رضایت صریح، MEMORY=fallback؛ compare-and-set روی `rev`). سرور فقط‌خواندنی است: `/api/missions/facts` و `/api/missions/recovery` از شناسه‌ها واقعیت‌ها را دوباره می‌سازند (`src/server/missions/*`)؛ هیچ ماموریتی روی سرور نیست. `InquiryWorkspace` از طریق `binding` می‌تواند state دستی را از ماموریت بگیرد؛ حالت شبیه‌سازی فقط در حافظه‌ی کامپوننت می‌ماند. جزئیات: `docs/phase-8-missions.md`.


## فاز ۹ — قفل مدل، شواهد بیرونی، هدرها
* **قفل مدل:** `live-gate.ts` (قفل در کد + دروازه‌ی env)، `ProviderKind="live-locked"`، `createLockedProvider`؛ آداپتور OpenAI‑سازگار فقط با transport تزریقی کار می‌کند. `vitest.setup.ts` شبکه‌ی واقعی را در تست‌های واحد می‌بندد.
* **شواهد بیرونی:** `reviewed-sources.ts` (رجیستری کدی، `robotsAllows`، استخراج‌گر سازنده/نقد، ≤۲۵ کلمه)، `service.ts` (اعتبارسنجی، تعارض، کش ۲۴ ساعت)، `card.ts` (نمای مشترک UI)، `GET /api/evidence/[id]?optin=1`، `ExternalEvidencePanel`. هیچ مدلی در مسیر نیست.
* **هدرها:** `next.config.ts` → CSP و هدرهای امنیتی؛ `z.config({jitless:true})` در طرح ماموریت برای سازگاری با CSP بدون eval.
