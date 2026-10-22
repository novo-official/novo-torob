import type { PriceSummary } from "@/domain/advisor";
import { formatToman, toFaDigits } from "@/lib/format";
import { cn } from "@/lib/cn";

const UNIT: Record<string, string> = { per_metre: " (قیمت هر متر)", roll_or_pack: " (حلقه یا بسته)" };

/**
 * The only way prices are displayed. A range appears ONLY when the comparable offers agree
 * (status "reliable"); otherwise the honest Persian reason is shown and no number is presented as "the price".
 */
export function PriceLine({ price, className, detail = false }: { price: PriceSummary; className?: string; detail?: boolean }) {
  if (price.status === "reliable" && price.min !== null && price.max !== null) {
    const same = price.min === price.max;
    const stale = (price.staleShare ?? 0) >= 0.5;
    return (
      <div className={cn("space-y-0.5", className)}>
        <p className="font-bold">
          {same ? formatToman(price.min) : `${formatToman(price.min)?.replace(" تومان", "")} تا ${formatToman(price.max)}`}
          <span className="text-xs font-normal text-ink-2">{UNIT[price.unitHint ?? ""] ?? ""}</span>
        </p>
        <p className="text-xs text-ink-2">
          {price.reliableCount === 1 ? "یک پیشنهاد ثبت‌شده" : `${toFaDigits(price.reliableCount)} پیشنهاد قابل مقایسه`}
          {stale ? " · بیشتر قیمت‌ها قدیمی‌اند" : ""}
        </p>
      </div>
    );
  }
  return (
    <div className={cn("space-y-0.5", className)}>
      <p className="text-sm font-semibold text-warn-ink">{price.label}</p>
      {detail && price.min !== null && price.max !== null ? (
        <p className="text-xs text-ink-2">
          فقط برای اطلاع (قابل مقایسه نیست): از {formatToman(price.min)?.replace(" تومان", "")} تا {formatToman(price.max)}
        </p>
      ) : null}
    </div>
  );
}
