# Pack 2B — پیش‌پرواز استقرار Liara (2026‑10‑23) — فقط‌خواندنی/محلی؛ **هیچ اقدام ابری، commit، push، آپلود یا فراخوانی مدل انجام نشد**

وضعیت کلی: `PACK 2B PREFLIGHT PREPARED / AWAITING OWNER APPROVALS / NOT DEPLOYED`. فرم تأیید: `docs/pack-2b-owner-approval-form.md`.

## ۱. Gate 0 — موجودی و منشأ سورس
- `HEAD = origin/main = 9989a7a`؛ **ریموت هیچ‌کدام از تغییرات را ندارد.** هر build ریموت Liara (اتصال GitHub) از این revision نسخهٔ بدون رفع‌های زیر را می‌سازد: ۲ باگ UI (هدف لمسی ۴۴px، CLS دستیار)، افشای نقشه با کاشی خاموش، مسیر خروجی QA و گیت «دادهٔ واقعی»، قالب‌های Liara و ignoreها. استقرار با `liara deploy` از پوشهٔ محلی هم باید از **همین working tree** باشد.
- ۶۰ فایل نامزد (۴۲ ویرایش‌شده + ۱۸ جدید؛ `deploy/liara/` سه فایل دارد) — `git status` ۵۹ ورودی. دسته‌بندی پیشنهادی (commitهای منطقی؛ **اجرا نشده**):

| commit | محتوا |
|---|---|
| ۱ `fix(ui): tile-disclosure honours deployment kill-switch; assistant touch target + CLS` | `src/components/sellers/{sellers-explorer,shop-mini-map,area-explorer}.tsx`، `tiles-disabled.test.tsx`، `src/components/agent/agent-chat.module.css`، `src/app/assistant/loading.tsx` |
| ۲ `fix(security): XFF key = rightmost trusted hop; refuse fixture/partial catalog` | `src/server/agent/guard.ts`، `guard.test.ts`، `src/server/db/connect.ts`، `src/server/index.ts`، `src/app/api/ready/route.ts`، `src/server/db/catalog-guard.test.ts`، `.env.example`، `deploy/hamghadam.env.example` |
| ۳ `test: QA artifacts to ignored dir, real-catalog gate, selector fixes` | `e2e/*` (۲۲ فایل)، `e2e/global-setup.ts`، `tests/helpers/{qa-out,real-catalog,vitest-global-setup}.ts`، `playwright.config.ts`، `vitest.config.mts` (timeout ۳۰ s)، `scripts/*` |
| ۴ `build(deploy): Liara templates and hardened ignore files` | `deploy/liara/*` (شامل `REQUIRE_MIN_PRODUCTS`)، `.liaraignore`، `.dockerignore`، `.gitignore`، `src/server/deploy/deploy-config.test.ts` |
| ۵ `docs: pack 1.5 / 2A / 2B reports` | `docs/liara-readiness.md`، `docs/pack-*.md`، `docs/qa/README.md` |

- **اسکن قبل از هر Git:** (روی همهٔ ۶۰ فایل نامزد، پس از آخرین تغییر دوباره اجرا شد؛ تنها تطابق الگوها کلیدهای ساختگی `sk-FAKE…` در اسکریپت/سند اثبات‌نشت‌اند) بدون فایل `.sqlite/.db/.zip/.mp4/.env`؛ بدون فایل > ۲۰۰ KB؛ الگوی کلید/توکن/PEM: صفر؛ مسیر محلی کاربر در فایل‌های کد: صفر؛ مختصات دقیق تهران: صفر. تنها تطابق «شمارهٔ تلفن‌مانند» `09120000000` است که **مقدار آزمایشی صریح** در تست‌های منفی (باید از پاسخ حذف شود) است، نه داده. `.claude/`, `.data/`, `data/`, `.cache/`, `qa-artifacts/`, `test-results/`, `.next/` همگی ignore‌شده‌اند و در context ساخت نیستند (Pack 2A: ≈ ۴ MB).
- ریسک‌های Git: (الف) `docs/qa` شامل ۴۲۱ فایل ردیابی‌شده (≈ ۷۷ MB) است؛ برای استقرار از Git سنگین ولی نه سری؛ `.liaraignore` آن را از آپلود CLI حذف می‌کند. (ب) هویت commit: `git config` فعلی `parsampnami <parsadeveloper.py@gmail.com>`؛ commit قبلی `Mehdi‑Es84` — نویسنده باید توسط مالک تأیید شود. (ج) commit محلی ≠ push؛ هر کدام تأیید جدا دارد.

## ۲. Gate 1 — بازبینی پیکربندی (بدون حساب)
| مورد | نتیجه | منبع |
|---|---|---|
| شکل `liara.json` | `platform:docker`، `port:3000`، `build.dockerfile/args`، `disks[{name,mountTo:"/app/data"}]`؛ نام اپ/دیسک placeholder | docs.liara.ir (route، deploy-app) |
| بدون `VOLUME`، WORKDIR `/app`، دیسک زیر WORKDIR | ✔ `deploy/liara/Dockerfile.liara`؛ تست رگرسیون | use-disk |
| `DATABASE_PATH` | `/app/data/app.sqlite` (ENV image) = مسیر mount | Dockerfile.liara |
| دسترسی فقط‌خواندنی، بدون WAL/SHM | `readOnly:true` + `query_only`؛ `journal_mode=delete`؛ Pack 2A: mount `:ro` روی rootfs فقط‌خواندنی کار کرد | connect.ts + اجرای Docker |
| غیاب DB | `/api/ready` = 503 `database file missing`، `/api/health` = 200؛ UI بدون دادهٔ ساختگی | Pack 2A |
| سطح شبکه | فقط پورت ۳۰۰۰ (`EXPOSE 3000`)؛ `USER node`؛ `HEALTHCHECK` داخل image (استفادهٔ Liara از آن **تأییدنشده**) | Dockerfile.liara |
| هدرها | CSP با nonce هر درخواست، `nosniff`، `X-Frame-Options: DENY`، `Referrer-Policy`، `Permissions-Policy`، `COOP`؛ صفحات `private, no-store`؛ API `no-store` (agent، sellers، products، search، ready). **HSTS در اپ نیست** — باید در لبه (Liara/TLS) باشد؛ تأییدنشده | `gate-b-proof.json`، `next.config.ts`، `proxy.ts` |
| مدل | `LIVE_MODEL_CALLS_ENABLED_IN_CODE=false`؛ Pack 2A: حتی با همهٔ env تأیید ساختگی، ۳ نوبت ⇒ 503 `AGENT_LIVE_LOCKED` و ۰ اتصال. env استقرار: **فقط** `AGENT_PROVIDER=mock` (یا `disabled`). `AGENT_EVIDENCE_MODE` تنظیم نشود (پیش‌فرض off؛ `live` بدون `AGENT_EXTERNAL_LIVE=1` هم off می‌شود؛ هر دو را تنظیم **نکنید**) | config.ts |
| کاشی | `build.args: NEXT_PUBLIC_MAP_TILES_DISABLED=1` (زمان build درج می‌شود؛ تغییر ارائه‌دهنده = build جدید). CSP بدون میزبان کاشی؛ UI صادقانه می‌گوید نقشهٔ خیابانی فعال نیست و فهرست + نشانگرهای ساده کار می‌کنند (Pack 2A: تست e2e) | map-config.ts |
| `node:24-slim` | تگ شناور در Dockerfile؛ digest بررسی‌شده در 2026‑10‑23 `sha256:55fb5f5a…d205`. پین با digest فقط اگر آینهٔ Liara همان را داشته باشد؛ تأییدنشده ⇒ تگ حفظ شد | Pack 2A |
| تک‌replica | رابط `liara.json.example` بدون `replicas`؛ limiter/semaphore/cache درون‌پروسه‌اند | کد |
| ظرفیت دیسک/قیمت/سقف FTPS | **نامعلوم** — فقط از داشبورد مالک | — |

### ۲.۱ ریسک X‑Forwarded‑For و نرخ‌گیری (یافتهٔ جدید + رفع محلی)
- یافته: `clientKey` قبلاً **اولین** عنصر `X-Forwarded-For` را می‌گرفت. اگر لبه (مثل اغلب پروکسی‌ها) هدر را *append* کند، عنصر چپ را مهاجم می‌نویسد ⇒ با چرخاندن مقدار می‌شد از محدودیت فرار کرد. فرض قبلی «پروکسی بازنویسی می‌کند» برای Liara **اثبات نشده** است.
- رفع (کد محلی، پیش‌فرض خاموش): با `TRUST_PROXY_HEADERS=1` کلید = عنصر `TRUST_PROXY_HOPS`‑ام از **راست** (پیش‌فرض ۱، حداکثر ۵)؛ کمتر بودن عناصر از hops ⇒ `local`، نه fallback به مقدار قابل‌جعل. با پروکسی بازنویس (Caddy/nginx قالب‌ها) رفتار یکسان است. تست‌های واحد در `guard.test.ts`.
- وضعیت پیش‌فرض عمومی: `TRUST_PROXY_HEADERS` تنظیم‌نشده ⇒ **یک سطل مشترک** برای همهٔ کاربران. حدود پیش‌فرض: دستیار ۳۰ نوبت/دقیقه و POSTهای `/api/sellers`/`/api/compare/sellers` ۱۲۰/دقیقه **برای کل سرویس**. اپراتوری: برای داورانِ هم‌زمان ممکن است ۴۲۹ دیده شود. تصمیم نهایی: حدود پیش‌فرض **بدون تغییر** می‌مانند و خطر به‌صورت مستند پذیرفته می‌شود؛ عدد بزرگ حدسی (مثل ۶۰۰) برای پنهان‌کردن مشکل تنظیم نمی‌شود. پس از استقرار با بار واقعی اندازه‌گیری و در صورت نیاز تصمیم جدا.

## ۳. Gate 2 — ماتریس انتقال داده (اجرا نشده؛ `NOT VERIFIED`)
| معیار | A) DB تأییدشدهٔ آماده (FTPS/داشبورد) | B) ZIP + job import یک‌باره |
|---|---|---|
| حجم انتقال | 827,924,480 B (≈ ۷۹۰ MiB) | 60,178,644 B (≈ ۵۷ MiB) |
| پشتیبانی Liara | FTPS مستند است؛ **سقف فایل/resume/نام موقت/rename مستند نیست** | **Job نوشتنی یک‌باره مستند نشد**؛ شاید فقط با shell/exec یا ایمیج جداگانه |
| دیسک لازم | DB فعال + بارگیری جدید + rollback ≈ ۲٫۵ GB (برآورد) | + staging import + ZIP + CSV موقت ≈ ۳–۳٫۵ GB (برآورد) |
| یکپارچگی | اندازهٔ بایتی + (اگر ابزار هش روی دیسک نبود) `/api/ready` + شمارش؛ `PRAGMA integrity_check` فقط با دسترسی اجرایی | `db:verify` داخل job؛ هش منبع در رکورد import (`sourceSha256`) |
| رفتار restart | DB پایدار؛ اپ فقط می‌خواند | idem پس از import؛ ریسک import ناخواسته اگر boot کند ⇒ **نباید در boot باشد** |
| rollback | نام‌گذاری `app.sqlite` + `app.prev.sqlite`؛ جایگزینی با rename همان فایل‌سیستم | import اتمیک (staging + rename) ولی نیاز به نسخهٔ قبلی جدا |
| پیچیدگی/ریسک | کم؛ ریسک اصلی آپلود ناقص (کاهش: `app.sqlite.part` → rename؛ تا آن‌زمان ready=503) | زیاد؛ ZIP حاوی تلفن‌های ساختگی روی دیسک می‌ماند و باید دانلودناپذیر باشد |
| **توصیه** | **ترجیح با A** اگر سقف FTPS ≥ ۸۲۸ MB و rename ممکن باشد؛ آزمون ابتدا با یک فایل ≥ ۸۳۰ MB ساختگی/تصادفی (نه داده) در staging | فقط اگر A ناممکن شد و پشتیبانی Liara job نوشتنی را تأیید کرد |

آزمون «آپلود ناقص»: نسخهٔ بریده‌شدهٔ DB چگونه رفتار می‌کند؟ (نتیجه در §۵.)

## ۴. پیوست — روش آزمون کنترل‌شدهٔ هدر (فقط پس از تأیید P1 روی staging)
1. استقرار staging با `TRUST_PROXY_HEADERS=1` و `TRUST_PROXY_HOPS=1`؛ `API_POST_RATE_PER_MIN=20` (فقط staging).
2. از یک مشتری، ۳۰ POST به `/api/sellers` (بدنهٔ معتبر کوچک) با `X-Forwarded-For` که در هر درخواست **مقدار تصادفی جدید** می‌گیرد. انتظار امن: درخواست‌های ۲۱+ ⇒ 429 (کلید از جعل‌پذیر مستقل است). اگر 429 نیامد ⇒ لبه هدر را append نمی‌کند یا hops اشتباه است ⇒ `TRUST_PROXY_HEADERS` **روشن نشود**.
3. هم‌زمان از مشتری دوم (شبکهٔ دیگر): باید 200 بگیرد (سطل مشترک نیست).
4. اگر لبه چند hop دارد (CDN + پروکسی)، `TRUST_PROXY_HOPS` باید با مستندات/آزمون تعیین شود، نه حدس.
هیچ endpoint عیب‌یابی افشاکنندهٔ هدرها اضافه نشد.

## ۵. آزمون «DB ناقص/خراب» (محلی)
نتیجه (دادهٔ واقعی نیست؛ نسخه‌های خراب در scratchpad ساخته و حذف شد):
| فایل | `/api/ready` | صفحات |
|---|---|---|
| بریده‌شده (۱۲۰ MB اول) | 503 `database error` | `/search` ⇒ 500 (خطا، نه دادهٔ ساختگی) |
| خالی / بایت تصادفی | 503 `database error` | 500 |
| **fixture (۶ محصول)** | **200 ready** ⇐ ریسک واقعی | صفحات با دادهٔ ساختگی کار می‌کردند |
رفع محلی (پیش‌فرض خاموش): `REQUIRE_MIN_PRODUCTS` — اگر تعداد محصولات کمتر باشد `getReadDb` خطای `CatalogMismatchError` (زیرمجموعهٔ «غیرقابل‌دسترس») می‌دهد ⇒ `/api/ready` 503 `catalog does not match the expected size` و صفحات پیام «در دسترس نیست» می‌دهند. `Dockerfile.liara` مقدار `225903` را دارد. تأیید در Docker (image منتهی به همین سورس): volume با کپی بایت‌به‌بایت DB واقعی (`sha256 47225ae5…` برابر منبع) ⇒ ready 200 و صفحهٔ محصول 200؛ volume با fixture ⇒ 503 + ۰ شناسهٔ محصول. این **یک کپی محلی ۷۹۰ MiB** بود، نه آزمون FTPS.
نقص باقی‌مانده: `/search` با فایل خراب 500 می‌دهد (به‌جای صفحهٔ دوستانهٔ «در دسترس نیست»)؛ کم‌ریسک چون ready=503 است؛ اصلاح نشد.

## ۶. Gate 3 — flake و چک‌لیست راه‌اندازی
**فلک Vitest:** علت یافت و بازتولید شد. `qa-artifacts/flake/*` (stdout/stderr/JSON/بار CPU برای هر اجرا): ۶ اجرای بدون بار ⇒ ۶ سبز (۸۸۹/۸۸۹)؛ ۶ اجرا با ۱۶ حلقهٔ CPU ⇒ **۶ شکست** (۱–۳ تست)، همه `Test timed out in 5000ms` در تست‌های دادهٔ واقعی (`real-compare`، `real-sellers`، `inquiry-context`). علت: کندترین تست دادهٔ واقعی در حالت بیکار هم ۴٫۱–۴٫۸ s طول می‌کشد (حاشیه < ۱ s تا سقف ۵ s)؛ هر فشار CPU/IO (Docker، Chrome) آن را می‌شکند — **نه خطای منطقی**. رفع: `testTimeout: 30_000` در `vitest.config.mts`. تأیید: ≥ ۵ اجرای پشت‌سرهم با بار بسیار سنگین‌تر (loadavg تا ≈ ۴۱، چون دو نمونهٔ اسکریپت هم‌زمان اجرا شدند) ⇒ همه ۸۸۹/۸۸۹ سبز. وضعیت: `RESOLVED (root cause: tight 5 s timeout under contention)`؛ فلک قبلی بدون لاگ به‌احتمال زیاد همین بود (شواهد غیرمستقیم؛ لاگ آن اجرا ثبت نشده بود).

**چک‌لیست (سورس فعلی، اعداد واقعی):** `tsc` پاک · `lint` پاک · vitest **۶۴ فایل، ۸۹۲ تست، همه سبز** · `db:verify` ALL CHECKS PASSED (۲۲۵٬۹۰۳ / ۶٬۴۷۶ / ۳۳۱٬۵۰۶) · `npm run build` موفق · image Liara از همین سورس ساخته و اجرا شد (۳۸۸ MB؛ ready/محصول/fixture‑رد بالا) · هش ZIP و DB میزبان دست‌نخورده.
**اجرا نشد (عمداً):** Playwright کامل روی کانتینر برای سورس نهایی — تغییرات این مرحله فقط `guard.ts` (پیش‌فرض بدون اثر)، `connect.ts`/`ready` (فقط وقتی `REQUIRE_MIN_PRODUCTS` تنظیم باشد؛ آن هم در Docker با DB واقعی ready و صفحهٔ محصول 200 شد) و پیکربندی‌اند. آخرین اجرای کامل واقعی: Pack 2A (۴۰۰ pass، ۰ fail) روی سورس بدون این تغییرات. **پیش از استقرار عمومی باید یک بار Playwright کامل روی image نهایی دوباره اجرا شود** (۳ دقیقه).

## ۷. قفل مدل و ضد‑هزینه
`LIVE_MODEL_CALLS_ENABLED_IN_CODE=false` دست‌نخورده؛ هیچ کلید/provider تنظیم نشد؛ هیچ درخواست BoxAPI/مدل، پیام به فروشنده، اتصال خارجی یا استقرار انجام نشد. فقط کارهای محلی: خواندن مستندات عمومی Liara در Pack 2A، ساخت image محلی از لایه‌های کش‌شده (بدون دانلود جدید)، و تست‌ها.

## ۸. وضعیت gateها
| Gate | وضعیت |
|---|---|
| 0 موجودی/منشأ/اسکن | PASS (تقسیم commit پیشنهادی آماده؛ اجرا نشده) |
| 1 پیکربندی بدون حساب | PASS برای آنچه محلی قابل‌اثبات است؛ **PARTIAL** برای: healthcheck/HSTS/رفتار XFF/پلن/ظرفیت Liara (حساب‌محور، نامعلوم) |
| 2 انتقال داده | ماتریس آماده؛ `NOT VERIFIED` (نیاز به حساب) — پیشنهاد A |
| 3 فلک و چک‌لیست | PASS (فلک علت‌یابی و رفع)؛ Playwright نهایی روی image پیش از استقرار باقی |
| 4 تأیید مالک | **BLOCKED — در انتظار فرم** `docs/pack-2b-owner-approval-form.md` |
| 5 اجرا | NOT EXECUTED |
