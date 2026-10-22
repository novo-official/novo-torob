import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "@/server/db/connect";
import { normalizeSearchText } from "@/server/domain/text";
import { searchCatalog } from "@/server/search/search";

/**
 * Search-relevance evaluation. Two kinds of labels are kept apart:
 *   VERIFIED-BY-CONSTRUCTION: derived from the catalog record itself (tests/eval/derived.json)
 *   ASSISTANT-DEFINED: small curated expectations written by the assistant (marked as such, never presented as ground truth)
 * Usage: npm run eval            (prints a report and writes docs/eval/phase-3-results.json)
 */
const db = new DatabaseSync(resolveDbPath(), { readOnly: true });
const derived = JSON.parse(fs.readFileSync("tests/eval/derived.json", "utf8")) as {
  meta: { seed: number; products: number };
  exact: Array<{ id: string; query: string; form: string; key: string; relevant: string[] }>;
  subset: Array<{ id: string; query: string; tokens: string[]; ambiguity: number; typoQuery: string | null; typoOf: string | null }>;
};
const pct = (n: number, d: number) => (d ? +((100 * n) / d).toFixed(1) : 0);
const ms: number[] = [];
const run = (q: string, opts: { typo?: boolean; limit?: number } = {}) => {
  const t = performance.now();
  const r = searchCatalog(db, { q, limit: opts.limit ?? 20, typo: opts.typo });
  ms.push(performance.now() - t);
  return r;
};
const out: Record<string, unknown> = { meta: { seed: derived.meta.seed, catalogProducts: derived.meta.products, builtAt: "deterministic from data/app.sqlite" } };

// 1) exact model ------------------------------------------------------------------------------
{
  const byForm: Record<string, { n: number; p1: number; p3: number; p10: number; rr: number }> = {};
  const fails: Array<{ query: string; form: string; got: string[] }> = [];
  for (const c of derived.exact) {
    const rel = new Set(c.relevant);
    const r = run(c.query);
    const ranks = r.items.map((it) => it.card.id);
    const pos = ranks.findIndex((id) => rel.has(id));
    const b = (byForm[c.form] ??= { n: 0, p1: 0, p3: 0, p10: 0, rr: 0 });
    b.n++;
    if (pos === 0) b.p1++;
    if (pos >= 0 && pos < 3) b.p3++;
    if (pos >= 0 && pos < 10) b.p10++;
    if (pos >= 0) b.rr += 1 / (pos + 1);
    if (pos !== 0 && fails.length < 12) fails.push({ query: c.query, form: c.form, got: r.items.slice(0, 2).map((i) => i.card.title.slice(0, 40)) });
  }
  const tot = Object.values(byForm).reduce((a, b) => ({ n: a.n + b.n, p1: a.p1 + b.p1, p3: a.p3 + b.p3, p10: a.p10 + b.p10, rr: a.rr + b.rr }), { n: 0, p1: 0, p3: 0, p10: 0, rr: 0 });
  out.exactModel = { n: tot.n, "P@1": pct(tot.p1, tot.n), "P@3": pct(tot.p3, tot.n), "hit@10": pct(tot.p10, tot.n), MRR: +(tot.rr / tot.n).toFixed(3), byForm: Object.fromEntries(Object.entries(byForm).map(([k, v]) => [k, { n: v.n, "P@1": pct(v.p1, v.n), "hit@10": pct(v.p10, v.n) }])), failures: fails };
}

// 2) descriptive queries ----------------------------------------------------------------------
const bucket = (a: number) => (a <= 1 ? "1" : a <= 5 ? "2-5" : a <= 20 ? "6-20" : ">20");
{
  const acc: Record<string, { n: number; at1: number; at5: number; at10: number; at20: number; prec5: number; prec5n: number }> = {};
  for (const c of derived.subset) {
    const r = run(c.query);
    const ids = r.items.map((i) => i.card.id);
    const pos = ids.indexOf(c.id);
    const b = (acc[bucket(c.ambiguity)] ??= { n: 0, at1: 0, at5: 0, at10: 0, at20: 0, prec5: 0, prec5n: 0 });
    b.n++;
    if (pos === 0) b.at1++;
    if (pos >= 0 && pos < 5) b.at5++;
    if (pos >= 0 && pos < 10) b.at10++;
    if (pos >= 0) b.at20++;
    for (const it of r.items.slice(0, 5)) {
      b.prec5n++;
      const t = normalizeSearchText(it.card.title);
      if (c.tokens.every((tk) => t.includes(tk))) b.prec5++;
    }
  }
  const rows = Object.entries(acc).map(([k, v]) => [k, { n: v.n, "hit@1": pct(v.at1, v.n), "hit@5": pct(v.at5, v.n), "hit@10": pct(v.at10, v.n), "hit@20": pct(v.at20, v.n), "titles containing all words in top-5": pct(v.prec5, v.prec5n) }] as const);
  out.descriptive = { note: "label = the product the 3-word query was cut from; with ambiguity>1 the ceiling is below 100% by construction", n: derived.subset.length, byAmbiguity: Object.fromEntries(rows) };
}

// 3) typos ------------------------------------------------------------------------------------
{
  const cases = derived.subset.filter((c) => c.typoQuery);
  let clean = 0, on = 0, off = 0, detected = 0;
  for (const c of cases) {
    if (run(c.query).items.some((i) => i.card.id === c.id)) clean++;
    const withTypo = run(c.typoQuery!, { typo: true });
    if (withTypo.items.some((i) => i.card.id === c.id)) on++;
    if (withTypo.corrections.some((x) => x.to === c.typoOf)) detected++;
    if (run(c.typoQuery!, { typo: false }).items.some((i) => i.card.id === c.id)) off++;
  }
  out.typos = { n: cases.length, note: "one edit (deletion / transposition / substitution) in the longest word; source ambiguity ≤ 5; metric = source product within top-20", "clean query hit@20": pct(clean, cases.length), "typo + tolerance hit@20": pct(on, cases.length), "typo, tolerance OFF hit@20": pct(off, cases.length), "intended word proposed as correction": pct(detected, cases.length) };
}

// 4) synonyms / category-aware retrieval (ASSISTANT-DEFINED expectations) -------------------------
{
  const SEC = ["دوربین مدار بسته", "دوربین امنیتی خورشیدی", "پکیج سیستم‌های نظارتی و امنیتی", "ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی"];
  const ok = (cats: string[], c: string) => cats.some((x) => (x.startsWith("~") ? c.includes(x.slice(1)) : x === c));
  const set: Array<[string, string[]]> = [
    ["هندزفری", ["هدفون، هدست و هندزفری"]], ["ایرفون", ["هدفون، هدست و هندزفری"]], ["ایربادز", ["هدفون، هدست و هندزفری"]],
    ["پاور بانک", ["پاوربانک و شارژر همراه"]], ["شارژر همراه", ["پاوربانک و شارژر همراه"]], ["powerbank", ["پاوربانک و شارژر همراه"]],
    ["ژنراتور", ["ژنراتور و موتور برق"]], ["generator", ["ژنراتور و موتور برق"]], ["موتور برق", ["ژنراتور و موتور برق"]],
    ["دوربین امنیتی", SEC], ["cctv", SEC], ["دوربین مداربسته", SEC], ["دوربین مدار بسته", SEC],
    ["اسمارت واچ", ["ساعت و مچ بند هوشمند"]], ["smartwatch", ["ساعت و مچ بند هوشمند"]],
    ["لپتاپ", ["لپ تاپ و نوت بوک"]], ["laptop", ["لپ تاپ و نوت بوک"]], ["واترپمپ", ["~پمپ"]],
  ];
  const per = set.map(([q, cats]) => { const r = run(q, { limit: 10 }); const hit = r.items.filter((i) => ok(cats, i.card.categoryName)).length; return { q, topInExpectedCategory: `${hit}/${r.items.length}` }; });
  const sum = set.reduce((a, [q, cats]) => { const r = run(q, { limit: 10 }); return { h: a.h + r.items.filter((i) => ok(cats, i.card.categoryName)).length, n: a.n + r.items.length }; }, { h: 0, n: 0 });
  out.synonyms = { note: "expectations defined by the assistant (heuristic); the metric itself is computed from the catalog's category field", queries: set.length, "share of top-10 in expected category": pct(sum.h, sum.n), perQuery: per };
}

// 5) invalid / generic input -----------------------------------------------------------------
{
  const bad = ["", "  ", "و", "با از به", "ا", "قیمت", "بهترین خرید", "!!!", "؟؟", "x"];
  const res = bad.map((q) => { const r = searchCatalog(db, { q }); return { q, valid: r.valid, reason: r.invalidReason ?? null, items: r.items.length, hasMessage: !!r.recovery?.message }; });
  out.invalidInput = { n: bad.length, allRejectedWithMessage: res.every((r) => !r.valid && r.items === 0 && r.hasMessage), detail: res };
}

// 6) variant identification (ASSISTANT-JUDGED labels) -----------------------------------------
{
  const v = JSON.parse(fs.readFileSync("tests/eval/variant-labels.json", "utf8")) as { pairs: Array<{ engineVerdict: string; label: string }> };
  const by: Record<string, Record<string, number>> = {};
  for (const p of v.pairs) ((by[p.engineVerdict] ??= {})[p.label] = (by[p.engineVerdict]![p.label] ?? 0) + 1);
  const n = (k: string) => Object.values(by[k] ?? {}).reduce((a, b) => a + b, 0);
  const g = (k: string, l: string) => by[k]?.[l] ?? 0;
  out.variantIdentification = {
    note: "labels are single-pass judgments by the assistant (heuristic), not expert-verified; samples are small",
    counts: by,
    "MISMATCH (blocks price comparison): judged different_variant": pct(g("VARIANT_MODEL_MISMATCH", "different_variant"), n("VARIANT_MODEL_MISMATCH")),
    "MISMATCH: judged same_variant (false positive)": pct(g("VARIANT_MODEL_MISMATCH", "same_variant"), n("VARIANT_MODEL_MISMATCH")),
    "MISMATCH: unclear": pct(g("VARIANT_MODEL_MISMATCH", "unclear"), n("VARIANT_MODEL_MISMATCH")),
    "UNCONFIRMED (does NOT block): judged different_variant": pct(g("VARIANT_MODEL_UNCONFIRMED", "different_variant"), n("VARIANT_MODEL_UNCONFIRMED")),
    "UNCONFIRMED: judged same_variant": pct(g("VARIANT_MODEL_UNCONFIRMED", "same_variant"), n("VARIANT_MODEL_UNCONFIRMED")),
    "no variant flag: judged same_variant": pct(g("COMPATIBLE (no variant flag)", "same_variant"), n("COMPATIBLE (no variant flag)")),
    "no variant flag: judged different_variant (missed)": pct(g("COMPATIBLE (no variant flag)", "different_variant"), n("COMPATIBLE (no variant flag)")),
  };
}

ms.sort((a, b) => a - b);
out.latencyMs = { queries: ms.length, p50: +ms[Math.floor(ms.length * 0.5)]!.toFixed(1), p95: +ms[Math.floor(ms.length * 0.95)]!.toFixed(1), max: +ms.at(-1)!.toFixed(1) };
fs.writeFileSync("docs/eval/phase-3-results.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
