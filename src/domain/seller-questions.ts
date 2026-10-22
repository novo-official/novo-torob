import type {
  ChannelAvailability,
  ContactChannel,
  QuestionIntent,
  RecordedSellerResponse,
  SellerQuestionDraft,
} from "./types";

export const QUESTION_INTENTS: ReadonlyArray<{ id: QuestionIntent; label: string; question: string }> = [
  { id: "stock_availability", label: "موجودی", question: "آیا این کالا همین حالا موجود است؟" },
  { id: "exact_variant", label: "مدل دقیق", question: "آیا دقیقاً همین مدل/نسخه را دارید؟ (مدل مشابه یا جایگزین مدنظر نیست.)" },
  { id: "fresh_price", label: "قیمت روز", question: "قیمت امروز چقدر است و تا چه زمانی معتبر است؟" },
  { id: "payment", label: "روش پرداخت", question: "چه روش‌های پرداختی (نقد، کارت، اعتباری) پذیرفته می‌شود؟" },
  { id: "installments", label: "اقساط", question: "آیا خرید اقساطی امکان‌پذیر است؟ شرایطش چیست؟" },
  { id: "warranty", label: "گارانتی", question: "گارانتی چند ماهه است و از طرف کدام شرکت؟" },
  { id: "hours", label: "ساعت مراجعه", question: "امروز تا چه ساعتی برای مراجعه‌ی حضوری باز هستید؟" },
  { id: "locate_in_mall", label: "نشانی واحد", question: "نشانی دقیق واحد (پاساژ، طبقه، شماره) را بفرمایید." },
];

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const faNum = (n: number) => String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]!);

/**
 * Only channels with trust === "verified" may be offered as actionable.
 * Dataset phone numbers are synthetic and therefore never qualify.
 */
export function resolveChannel(channels: ContactChannel[]): ChannelAvailability {
  const verified = channels.find((c) => c.trust === "verified");
  if (verified) return { available: true, kind: verified.kind, value: verified.value };
  return {
    available: false,
    reason: "NO_VERIFIED_CHANNEL",
    userMessage: "راه ارتباطی تأییدشده در داده‌ها موجود نیست",
  };
}

export interface DraftInput {
  productTitle: string;
  /** Optional free-text variant details typed by the user (colour, capacity, size…). */
  variantNote?: string;
  /** Optional: the shop the user chose to ask (display name from the dataset). Never implies any contact happened. */
  shopName?: string;
  intents: QuestionIntent[];
  channels?: ContactChannel[];
}

/** Deterministic, local, side-effect free. Produces text for the USER to copy; nothing is sent. */
export function buildQuestionDraft(input: DraftInput): SellerQuestionDraft {
  const intents = QUESTION_INTENTS.filter((q) => input.intents.includes(q.id));
  const title = input.productTitle.trim();
  const note = input.variantNote?.trim();
  const shop = input.shopName?.trim();
  const lines: string[] = ["سلام، وقت بخیر.", `درباره‌ی «${title}»${note ? ` (${note})` : ""}${shop ? ` در فروشگاه «${shop}»` : ""} چند سؤال داشتم:`];
  intents.forEach((q, i) => lines.push(`${faNum(i + 1)}. ${q.question}`));
  lines.push("ممنون از وقتی که می‌گذارید.");
  return {
    intents: intents.map((q) => q.id),
    text: lines.join("\n"),
    channel: resolveChannel(input.channels ?? []),
  };
}

/** Intents that were drafted but still have no manually recorded response. */
export function unresolvedIntents(drafted: QuestionIntent[], responses: Pick<RecordedSellerResponse, "intent">[]): QuestionIntent[] {
  const answered = new Set(responses.map((r) => r.intent));
  return drafted.filter((i) => !answered.has(i));
}

export const MANUAL_RESPONSE_LABEL = "ثبت دستی توسط شما — تأییدنشده";
