# Pack 2A — نتایج اجرای Docker محلی (2026‑10‑23)

**وضعیت: `PACK 2A PASS / LOCAL VERIFIED`** (با یک باگ واقعی پیداشده و رفع‌شده) · Liara: **NOT DEPLOYED** · BoxAPI: **LOCKED، ۰ درخواست**.

## منشأ و image
- پایه: `docker.io/library/node:24-slim` (Docker Official Image، `debian:bookworm-slim`)، index digest `sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`، manifest linux/amd64 `sha256:2dd9a4f7…981ae`، Node v24.22.1، اندازهٔ باز‌شده ۳۲۸ MB. pull با digest و بدون pull ثانویه (`--pull=false`).
- سورس: working tree uncommitted روی `9989a7a` (۴۸ ورودی `git status`)؛ commit نشد. image نهایی `hamghadam-liara:pack2` = `sha256:eb110580…2737`، ۳۸۸٫۳ MB، amd64، `USER node`.
- build‌ها: `Dockerfile.liara` (دو نسخه: کاشی خاموش = نامزد تولید؛ کاشی پیش‌فرض برای تست کامل) و `Dockerfile` محلی؛ هر سه موفق. `npm ci` ۴۶۶ بستهٔ build/dev طبق lockfile (≈ ۱۰۷ s)، بدون ارتقا. لاگ‌ها: `qa-artifacts/pack2/build-*.log` (ignore‌شده).
- محتوای image: `find` برای `*.sqlite*`, `*.zip`, `.env*` بیرون از node_modules خالی؛ DB فقط از mount.

## داده
- import تازه از ZIP (فقط‌خواندنی) در volume یک‌بارمصرف: ۳۲ s؛ `db:verify` داخل کانتینر با mount `:ro`: ALL CHECKS PASSED (225,903 / 6,476 / 331,506، `sourceSha256 = 37a25fbd…`). DB: ۸۲۷٬۹۲۴٬۴۸۰ B، sha256 `c3c5d16b…` (**متفاوت** از DB میزبان به‌دلیل متادیتای import؛ برابری با اندازه + شمارش + verify سنجیده شد).
- ZIP و `data/app.sqlite` میزبان: هش و اندازه دست‌نخورده (`37a25fbd…`، `47225ae5…`)؛ volume اصلی `novo-torob_torob-data` لمس نشد.

## اجرا مانند Liara (`--read-only --tmpfs /tmp`، `no-new-privileges`، دیسک `:ro` روی `/app/data`)
| مورد | نتیجه |
|---|---|
| `/api/health` / `/api/ready` | 200 / 200؛ healthcheck = healthy؛ restarts=0، OOM نه |
| کاربر/مجوزها | uid=1000(node)؛ `touch /app/data/x`، `touch /app/x` ⇒ Read-only file system؛ `/tmp` قابل‌نوشتن |
| استارت سرد → ready | ≈ ۰٫۵۲ s؛ بعد از `docker restart` ≈ ۰٫۵۶ s؛ داده پایدار |
| volume خالی | health 200، **ready 503** `database file missing`؛ صفحات پیام فارسی بدون دادهٔ ساختگی |
| بازگردانی از پشتیبان (volume جدا، هش برابر) | ready 200 **بدون restart کانتینر**، هش برابر قبل، `db:verify` PASS |
| حافظه | شروع ≈ ۶۱ MiB؛ پایدار ≈ ۲۹۵ MiB؛ `memory.peak` ≈ ۳۱۰ MiB در smoke سبک و ≈ ۱٫۳ GiB پس از کل مجموعهٔ Playwright (شامل page‑cache بازیافتنی فایل ۷۹۰ MiB) ⇒ عدد پلن Liara را تعیین نمی‌کند |
| تأخیر warm (روی کانتینر، 30 درخواست) | جست‌وجو p50 ≈ ۱۶ ms؛ محصول ≈ ۷ ms؛ فروشندگان ≈ ۲۲ ms؛ discover ≈ ۵ ms؛ assistant ≈ ۵ ms |

## Playwright روی کانتینر (داده‌ی واقعی، بدون مصرف DB میزبان به‌عنوان سرور)
- کل مجموعه روی image با کاشی پیش‌فرض: **۴۰۰ pass، ۰ fail، ۰ flaky، ۱۱۲ skip** (دو بار: قبل و بعد از رفع باگ زیر).
- نامزد تولید (کاشی خاموش، mock، evidence خاموش): smoke + security + release-journey + journeys + sellers + compare + missions + missions‑storage + inquiry ⇒ **۱۹۹ pass + ۴۹ pass در اجرای مجدد sellers**، ۰ fail؛ ۴ skip برچسب‌دار (۳ مورد «کاشی خاموش در این استقرار»، ۱ مورد «فقط وقتی DB نیست»).
- چهار مرحله با رکوردهای واقعی (محصولات `product_7308febc…`، `product_068bab0f…`، `product_50fe6f6c…`) و بازیابی/محله‌های جایگزین/مأموریت ذخیره‌شده در همین specها پوشش دارند؛ تلفن‌ها مخفی (`phoneOrCoordinateLeaks=0` در eval).

## باگ واقعی پیداشده (فقط در پیکربندی پیشنهادی Liara) و رفع
خاموش کردن کاشی با `NEXT_PUBLIC_MAP_TILES_DISABLED=1` درست CSP و درخواست‌ها را می‌بست، ولی UI فروشندگان همچنان می‌گفت «مرورگر شما کاشی‌ها را از OpenStreetMap می‌گیرد» و کلید روشن/خاموش نشان می‌داد؛ مینی‌مپ و جزئیات منطقه هم همین ادعا را داشتند. رفع: `sellers-explorer.tsx`, `shop-mini-map.tsx`, `area-explorer.tsx` از `TILE_CONFIG.enabled` پیروی می‌کنند؛ تست واحد `tiles-disabled.test.tsx` و تست e2e «استقرار با کاشی خاموش» اضافه شد؛ سه تست وابسته به کاشی در چنین build با برچسب `explicit deployment opt-out` skip می‌شوند.

## مدل
با ایمیج واقعی و **تمام** متغیرهای تأیید ساختگی (`AGENT_PROVIDER=openai-compatible`، کلید `sk-FAKE…`، سقف‌ها، allowlist، انقضا) و sink TCP محلی روی `host.docker.internal:9099`: `/api/agent/status` ⇒ `locked`; ۳ نوبت ⇒ **503 `AGENT_LIVE_LOCKED`**؛ sink ⇒ **۰ اتصال**؛ نشت کلید در لاگ/HTML ⇒ ۰. اجرای `gate-b-proof` (۰ اتصال، ۴۶ فایل bundle بدون رشتهٔ مدل). حالت mock با برچسب «نه مدل زبانی» و `disabled` هر دو درست.

## تست‌های میزبان پس از رفع
`tsc` پاک؛ lint پاک؛ vitest ۸۸۸ pass (۹ اجرای پیاپی سبز، **یک شکست ناپایدار در یک اجرا مشاهده شد و بازتولید/ثبت نشد**)؛ `db:verify` PASS.

## پاک‌سازی
کانتینر، دو volume و چهار image با پیشوند `pack2` حذف شد (`node:24-slim` برای اجرای بعدی نگه داشته شد؛ کش build دست‌نخورده). هیچ prune.

## هنوز مسدود (Pack 2B)
حساب/پلن/قیمت/ظرفیت دیسک Liara، سقف FTPS برای ≈ ۸۲۸ MB و Job import، رفتار `X-Forwarded-For` در لبهٔ Liara (⇒ `TRUST_PROXY_HEADERS` تنظیم نمی‌شود)، ارائه‌دهندهٔ کاشی، دامنه/TLS، commit و منشأ سورس، و مجوز Gate L.
