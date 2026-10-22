# هم‌قدم — دستیار خرید حضوری تهران (novo-torob)

فاز ۱: مستندات + فرانت‌اند Next.js (موبایل‌اول، RTL). فاز ۲: واردسازی کامل دیتاست به SQLite با پرچم‌های کیفیت، ساعت کاری سه‌حالته، FTS5 فارسی. **فاز ۳: مشاور انتخاب محصول و جست‌وجوی فارسی روی کاتالوگ واقعی** (`/discover`, `/search`, `/products/[id]`, `/compare/products`) بدون LLM. **فاز ۴: فروشنده‌های اطراف** (`/sellers`, `/shops/[id]`, نقشه‌ی Leaflet + فهرست، مناطق خرید منبع‌دار؛ `docs/phase-4-sellers.md`) — فقط فروشگاه‌هایی با offer واقعی همان محصول، فاصله‌ی خط مستقیم، GPS اختیاری و گردشده. **فاز ۵: مقایسه‌ی فروشنده** (`/compare`؛ `docs/phase-5-compare.md`) با سطح هویت A–D و بدون اجبار برنده. **فاز ۶: پرسش و پیگیری** (`/missions/new?product&variant&shop&offer`؛ `docs/phase-6-communication.md`): پیش‌نویس دسته‌آگاه، ثبت دستی پاسخ، حالت «شبیه‌سازی — فقط دمو» با برچسب روی هر پیام؛ هیچ پیام/تماس واقعی وجود ندارد و **موجودی هرگز تأییدشده فرض نمی‌شود**. **فاز ۷: دستیار گفت‌وگومحور** (`/assistant`؛ `docs/phase-7-agent.md`) روی همان سرویس‌های قطعی با ۱۲ ابزار تایپ‌شده، grounding سخت و fallback قطعی؛ حالت پیش‌فرض یک **برنامه‌ریز mock است، نه مدل زبانی**؛ مدل زنده و منابع بیرونی زنده **NOT VERIFIED**.

## اجرا
```bash
npm install
npm run dev            # http://localhost:3000
npm run check          # typecheck + lint + test
npm run build && npm start
npm run test:e2e       # Playwright با Chrome سیستمی (build + start خودکار روی پورت ۳۱۰۰)
npm run qa:screens     # اسکرین‌شات‌ها در docs/qa/
npm run eval           # ارزیابی جست‌وجو (docs/eval/phase-3-results.json)
npm run advisor:coverage -- --samples   # شکاف‌های شاهد در دسته‌های مشاور
npm run agent:eval     # ۸۰ سناریوی دستیار (mock) → docs/qa/agent-eval-mock.json
```
## داده (فاز ۲)
```bash
npm run db:import            # .data/torob-dataset.zip → data/app.sqlite (≈ ۲۷ ثانیه، ≈ ۷۴۲ MiB، اتمیک و idempotent)
npm run db:verify            # بررسی‌های درستی روی DB واقعی (کد خروج ≠ ۰ در صورت خطا)
npm run db:import:fixture && npm run db:verify:fixture   # fixture ساختگی، سریع برای CI
docker compose --profile tools run --rm importer && docker compose up -d --build app   # اجرای production-like
```
نیازمندی‌ها: Node ≥ 22.5 (هدف 24؛ از `node:sqlite` استفاده می‌شود)، Google Chrome برای e2e، Docker (اختیاری).

**فاز ۸: ماموریت‌ها** (`/missions`؛ `docs/phase-8-missions.md`): ادامه‌ی خرید پس از انتخاب فروشنده با ذخیره‌ی opt-in سمت مرورگر، فهرست آمادگی و بازیابی قطعی؛ «آماده مراجعه» یعنی مرور‌شده، نه موجودی تأییدشده.

**فاز ۹:** صیقل کل محصول (`/missions/new` مرحله‌ای)، شواهد بیرونی واقعی با ارجاع (opt-in)، CSP، قفل مدل زنده در کد (**هیچ مدلی صدا زده نمی‌شود**)، QA جامع — `docs/phase-9-quality.md`؛ برنامه‌ی آزمایش زنده‌ی محدود (اجرا‌نشده): `docs/phase-10-live-trial-plan.md`.

## دستیار (فاز ۷) — متغیرهای محیطی (همه اختیاری؛ `.env.example`)
`AGENT_PROVIDER=mock|openai-compatible|disabled` (پیش‌فرض mock) · `AGENT_EVIDENCE_MODE=off|fixture|live` (پیش‌فرض off) · برای مدل زنده `AGENT_BASE_URL` (https) + `AGENT_MODEL` + `AGENT_API_KEY` (فقط سمت سرور؛ بدون تأیید هزینه‌ی مالک اجرا نکنید) · `AGENT_RATE_PER_MIN`، `AGENT_MAX_CONCURRENT`.

## مستندات
`docs/phase-9-quality.md` · `docs/phase-10-live-trial-plan.md` · `docs/phase-8-missions.md` · `docs/phase-7-agent.md` · `docs/phase-3-advisor.md` · `phase-3-evaluation.md` · `docs/phase-2-data.md` · `data-dictionary.md` · `deployment.md` · `requirements.md` · `journeys.md` · `ux-blueprint.md` · `architecture.md` · `rubric-matrix.md` · `phase-plan.md` · `qa/README.md`

## قواعد اعتماد
بدون ادعای موجودی؛ هیچ پیامی به فروشنده فرستاده نمی‌شود؛ شماره‌های دیتاست ساختگی‌اند؛ `.data/` هرگز commit نمی‌شود.
