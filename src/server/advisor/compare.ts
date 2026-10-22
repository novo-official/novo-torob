import type { DatabaseSync } from "node:sqlite";
import type { CompareResponse, CompareRow } from "@/domain/advisor";
import { fetchProductRows, toCard, variantSignals } from "@/server/catalog/rows";
import { formatAttrValue, schemaForCategory } from "./schemas";
import { buildProductText, lite } from "./specs";

export const COMPARE_LIMITS = { min: 2, max: 4, rows: 28 } as const;

/** Side-by-side comparison of 2–4 catalog products: raw spec rows, schema attributes with evidence, honest price cards. */
export function compareProducts(db: DatabaseSync, ids: readonly string[]): CompareResponse | null {
  const uniq = [...new Set(ids)].slice(0, COMPARE_LIMITS.max);
  const rows = fetchProductRows(db, uniq);
  const prods = uniq.map((id) => rows.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  if (prods.length < COMPARE_LIMITS.min) return null;

  const sameCategory = new Set(prods.map((p) => p.categoryName)).size === 1;
  const schema = sameCategory ? schemaForCategory(prods[0]!.categoryName) : undefined;
  const texts = prods.map((p) => buildProductText(p.title, p.specsJson));

  const keyInfo = new Map<string, { label: string; count: number }>();
  texts.forEach((t) => {
    const seen = new Set<string>();
    for (const s of t.specs) {
      if (seen.has(s.nkey)) continue;
      seen.add(s.nkey);
      const k = keyInfo.get(s.nkey) ?? { label: s.key, count: 0 };
      k.count++;
      keyInfo.set(s.nkey, k);
    }
  });
  const specRows: CompareRow[] = [...keyInfo.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, COMPARE_LIMITS.rows)
    .map(([nkey, info]) => {
      const values = texts.map((t) => t.specs.find((s) => s.nkey === nkey)?.value.slice(0, 120) ?? null);
      const norm = values.map((v) => (v === null ? null : lite(v)));
      const known = norm.filter((v): v is string => v !== null);
      return { key: nkey, label: info.label, values, differs: new Set(known).size > 1 || (known.length > 0 && known.length < values.length) };
    });

  const notes: string[] = [];
  if (!sameCategory) notes.push("این محصولات از یک دسته نیستند؛ مقایسه‌ی ویژگی‌ها محدود است.");
  if (!schema) notes.push("برای این دسته ویژگی‌های کلیدی تعریف نشده؛ فقط مشخصات خام ثبت‌شده مقایسه می‌شود.");
  notes.push("هیچ امتیاز کیفیت یا نظر کاربران در داده نیست؛ تفاوت‌ها فقط بر پایه‌ی مشخصات و قیمت ثبت‌شده است.");

  return {
    products: prods.map((p, i) => ({
      card: toCard(p, variantSignals(db, p.id)),
      attributes: schema
        ? Object.entries(schema.extract(texts[i]!)).map(([id, a]) => ({
            id, label: schema.attributeLabels[id] ?? id,
            value: formatAttrValue(id, a.value),
            confidence: a.confidence,
          }))
        : [],
    })),
    specRows, sameCategory, notes,
  };
}
