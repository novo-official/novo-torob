import { STAGE_FA, type AgentState, type ClarifyView, type ToolName, type ToolStatus } from "@/domain/agent";
import { PRIORITY_FA } from "@/domain/comparison";
import { formatToman, toFaDigits } from "@/lib/format";
import { radiusLabel } from "@/lib/geo";

export interface ToolRun { tool: ToolName; status: ToolStatus; summary: Record<string, unknown>; notes: string[] }
export interface TurnFacts { state: AgentState; runs: ToolRun[]; clarify: ClarifyView | null; fallback: string | null }

const fa = toFaDigits;
const last = (runs: ToolRun[], t: ToolName) => runs.filter((r) => r.tool === t).at(-1);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Deterministic Persian answer built ONLY from tool results (used by the offline planner and as the safe replacement when a
 * model's text fails grounding). Every number it prints was returned by a tool, so it passes `validateAssistantText` by construction.
 */
export function renderAnswer(f: TurnFacts): string {
  const out: string[] = [];
  const { state, runs } = f;
  const un = last(runs, "understand_or_clarify_need");
  if (un?.summary.reset) return "همه‌ی ترجیحات پاک شد. نیازتان را بنویسید یا مدل دقیق کالا را بگویید تا از اول شروع کنیم.";

  const search = last(runs, "search_products");
  const advise = last(runs, "advise_products");
  const details = last(runs, "get_product_details");
  const sellers = last(runs, "find_sellers_for_product");
  const compare = last(runs, "compare_sellers");
  const areas = last(runs, "recommend_shopping_areas");
  const alts = last(runs, "find_product_alternatives");
  const inquiry = last(runs, "compose_seller_inquiry");
  const reply = last(runs, "summarize_user_reported_reply");
  const evidence = last(runs, "get_external_evidence");
  const hours = last(runs, "get_shop_declared_hours");

  if (un && !un.summary.hasNeed && !un.summary.model && !runs.some((r) => r.tool !== "understand_or_clarify_need") && un.status !== "ok") {
    return "برای شروع بگویید چه کالایی می‌خواهید و برای چه کاری (مثلاً «هدفون ورزشی تا ۳ میلیون» یا «دوربین مدار بسته برای مغازه»)، یا اگر مدل دقیق را می‌دانید کدش را بنویسید.";
  }

  if (search) {
    if (search.status === "not_found") out.push("در نمونه‌ی داده‌ی هکاتون محصولی با این نام یا مدل پیدا نشد. این فقط درباره‌ی همین نمونه‌ی محدود است و به معنی نبودن کالا در بازار تهران نیست.");
    else out.push(`${fa(num(search.summary.count) ?? 0)} محصول مطابق جست‌وجوی شما در داده‌ی رسمی ترب هست${num(search.summary.exactModelMatches) === 1 ? " و کد مدل دقیق فقط به یکی از آن‌ها می‌خورد" : num(search.summary.exactModelMatches) ? " و چند محصول کد مدل یکسان دارند؛ نسخه‌ی دقیق را انتخاب کنید" : ""}.`);
  }
  if (advise) {
    if (advise.status === "ok") {
      const fn = advise.summary.funnel as { inCategory?: number; afterHardFilters?: number } | null;
      out.push(`بر پایه‌ی نیاز و پاسخ‌هایتان ${fa((advise.summary.items as unknown[]).length)} گزینه از داده‌ی رسمی ترب رتبه‌بندی شد${fn?.inCategory ? ` (از ${fa(fn.inCategory)} محصول این دسته)` : ""}. رتبه‌بندی بر پایه‌ی شواهد ثبت‌شده است، نه نظر کاربران یا محبوبیت.`);
    } else if (advise.status === "not_found") out.push(advise.notes[0] ?? "با این شرط‌ها محصولی در نمونه‌ی داده پیدا نشد؛ شرط‌ها را کمی باز کنید.");
  }
  const clarifyText = f.clarify?.text ?? runs.map((r) => str(r.summary.__clarifyText)).filter(Boolean).at(-1);
  if (clarifyText) out.push(`برای دقیق‌تر شدن یک سؤال دارم: ${clarifyText}`);
  if (details && details.status !== "not_found") out.push(`مشخصات و نسخه‌های ثبت‌شده‌ی محصول انتخابی آماده است${details.summary.needsVariantConfirmation ? "؛ پیشنهادها لزوماً یک کالا نیستند و نسخه‌ی دقیق باید تأیید شود" : ""}.`);
  if (sellers) {
    const c = sellers.summary.counts as { shopsWithinRadius?: number; shopsTotal?: number } | undefined;
    const origin = sellers.summary.origin as { label?: string; defaulted?: boolean } | undefined;
    const sit = str(sellers.summary.situation);
    const where = `از «${origin?.label ?? "نقطه‌ی شروع"}»${origin?.defaulted ? " (نقطه‌ی پیش‌فرض؛ محله‌تان را انتخاب کنید)" : ""}`;
    if (sit === "OK") out.push(`${fa(c?.shopsWithinRadius ?? 0)} فروشگاه در شعاع ${radiusLabel(num(sellers.summary.radiusMeters) ?? 1000)} ${where} برای همین محصول پیشنهاد ثبت‌شده دارند (از ${fa(c?.shopsTotal ?? 0)} فروشگاهِ ثبت‌شده در داده). فاصله‌ها خط مستقیم‌اند و پیشنهاد ثبت‌شده به معنی موجودی نیست.`);
    else if (sit === "NO_SHOP_IN_RADIUS") out.push(`در شعاع ${radiusLabel(num(sellers.summary.radiusMeters) ?? 1000)} ${where} فروشگاهی با پیشنهاد ثبت‌شده برای این نسخه در داده نیست. این فقط درباره‌ی نمونه‌ی داده است، نه ادعایی درباره‌ی نبود مغازه در تهران؛ شعاع را بیشتر کنید یا مناطق پیشنهادی را ببینید.`);
    else if (sit === "VARIANT_UNCONFIRMED") out.push("پیش از معرفی فروشنده باید نسخه‌ی دقیق روشن شود، چون پیشنهادها یک کالای یکسان نیستند.");
    else out.push("برای این انتخاب فروشنده‌ی قابل‌اتکایی در نمونه‌ی داده پیدا نشد.");
  }
  if (compare) {
    const v = compare.summary.verdict as { headline?: string; kind?: string } | undefined;
    if (compare.status === "ok" || compare.status === "no_comparable_offer") out.push(`نتیجه‌ی مقایسه (${PRIORITY_FA[state.priority]}): ${v?.headline ?? "برنده‌ای اعلام نمی‌شود"}. فقط قیمت‌ها و ساعت‌های ثبت‌شده/اعلام‌شده در داده را سنجیده‌ایم و نسخه‌ی دقیق از روی عنوان فروشنده حدس زده شده است.`);
    else out.push("برای مقایسه ابتدا نسخه‌ی دقیق و دست‌کم دو فروشگاه لازم است.");
  }
  if (areas) {
    if (areas.status === "ok") out.push("این مناطق فقط جای گشتن را نشان می‌دهند؛ نه فروشنده‌ی مشخصی را معرفی می‌کنند و نه موجودی را تأیید می‌کنند. منبع و تاریخ بررسی هر منطقه روی کارت آمده است.");
    else out.push(areas.notes[0] ?? "شاهد کافی برای معرفی منطقه‌ی خرید نداریم و حدس نمی‌زنیم.");
  }
  if (alts && alts.status === "ok") out.push("چند جایگزین از همان دسته و بودجه‌ی فعلی در داده هست؛ موجودی هیچ‌کدام تأیید نشده است.");
  if (evidence) {
    const st = str(evidence.summary.status);
    if (evidence.status === "disabled") out.push("شواهد بیرونی (مشخصات یا نظر) فعال نیست، پس فقط داده‌ی رسمی ترب را نشان می‌دهم و چیزی از خودم نمی‌سازم.");
    else if (st === "NO_EVIDENCE") out.push("هیچ مشخصات یا نظر بیرونیِ قابل‌راستی‌آزمایی بازیابی نشد؛ داده‌ی رسمی ترب همچنان در دسترس است.");
    else out.push(`${fa(num(evidence.summary.count) ?? 0)} مورد شاهد بیرونی با نشانی و تاریخ بازیابی پیدا شد؛ مشخصات ادعای منبع است و نظرها فقط نظر نویسنده‌اند${evidence.summary.mode === "fixture" ? ". توجه: این‌ها نمونه‌ی آزمایشی‌اند، نه منبع واقعی" : ""}. داده‌ی رسمی ترب تغییر نکرده است.`);
    if (Array.isArray(evidence.summary.conflicts) && evidence.summary.conflicts.length) out.push("منبع بیرونی در یک مورد با داده‌ی رسمی اختلاف دارد؛ هر دو نمایش داده شد و پیشنهادهای رسمی بازنویسی نشد.");
  }
  const asked = (un?.summary.intents as string[] | undefined) ?? [];
  if (asked.includes("send")) out.unshift("من نمی‌توانم پیام بفرستم، تماس بگیرم، سفارش ثبت کنم یا پرداختی انجام دهم؛ فقط پیش‌نویس سؤال می‌سازم که خودتان مستقل بپرسید.");
  if (asked.includes("phone")) out.unshift("شماره‌های تلفن دیتاست ساختگی‌اند و هیچ شماره‌ای نمایش داده یا از طرف برنامه تماس گرفته نمی‌شود. اگر راه ارتباطی تأییدشده‌ای دارید، پیش‌نویس سؤال را کپی کنید و خودتان مستقل بپرسید.");
  if (asked.includes("stock")) out.push("موجودی را از هیچ داده‌ای تأیید نمی‌کنیم: «پیشنهاد ثبت‌شده» یعنی فروشگاه روزی این کالا را با این قیمت ثبت کرده، نه اینکه کالا همین حالا در مغازه باشد. فقط خود فروشنده می‌تواند تأیید کند؛ پیش‌نویس سؤال را آماده کنید.");
  if (asked.includes("hours")) out.push("فقط «ساعت اعلام‌شده‌ی فروشگاه» در داده را می‌سنجیم؛ باز یا بسته بودن لحظه‌ای و تعطیلات رسمی تأیید نمی‌شود و ساعت نامعلوم یعنی نامعلوم، نه بسته.");
  if (inquiry && inquiry.status === "ok") out.push("پیش‌نویس پرسش آماده است. این فقط متن است: چیزی ارسال نشده و باید خودتان از فروشنده بپرسید.");
  if (reply) {
    if (reply.status === "ok") out.push(`${str(reply.summary.headline) ?? "پاسخ ثبت شد"}. ${str(reply.summary.claim) ?? ""} این فقط گزارش شماست و تأیید نشده.`.trim());
    else if (reply.status === "ambiguous") out.push("مبلغ تومان است یا ریال؟ حدس نمی‌زنم؛ یکی را مشخص کنید.");
  }
  if (hours && hours.status !== "not_found") out.push(`وضعیت ساعت اعلام‌شده‌ی فروشگاه: ${str(hours.summary.label) ?? "نامعلوم"}.`);
  if (f.fallback) out.push(f.fallback);

  if (!out.length) out.push(`در مرحله‌ی «${STAGE_FA[state.stage]}» هستیم. بگویید چه کالایی می‌خواهید یا مدل دقیق را بنویسید.`);
  const sellerStage = runs.some((r) => ["find_sellers_for_product", "compare_sellers", "compose_seller_inquiry"].includes(r.tool));
  if (sellerStage) out.push("قیمت‌ها قیمتِ ثبت‌شده در داده‌اند، نه قیمت امروز؛ پیش از رفتن از فروشنده بپرسید.");
  if (state.budget.max !== null && runs.some((r) => r.tool === "advise_products" && r.status === "ok")) out.push(`بودجه‌ی فعلی: حداکثر ${formatToman(state.budget.max)}.`);
  return out.join("\n");
}
