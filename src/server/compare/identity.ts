import type { VariantGroup } from "@/domain/advisor";
import type { ComparableOfferIdentity, ComparisonTier, IdentityEvidenceCode } from "@/domain/comparison";
import { areSiblingKeys, toAsciiDigits } from "@/server/domain/text";

export interface EngineOffer {
  offerId: string;
  productId: string;
  shopId: string;
  sellerTitle: string;
  priceToman: number | null;
  priceRaw: string | null;
  priceOutOfRange: boolean;
  priceChangedAt: string | null;
  unitHint: "per_metre" | "roll_or_pack" | "unknown";
  modelKeys: string[];
  flags: string[];
  groupId: string;
  sourceRow: number | null;
  warranty: { months: number | null; provider: string | null; description: string | null };
}

type RefGroup = Pick<VariantGroup, "id" | "unitHint" | "modelKey">;

const IDENTITY_BLOCKING = new Set(["VARIANT_MODEL_MISMATCH", "UNIT_AMBIGUOUS"]);

/**
 * Explicit pack counts only («۲ عددی», «پک ۱۰», «۵ تایی»). Never inferred from price. 1 is the same as "not stated".
 * A false positive can only REDUCE claims (it marks a mismatch), never create a cheapest claim.
 */
export function extractPackQuantity(title: string | null | undefined): { value: number; evidence: string } | null {
  if (!title) return null;
  const t = toAsciiDigits(title.normalize("NFKC")).replace(/‌/g, " ").replace(/ي/g, "ی").replace(/ك/g, "ک");
  const patterns: RegExp[] = [
    /(?<!\d)(\d{1,3})\s*(?:عددی|تایی|تائی|دانه‌?ای|پکی|بسته‌?ای)(?![\p{L}])/u,
    /(?<![\p{L}])(?:پک|پکیج|بسته|ست|دست)\s*(\d{1,3})(?:\s*(?:عددی|تایی|عدد|تا|دانه))?(?![\d\p{L}])/u,
    /(?<!\d)(\d{1,3})\s*(?:عدد|دانه)(?![\p{L}])/u,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const v = Number(m[1]);
      if (v >= 2 && v <= 999) return { value: v, evidence: m[0].trim() };
    }
  }
  return null;
}

export const UNIT_OF_SALE_FA = { per_metre: "قیمت هر متر", roll_or_pack: "حلقه/بسته", unknown: "واحد ذکر نشده (بدون فرض «تکی»)" } as const;

export interface ClassifyArgs {
  offer: EngineOffer;
  selected: RefGroup | null;
}

/** Tier rules (see src/domain/comparison.ts). Pure and deterministic. */
export function classifyIdentity({ offer, selected }: ClassifyArgs): { tier: ComparisonTier; evidence: IdentityEvidenceCode[] } {
  if (!selected) return { tier: "D", evidence: ["VARIANT_NOT_SELECTED"] };
  if (offer.groupId !== selected.id) {
    if (offer.unitHint !== selected.unitHint) return { tier: "C", evidence: ["UNIT_MISMATCH"] };
    if (selected.modelKey && offer.modelKeys.some((k) => areSiblingKeys(k, selected.modelKey!))) return { tier: "C", evidence: ["SIBLING_MODEL"] };
    if (!offer.modelKeys.length || !selected.modelKey) return { tier: "D", evidence: ["NO_MODEL_KEY_VS_KEYED"] };
    return { tier: "D", evidence: ["UNRELATED_MODEL"] };
  }
  const capped = offer.flags.some((f) => IDENTITY_BLOCKING.has(f));
  const key = selected.modelKey;
  const exact = !!key && offer.modelKeys.includes(key) && !offer.modelKeys.some((k) => k !== key && areSiblingKeys(k, key));
  if (exact && !capped) return { tier: "A", evidence: ["EXACT_MODEL_KEY"] };
  const evidence: IdentityEvidenceCode[] = [];
  if (exact) evidence.push("EXACT_MODEL_KEY");
  else evidence.push(key ? "FAMILY_KEY_ONLY" : "SAME_GROUP_NO_KEY");
  if (capped) evidence.push("IDENTITY_FLAG_CAP");
  return { tier: "B", evidence };
}

export function toIdentity(offer: EngineOffer, selected: RefGroup | null, forced?: { tier: ComparisonTier; evidence: IdentityEvidenceCode[] }): ComparableOfferIdentity {
  const c = forced ?? classifyIdentity({ offer, selected });
  return {
    offerId: offer.offerId, productId: offer.productId, shopId: offer.shopId, rawSellerTitle: offer.sellerTitle, variantGroupId: offer.groupId,
    modelKeys: offer.modelKeys, referenceModelKey: selected?.modelKey ?? null, unitHint: offer.unitHint, unitOfSaleFa: UNIT_OF_SALE_FA[offer.unitHint],
    packQuantity: extractPackQuantity(offer.sellerTitle), tier: c.tier, evidence: c.evidence,
    source: { sourceType: "torob_dataset", sourceName: "Torob hackathon dataset", claimType: "registered_offer", scopeLimits: ["موجودی لحظه‌ای را تأیید نمی‌کند؛ زمان قیمت لحظه‌ی ثبت داده است."], file: "offers.csv", row: offer.sourceRow },
  };
}
