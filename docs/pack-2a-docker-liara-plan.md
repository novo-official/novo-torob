# Pack 2A — برنامهٔ تأیید Docker محلی، دیسک Liara و انتقال داده (2026‑10‑23)

**وضعیت اولیه (قبل از اجرا): `PACK 2A PREPARED`. پس از تأیید Gate D اجرا شد: نتایج در `docs/pack-2a-docker-results.md` (`LOCAL VERIFIED`).** · `PACK 2B BLOCKED BY OWNER DECISIONS / NOT DEPLOYED`.
هیچ دانلود، pull، ایجاد منبع Liara، آپلود، commit یا درخواست مدل انجام نشد. این سند «اجرا» نیست؛ اجرا فقط پس از Gate D / Gate L.

## ۱. شواهد پیش‌پرواز (اجراشده، بدون تغییر دادهٔ اصلی)
| مورد | نتیجه |
|---|---|
| revision پایه | `9989a7a`؛ ۴۳ ورودی uncommitted (۱۱ فایل e2e ویرایش‌شده + فایل‌های Pack 1.5/2A) — هیچ stage/commit |
| ZIP | 60,178,644 B · sha256 `37a25fbd…d94013` ✔ مطابق گزارش |
| DB | 827,924,480 B · sha256 `47225ae5…156de5` ✔ مطابق گزارش؛ پس از همهٔ اجراها بدون تغییر؛ فقط `app.sqlite` و `fixture.sqlite` در `data/` (هیچ `-wal/-shm/-journal`) |
| `db:verify` (read-only) | ALL CHECKS PASSED: 225,903 / 6,476 / 331,506، یتیم ۰، FTS و R‑Tree، `integrity_check` ok |
| `tsc` / `lint` / `build` | پاک / پاک / standalone موفق |
| `journal_mode` DB | `delete` (نه WAL) ⇒ از mount فقط‌خواندنی بدون ساخت `-shm` خوانده می‌شود |
| اتصال سرور | `new DatabaseSync(path,{readOnly:true})` + `PRAGMA query_only=ON` (`src/server/db/connect.ts`) |
| DB غایب | سرور standalone با `DATABASE_PATH` ناموجود: `/api/health` 200، `/api/ready` **503** `database file missing`، `/search` و `/discover` پیام فارسی «اطلاعات کالاها در دسترس نیست» با ۰ شناسهٔ محصول — **بدون fallback به fixture** |
| نشت مدل/راز (Gate B proof، سرور standalone ساخته‌شده + کلید ساختگی + sink TCP محلی) | `sinkTotal=0` اتصال؛ نشت کلید در لاگ ✗؛ ۴۶ فایل bundle کلاینت بدون رشتهٔ مدل/راز؛ CSRF/CSP مطابق انتظار؛ حالت‌ها: locked/mock/disabled |
| اندازه‌گیری محلی (**بدون Docker**، Node 24 مستقیم، همین ماشین) | RSS بیکار ≈ ۱۵۴ MiB، پس از ≈ ۷۵ درخواست ≈ ۱۹۶ MiB (اوج ۲۵۴ MiB)؛ CPU ≈ ۲٫۰ s؛ warm: محصول ≈ ۲۲ ms، فروشندگان ≈ ۴۷ ms، جست‌وجو ≈ ۲۵۸ ms (cold). **نه** شاهد Docker و **نه** تعیین‌کنندهٔ پلن Liara |

### یافته‌های اصلاح‌شده در این مرحله (فقط پیکربندی)
1. **Build context واقعی** با `docker build` روی `FROM scratch` (بدون دانلود، خروجی tar فقط خوانده شد) سنجیده شد: ≈ ۴٫۰ MB / ۴۷۷ فایل با `.dockerignore`؛ ≈ ۴٫۱ MB با `.liaraignore`. نه DB، نه ZIP، نه `.data`، نه `qa-artifacts`، نه `docs/qa`، نه `.next`، نه `node_modules`، نه `.git`.
2. **نشت بالقوه‌ای که با نام‌فایل دیده نمی‌شد:** `.claude/settings.local.json` (حدود ۹۵ بایت، فقط کلید `permissions`) و `.brud/` وارد context می‌شدند و `.claude/` در `.gitignore` نبود ⇒ به هر سه ignore اضافه شد (`.claude/`، `.brud`).
3. الگوهای ریشه‌ای (`*.sqlite`) فقط ریشه را می‌گیرند ⇒ `**/*.sqlite`, `**/*.sqlite3`, `**/*.db*`, `**/.env*`, `**/*.mp4` افزوده شد. تنها `.zip`ها در context: ۵ فایل ساختگی `tests/fixtures/zips/*.zip` (ردیابی‌شدهٔ عمدی، بدون داده).
4. `liara.json.example` اکنون `build.args: ["NEXT_PUBLIC_MAP_TILES_DISABLED=1"]` دارد (پیش‌فرض امن تا تصمیم مالک دربارهٔ کاشی؛ بدون نشت IP/ناحیه به ثالث). این مقدار در زمان build درج می‌شود.
5. `docs/deployment-packet.md §۱` شواهد Docker محلی ۲۲ مهر (پروژهٔ `hamghadam-gatec`) را دارد: import ≈ ۵۲ s، `/api/ready` پس از restart ≈ ۰٫۲۸ s، rootfs فقط‌خواندنی، RAM بیکار ≈ ۴۶ MiB و ≈ ۵۷۸ MiB پس از پروفایل. این‌ها **قبل از بازطراحی** و برای `Dockerfile` محلی بودند ⇒ شاهد کد فعلی و `Dockerfile.liara` نیستند. همان گزارش یک **pull ناخواسته** (`busybox`، ≈ ۴ MB) ثبت کرده؛ در این برنامه برای کار با volume فقط از image خودِ پروژه یا `alpine:3.22` که **محلی موجود است** استفاده می‌شود.

## ۲. Gate D — درخواست تأیید صریح (اجرا نشده)
این پیام/پرامپت مجوز دانلود **نیست**. برای ادامه، مالک باید عیناً تأیید کند:

> «تأیید می‌کنم: `docker pull` برای `node:24-slim` (docker.io/library، linux/amd64، digest بررسی‌شده و ثبت‌شده)، دانلود وابستگی npm داخل `docker build` (`npm ci`)، ساخت دو image محلی با برچسب `*:pack2`، و ایجاد/حذف volume یک‌بارمصرف `hamghadam-pack2-data` و پروژه/پورت جدا (۳۰۳۰). هیچ چیز دیگری.»

برآورد (**تأییدنشده**، باید پیش از pull از رجیستری خوانده شود):
- `node:24-slim`: ≈ ۷۵ MB فشرده / ≈ ۲۳۰ MB روی دیسک (گزارش Pack 1.5؛ digest و اندازهٔ دقیق با `docker buildx imagetools inspect` — فقط manifest — پس از تأیید).
- `npm ci` داخل build: ۵۹۵ tarball از `lockfile`؛ cache میزبان (`~/.npm`) داخل `docker build` استفاده **نمی‌شود** ⇒ دانلود تازه؛ اندازهٔ دقیق نامعلوم (node_modules روی میزبان ۶۵۷ MB باز‌شده). اگر دانلود npm تأیید نشود، گزینهٔ بدیل: ساخت runner از `.next/standalone` میزبان روی `node:24-alpine` محلی — **فقط شاهد رفتار زمان اجرا، نه شاهد `Dockerfile.liara`** و musl با باینری‌های glibc میزبان (sharp) ناسازگار است؛ توصیه نمی‌شود.
- دیسک Docker: فضای آزاد کافی است (کش ساخت ۱۵٫۶ GB با ۷٫۳ GB قابل‌بازیابی؛ هیچ prune انجام نمی‌شود).

### رانبوک (UNTESTED تا Gate D؛ هیچ‌کدام اجرا نشده)
```bash
export COMPOSE_PROJECT_NAME=hamghadam-pack2 PORT=3030 VOL=hamghadam-pack2-data
# 0) اعتبارسنجی منبع (فقط manifest) و pull با digest
docker buildx imagetools inspect node:24-slim            # publisher=docker.io/library, platform=linux/amd64, digest → ثبت
docker pull node:24-slim@sha256:<DIGEST>
docker tag node:24-slim@sha256:<DIGEST> node:24-slim      # Dockerfile به تگ ارجاع می‌دهد؛ build با --pull=false
# 1) build هر دو Dockerfile از ریشهٔ پروژه
docker build --pull=false --target runner -t hamghadam-local:pack2 .
docker build --pull=false -f deploy/liara/Dockerfile.liara --target runner \
  --build-arg NEXT_PUBLIC_MAP_TILES_DISABLED=1 -t hamghadam-liara:pack2 .
docker build --pull=false --target tools -t hamghadam-tools:pack2 .
# 2) volume یک‌بارمصرف + import تازه از ZIP تأییدشده (ZIP فقط‌خواندنی)؛ مسیر Liara: /app/data
docker volume create $VOL
docker run --rm --user 0 -e DATABASE_PATH=/app/data/app.sqlite -v $VOL:/app/data -v "$PWD/.data":/source:ro \
  hamghadam-tools:pack2 npm run db:import -- --zip /source/torob-dataset.zip
docker run --rm --user 0 -e DATABASE_PATH=/app/data/app.sqlite -v $VOL:/app/data:ro hamghadam-tools:pack2 npm run db:verify
# 3) اجرا مانند Liara: بدون VOLUME، دیسک روی /app/data، non-root، rootfs فقط‌خواندنی
docker run -d --name hamghadam-pack2 -p 127.0.0.1:$PORT:3000 --read-only --tmpfs /tmp --security-opt no-new-privileges:true \
  -e AGENT_PROVIDER=mock -v $VOL:/app/data:ro hamghadam-liara:pack2
curl -s localhost:$PORT/api/health; curl -s localhost:$PORT/api/ready; docker inspect --format '{{.State.Health.Status}}' hamghadam-pack2
# 4) محدودهٔ بررسی: restart، نوشتن ممنوع (touch /app/data/x و /app/x باید خطا دهد)، stats، E2E روی کانتینر
docker restart hamghadam-pack2; docker stats --no-stream hamghadam-pack2
SMOKE_BASE_URL=http://127.0.0.1:$PORT npx playwright test e2e/smoke.spec.ts e2e/security.spec.ts   # فقط spec‌های فقط‌خواندنی
# 5) پاک‌سازی (فقط منابع همین پروژه)
docker rm -f hamghadam-pack2; docker volume rm $VOL; docker rmi hamghadam-local:pack2 hamghadam-liara:pack2 hamghadam-tools:pack2
```
نکته‌ها: (الف) هش بایت DB بعد از import تازه با DB میزبان **متفاوت** خواهد بود (متادیتای import)؛ برابری با شمارش، `db:verify` و اندازه سنجیده شود، نه با هش. (ب) `--user 0` فقط برای نوشتن اولیهٔ volume است؛ سرور با کاربر `node` و mount فقط‌خواندنی اجرا می‌شود. (ج) سناریوهای کامل چهار مرحله (نیاز نامعلوم، جست‌وجوی مدل، فروشندگان نقشه/فهرست، مقایسه با تنوع، پرسش دستی/DEMO، مأموریت ذخیره‌شده، محله‌های جایگزین) با Playwright کامل پروژه روی `SMOKE_BASE_URL` اجرا می‌شود؛ spec‌های نیازمند `DATABASE_PATH` محلی (`HAS_DB`) فقط وقتی دادهٔ واقعی میزبان هست فعال‌اند ⇒ برای کانتینر باید همان DB از mount فقط‌خواندنی میزبان هم در دسترس باشد یا spec‌ها طبق `docs/deployment-packet.md §9` فقط‌خواندنی محدود شوند. (د) سنجش «بدون اتصال به LLM»: اجرای مجدد `scripts/gate-b-proof.mjs` علیه image با کلید ساختگی + sink محلی؛ ردیابی `docker exec … ss -tn` / لاگ.

## ۳. Liara — منابع رسمی و آنچه تأیید شد
| صفحه | نکتهٔ تأییدشده (خوانده‌شده ۲۰۲۶‑۱۰‑۲۳) | تأییدنشده |
|---|---|---|
| [disks/about](https://docs.liara.ir/paas/disks/about/) | فایل‌سیستم اپ **به‌طور پیش‌فرض ReadOnly** است؛ دیسک پوشه‌های مشخص را ماندگار می‌کند؛ حالت Writable بدون دیسک با توقف/ری‌استارت از بین می‌رود؛ پشتیبان با FTP/wget/کنسول | کارایی، سقف تعداد دیسک، رفتار با چند replica، حذف اپ |
| [disks/create](https://docs.liara.ir/paas/disks/create/) | `liara disk:create -a <app> -n <name> -s <GB>` (اعشار مجاز)؛ حجم باید در «فضای قابل رزرو» بگنجد | قیمت، حداقل/حداکثر، ظرفیت پلن شما |
| [disks/route](https://docs.liara.ir/paas/disks/route/) | `liara.json` → `disks[{name,mountTo}]`؛ مسیر مطلق/نسبی؛ `/` ممنوع؛ اعمال با `liara deploy` | تعامل با replica |
| [disks/ftp-access](https://docs.liara.ir/paas/disks/ftp-access/) | FTP access به‌ازای هر دیسک، FTPS پیش‌فرض (FileZilla/WinSCP: TLS/SSL Explicit)، FTP ساده توصیه نمی‌شود | **سقف حجم فایل/انتقال، resumable بودن، host/port** ذکر نشده ⇒ انتقال ≈ ۸۲۸ MB تأییدنشده |
| [docker/how-tos/use-disk](https://docs.liara.ir/paas/docker/how-tos/use-disk/) | مسیر مطلق شامل نام WORKDIR؛ `VOLUME` حذف شود | — |
| [docker/how-tos/deploy-app](https://docs.liara.ir/paas/docker/how-tos/deploy-app/) | `Dockerfile` ریشه یا `build.dockerfile`، `port`، `build.args`، `.liaraignore`؛ `EXPOSE` اختیاری؛ ساخت روی سرورهای Liara | healthcheck در `liara.json` مستند نشد (HEALTHCHECK داخل Dockerfile معیار محلی است نه Liara) |
پیامد مهم about: چون فایل‌سیستم اپ ReadOnly است، سرور باید بدون نوشتن روی `/app` کار کند — همان چیزی که `--read-only --tmpfs /tmp` محلی می‌سنجد و باید در Gate D پاس شود (Next ممکن است `.next/cache` بنویسد).

## ۴. ظرفیت (برآورد محافظه‌کار؛ نه خرید و نه الزام تأییدشده)
| مؤلفه | بایت | توضیح |
|---|---|---|
| DB فعال | 827,924,480 | مقدار واقعی |
| ZIP موقت | 60,178,644 | فقط اگر مسیر ۲ |
| staging import | ≈ 827,924,480 | importer فایل staging کنار DB می‌سازد و جایگزین می‌کند (اتمیک) |
| snapshot rollback | 827,924,480 | نسخهٔ قبلی DB |
| CSV موقت | ≈ 285,300,379 (جمع بازشدهٔ ZIP) | در صورت extract؛ importer با yauzl جریانی است ⇒ بالادست احتمالی |
| سربار FS/حاشیه | ≥ ۲۰٪ | |
- **مسیر ۱ (فقط DB آپلودی + rollback):** ≈ ۰٫۸۳ × ۳ (فعال + دریافت جدید + rollback) ≈ ۲٫۵ GB ⇒ حداقل منطقی **≈ ۲٫۵ GB**.
- **مسیر ۲ (import روی دیسک):** ۰٫۸۳ (فعال) + ۰٫۸۳ (staging) + ۰٫۸۳ (rollback) + ۰٫۰۶ (ZIP) + ≤ ۰٫۲۹ (CSV) ≈ ۲٫۸ GB + ۲۰٪ ⇒ **هدف ≈ ۳–۳٫۵ GB**.
- دیسک ۱ GB کافی نیست. RAM: اندازه‌گیری محلی ≈ ۲۰۰–۲۶۰ MiB RSS (بخشی page‑cache)، قبلی Docker ≈ ۵۷۸ MiB پس از پروفایل ⇒ **برآورد اولیه ≥ ۱ GB RAM تعریف‌شده، ترجیحاً ۲ GB**؛ اندازه‌گیری روی پلن واقعی لازم است. قیمت/سهمیهٔ حساب شما **دریافت نشد** ⇒ `NOT VERIFIED`.

## ۵. دو مسیر انتقال خصوصی
**مسیر ۱ — انتقال DB تأییدشده با FTPS:**
1. مالک دیسک و FTP access (نام کاربری) را در کنسول می‌سازد (Gate L).
2. محلی: `sha256sum data/app.sqlite` (باید `47225ae5…156de5` باشد) و `db:verify`.
3. آپلود با FileZilla/WinSCP در حالت FTPS Explicit به مسیر موقت دیسک (نه داخل `public/`، نه از endpoint Next)؛ نام نهایی بعد از تأیید.
4. تأیید: اندازهٔ بایتی برابر ۸۲۷٬۹۲۴٬۴۸۰؛ هش بعد از آپلود فقط اگر shell/exec یا دانلود پشتیبان امکان دهد؛ در غیر این‌صورت `/api/ready` + شمارش‌ها + `db:verify` (اگر اجرا شود).
5. **BLOCKED تا روشن شود:** سقف FTP، resume، و راه اجرای هش روی دیسک.
**مسیر ۲ — ZIP خصوصی + import یک‌بار روی دیسک:** نیازمند اجرای Job/کانتینر writable یک‌باره روی همان دیسک (`npm run db:import`)؛ Liara چنین Job مستندی در صفحات خوانده‌شده نشان نداد ⇒ **BLOCKED / نیازمند توضیح پشتیبانی Liara**. اگر ZIP روی دیسک بماند باید غیرقابل‌دانلود و فقط در پوشه‌ای باشد که هیچ route وب به آن اشاره نمی‌کند؛ حذف فقط با تأیید صریح پس از پشتیبان.
**پیشنهاد:** مسیر ۱ (ساده‌ترین، ZIP از Liara بیرون می‌ماند) به‌شرط روشن شدن سقف FTP.

## ۶. سرویس‌دهی، پروکسی، نقشه
- **تک‌replica**: limiter/semaphore/cache درون‌پروسه‌ای ⇒ هرگز scale‑out. مأموریت‌ها روی دستگاه کاربر می‌مانند.
- **`TRUST_PROXY_HEADERS`**: تنظیم‌نشده می‌ماند تا آزمون محدود نشان دهد لبهٔ Liara `X-Forwarded-For` ورودی را بازنویسی می‌کند (روش: درخواست با `X-Forwarded-For: 203.0.113.9` و بررسی سطل rate‑limit/پاسخ). پیامد فعلی: همهٔ کلاینت‌ها یک سطل مشترک دارند؛ `API_POST_RATE_PER_MIN` (پیش‌فرض ۱۲۰) و `AGENT_RATE_PER_MIN` برای ترافیک داور/دمو باید بالا‌تر از کل ترافیک مورد انتظار تنظیم شود تا یک کاربر پرتکرار بقیه را قفل نکند؛ ریسک DoS با یک مشتری شلوغ پذیرفته‌شده و باید مالک تأیید کند.
- **نقشه:** جدول تصمیم کامل در `docs/deployment-packet.md §۷` (OSM community: بدون SLA، فقط کم‌حجم، attribution «© OpenStreetMap contributors»؛ تجاری؛ خودمیزبان؛ بدون کاشی). سیاست‌های زنده در این نشست **دوباره بررسی نشد** ⇒ NOT VERIFIED. پیش‌فرض این برنامه: **بدون کاشی** (`MAP_TILES_DISABLED=1`) تا مالک ارائه‌دهنده را انتخاب کند؛ تغییر نیازمند build جدید (CSP `img-src` از env زمان build).
- مدل: `AGENT_PROVIDER=mock` (برچسب «برنامه‌ریز آفلاین، نه مدل زبانی» در UI)، بدون `AGENT_API_KEY`، `LIVE_MODEL_CALLS_ENABLED_IN_CODE=false` (تست `live-guard.test.ts` و `deploy-config.test.ts`).

## ۷. انتشار و rollback (برنامه؛ بدون اجرا)
1. پیش از هر انتشار: مالک بازبینی sanitized commit را می‌پذیرد (بخش ۸)؛ دقیقاً همان revision محلی که Gate D را پاس کرد deploy می‌شود.
2. Gate L: حساب/اپ/پلن/هزینه/دیسک/مسیر/دامنه/روش انتقال/سیاست نقشه/حق انتشار.
3. ایجاد دیسک و `liara.json` واقعی (نه `.example`) با نام تأییدشده؛ `liara deploy` تک‌نمونه؛ سپس انتقال DB.
4. smoke تولید روی URL مجاز در ۳۶۰/۳۹۰/۷۶۸/۱۴۴۰ + دستیار mock؛ ثبت RSS/ری‌استارت؛ لاگ بدون query/body.
5. rollback غیرمخرب: نگه‌داشتن DB قبلی کنار جدید (`app.sqlite` و `app.prev.sqlite`)، سوییچ با نام/DATABASE_PATH؛ بازگرداندن نسخهٔ قبلی image از رجیستری Liara؛ هیچ حذف دیسک/اپ بدون تأیید مجزا. توقف فوری اگر: `/api/ready` نادرست، دادهٔ کهنه/ناموجود، قیمت/موجودی ساختگی، فرار فراخوانی مدل از قفل، نشت راز.

## ۸. منشأ سورس و برنامهٔ commit (بدون اجرا)
- مبنا `9989a7a` **کافی نیست**: تغییرات uncommitted لازم‌اند (ورودی‌های بالا). دقیقاً همین working tree را Docker/Liara باید بسازد؛ برای اثبات منشأ پس از تأیید مالک یک commit واحد پیشنهاد می‌شود و hash آن در گزارش Docker ثبت شود.
- گروه‌بندی پیشنهادی: (۱) مسیر خروجی QA + hygiene تست‌ها (e2e/scripts/helpers/vitest/playwright config)؛ (۲) دو رفع باگ UI (`agent-chat.module.css`، `assistant/loading.tsx`) + selectorهای e2e؛ (۳) قالب Liara و ignoreها + تست‌های پیکربندی؛ (۴) مستندات. `.claude/` و `qa-artifacts/` ردیابی نمی‌شوند. پیش از commit: `git diff --stat`، بازبینی اینکه هیچ DB/ZIP/`.env` استیج نشده (`git status --ignored` را بررسی کنید).
