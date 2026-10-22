# استقرار — برش آمادگی (فاز ۲)

> **به‌روزرسانی ۱۰A:** بستهٔ کامل و الگوهای استقرار (بدون اجرا): `docs/deployment-packet.md` و `deploy/`. تک‌نمونه الزامی است.

> **وضعیت:** اجرای محلی production-like با Docker **تأیید شد**. هیچ استقرار بیرونی (staging/production) انجام **نشده** و بدون اجازه‌ی صریح مالک انجام نمی‌شود.

## اجرا
```bash
docker compose --profile tools run --rm importer   # ساخت /data/app.sqlite از .data/torob-dataset.zip (فقط‌خواندنی mount)
APP_PORT=3000 docker compose up -d --build app      # سرو
curl localhost:3000/api/health   # liveness  → {"status":"ok"}
curl localhost:3000/api/ready    # readiness → 200 فقط اگر DB موجود و import کامل باشد، وگرنه 503
docker compose --profile tools run --rm importer npm run db:verify   # بررسی‌های درستی داخل کانتینر
```
- `app`: تصویر Next.js standalone (≈ ۳۸۴ مگابایت اندازه‌گیری‌شده)، کاربر غیر root (`node`)، فایل‌سیستم **فقط‌خواندنی** + `/tmp` tmpfs، volume داده `:ro`، `no-new-privileges`.
- `importer` (profile `tools`): تنها نویسنده‌ی volume. image جدا؛ در زمان اجرای production وجود ندارد.
- **HEALTHCHECK** در Dockerfile بر `/api/health` (بدون وابستگی به DB تا نبود DB باعث restart-loop نشود)؛ readiness برای orchestrator: `/api/ready`.

## پایداری و پشتیبان
- DB یک فایل واحد در volume نام‌دار `torob-data` است و **از دیتاست قابل بازسازی کامل** است (≈ ۲۷ ثانیه)؛ پس اولویت پشتیبان کم است. در صورت نیاز، هنگام سکون (بدون import در جریان): 
  `docker run --rm -v novo-torob_torob-data:/data -v "$PWD":/backup busybox cp /data/app.sqlite /backup/app.sqlite.bak`
- بازسازی/به‌روزرسانی داده: importer دوباره اجرا می‌شود؛ جایگزینی **اتمیک** است (rename)، و app (با اتصال فقط‌خواندنی باز) تا restart نسخه‌ی قبلی را می‌بیند. چرخه‌ی restart بعد از import: `docker compose restart app`.
- هیچ داده‌ی دیتاست یا DB در image یا گیت نیست (`.dockerignore`، `.gitignore`، `outputFileTracingExcludes`).

## چه چیزی تأیید **نشده** است
- استقرار روی میزبان واقعی، DNS/TLS، reverse proxy، مانیتورینگ، لاگ‌گیری مرکزی.
- رفتار با چند replica (SQLite فقط‌خواندنی با volume مشترک ممکن است ولی آزموده نشده).
- Node/SQLite داخل کانتینر نسخه‌ی SQLite ‏3.53.4 دارد و میزبان ‏3.53.3؛ ساختار فایل سازگار است (db:verify داخل کانتینر روی DB ساخته‌شده در کانتینر گذشت).


## چک‌لیست آمادگی پیش از استقرار (فاز ۹؛ هیچ‌کدام اجرا نشده)
- [ ] تأیید مالک برای میزبان (+ DNS/TLS/reverse proxy). [ ] انتخاب ارائه‌دهنده‌ی کاشی نقشه و به‌روزرسانی CSP `img-src` (OSM community برای بار تولید مناسب نیست).
- [ ] اسرار فقط در محیط سرور؛ compose دیگر کلید/URL/مدل عبور نمی‌دهد (مدل زنده قفل است: `docs/phase-10-live-trial-plan.md`).
- [ ] هدرها/CSP تأیید‌شده در Docker محلی؛ CSP با nonce (فاز ۹.۱؛ `style-src` هنوز `unsafe-inline`). [ ] rate‑limit/کش شواهد درون‌پردازه‌ای است (چند replica ⇒ سقف هر instance).
- [ ] `AGENT_EVIDENCE_MODE=live` فقط با `AGENT_EXTERNAL_LIVE=1` و پس از مرور رجیستری `reviewed-sources.ts` و شرایط استفاده‌ی منابع.
- [ ] smoke محلی Docker (فاز ۹): health/ready/هدرها/سفر انتشار/قفل مدل ✅.
