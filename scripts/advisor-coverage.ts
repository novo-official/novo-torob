import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "@/server/db/connect";
import { fetchCategoryRows } from "@/server/catalog/rows";
import { SCHEMAS } from "@/server/advisor/schemas";
import { buildProductText } from "@/server/advisor/specs";

/** Evidence-gap report: how much of each category the question schemas can actually decide. */
const db = new DatabaseSync(resolveDbPath(), { readOnly: true });
const sample = process.argv.includes("--samples");
for (const schema of SCHEMAS) {
  const all = fetchCategoryRows(db, schema.category);
  const isPrimary = (r: (typeof all)[number]) => schema.primary(buildProductText(r.title, r.specsJson));
  const rows = all.filter(isPrimary);
  const dropped = all.filter((r) => !isPrimary(r));
  const attrs = rows.map((r) => ({ r, a: schema.extract(buildProductText(r.title, r.specsJson)) }));
  console.log(`\n=== ${schema.label} (${schema.category}) — ${rows.length} main products (+${dropped.length} spare parts/accessories excluded)`);
  if (sample) console.log("  excluded samples:", dropped.slice(0, 8).map((r) => r.title.slice(0, 40)).join(" | "));
  const conflicts = attrs.reduce((n, { a }) => n + Object.values(a).filter((v) => v.conflict).length, 0);
  console.log(`  title/spec conflicts → unknown: ${conflicts}`);
  for (const id of Object.keys(schema.attributeLabels)) {
    const c = { explicit: 0, inferred: 0, unknown: 0 };
    for (const { a } of attrs) c[a[id]!.confidence]++;
    const pct = (n: number) => `${((100 * n) / rows.length).toFixed(0)}%`;
    console.log(`  attr ${id.padEnd(12)} explicit ${pct(c.explicit).padStart(4)} · inferred ${pct(c.inferred).padStart(4)} · unknown ${pct(c.unknown).padStart(4)}`);
  }
  for (const q of schema.questions) {
    for (const o of q.options) {
      const t = { match: 0, mismatch: 0, unknown: 0 };
      for (const { a } of attrs) t[o.test(a).effect]++;
      console.log(`  Q ${q.id}/${o.id}`.padEnd(28) + `match ${String(t.match).padStart(5)} · mismatch ${String(t.mismatch).padStart(5)} · unknown ${String(t.unknown).padStart(5)}`);
    }
  }
  if (sample) {
    let k = 0;
    for (const { r, a } of attrs) {
      if (k++ % Math.floor(rows.length / 6) !== 0) continue;
      console.log(`  • ${r.title.slice(0, 70)}`);
      for (const [id, v] of Object.entries(a)) if (v.value !== null) console.log(`      ${id}=${JSON.stringify(v.value)} [${v.confidence}] ← ${v.evidence[0] ? v.evidence[0].label + ": " + v.evidence[0].text : ""}`);
    }
  }
}
