import { formatToman } from "@/lib/format";
import type { DemoScenarioId, InquiryContext, ReplyEvidence } from "./inquiry";

/**
 * DEMO MODE — scripted, offline, deterministic. Everything produced here is FICTION and is tagged DEMO_SIMULATED:
 * it is derived from a real selected offer only as a scenario seed; it never states what a real seller said, never touches the
 * catalog, never enters a manual inquiry, and has no delivery receipts, channels or wall-clock timestamps.
 */
export const DEMO_SCENARIOS: ReadonlyArray<{ id: DemoScenarioId; labelFa: string; descriptionFa: string }> = [
  { id: "AVAILABLE", labelFa: "نمونه: فروشنده می‌گوید موجود است", descriptionFa: "نمونه‌ی پاسخ مثبت با همان قیمت" },
  { id: "NOT_AVAILABLE", labelFa: "نمونه: فروشنده می‌گوید موجود نیست", descriptionFa: "نمونه‌ی پاسخ منفی؛ مسیر یافتن فروشنده‌ی دیگر" },
  { id: "PRICE_CHANGED", labelFa: "قیمت تغییر کرده", descriptionFa: "قیمت نمونه با قیمت ثبت‌شده فرق دارد" },
  { id: "VARIANT_DIFFERENT", labelFa: "مدل دیگری دارند", descriptionFa: "پاسخ به مدل متفاوتی اشاره می‌کند؛ تأیید همین کالا مسدود می‌شود" },
  { id: "WARRANTY_OR_PAYMENT_CHANGED", labelFa: "گارانتی یا پرداخت فرق دارد", descriptionFa: "شرایط گارانتی/پرداخت نمونه با داده نمی‌خواند" },
  { id: "NO_RESPONSE", labelFa: "پاسخی نمی‌آید", descriptionFa: "مسیر پیگیری و فروشنده‌ی دیگر" },
];

export const DEMO_TAG = "نمونه‌ی شبیه‌سازی‌شده — واقعی نیست";
export const DEMO_BANNER = "حالت شبیه‌سازی — فقط دمو";

export interface DemoMessage { id: string; sender: "user_sim" | "seller_sim" | "system_sim"; textFa: string; provenance: "DEMO_SIMULATED"; tagFa: string }
export interface DemoRun { scenarioId: DemoScenarioId; messages: DemoMessage[]; reply: ReplyEvidence | null }

/** FNV-1a — stable across runs/platforms; only used to vary scripted numbers per offer. */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

export function altModelKey(key: string | null): string | null {
  if (!key) return null;
  return /-B$/.test(key) ? key.replace(/-B$/, "-A") : `${key}-B`;
}

export function runDemoScenario(ctx: InquiryContext, scenarioId: DemoScenarioId, userText: string): DemoRun {
  const seed = seedOf(`${ctx.offer.id}|${scenarioId}`);
  const rec = ctx.offer.priceToman;
  const base: Omit<ReplyEvidence, "id" | "rawText" | "stock" | "reportedPriceToman" | "model"> = {
    provenance: "DEMO_SIMULATED", reportedUnit: "same", warranty: { report: "not_asked", months: null }, payment: "not_asked", visitNote: "", receivedLabel: "پاسخ نمونه‌ی شبیه‌سازی‌شده", scenarioId,
  };
  const msg = (n: number, sender: DemoMessage["sender"], textFa: string): DemoMessage => ({ id: `demo-${scenarioId}-${n}`, sender, textFa, provenance: "DEMO_SIMULATED", tagFa: DEMO_TAG });
  const messages: DemoMessage[] = [msg(0, "user_sim", userText)];
  const mk = (text: string, over: Partial<ReplyEvidence>): ReplyEvidence => ({ ...base, id: `demo-reply-${scenarioId}`, rawText: text, stock: "unknown", reportedPriceToman: null, model: "not_asked", ...over });

  let reply: ReplyEvidence | null = null;
  switch (scenarioId) {
    case "AVAILABLE": {
      const t = `بله، موجود است${rec !== null ? ` و همان قیمت ${formatToman(rec)} است` : ""}. تا عصر برایتان نگه می‌داریم.`;
      messages.push(msg(1, "seller_sim", t));
      reply = mk(t, { stock: "yes", reportedPriceToman: rec, model: "same" });
      break;
    }
    case "NOT_AVAILABLE": {
      const t = "متأسفانه این کالا الان موجود نیست و تا هفته‌ی بعد هم نمی‌رسد.";
      messages.push(msg(1, "seller_sim", t));
      reply = mk(t, { stock: "no" });
      break;
    }
    case "PRICE_CHANGED": {
      const pcts = [0.08, 0.12, 0.15, -0.07];
      const pct = pcts[seed % pcts.length]!;
      const price = roundTo((rec ?? 1_000_000 * (1 + (seed % 9))) * (1 + pct), 10_000);
      const t = `موجود است ولی قیمت امروز ${formatToman(price)} شده، چون خرید جدید گران‌تر بود.`.replace("گران‌تر بود", pct < 0 ? "ارزان‌تر شد" : "گران‌تر بود");
      messages.push(msg(1, "seller_sim", t));
      reply = mk(t, { stock: "yes", reportedPriceToman: price, model: "same" });
      break;
    }
    case "VARIANT_DIFFERENT": {
      const alt = altModelKey(ctx.variant.modelKey);
      const t = alt ? `همین مدل را نداریم؛ مدل ${alt} موجود است که کمی با این متفاوت است.` : "همین نسخه را نداریم؛ نسخه‌ی دیگری از همین سری موجود است که کمی متفاوت است.";
      messages.push(msg(1, "seller_sim", t));
      reply = mk(t, { stock: "yes", model: "different" });
      break;
    }
    case "WARRANTY_OR_PAYMENT_CHANGED": {
      const t = "موجود است، اما این کالا گارانتی ندارد و فقط پرداخت نقدی قبول می‌کنیم.";
      messages.push(msg(1, "seller_sim", t));
      reply = mk(t, { stock: "yes", model: "same", warranty: { report: "none", months: null }, payment: "not_available" });
      break;
    }
    case "NO_RESPONSE":
      messages.push(msg(1, "system_sim", "در این سناریو پاسخی نمی‌آید (شبیه‌سازی). در عمل هم ممکن است فروشنده جواب ندهد."));
      break;
  }
  return { scenarioId, messages, reply };
}
