import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "@/server/db/connect";
import { extractModelKeys, normalizeSearchText } from "@/server/domain/text";
import { STOP_WORDS } from "@/server/search/lexicon";

/**
 * Builds the DETERMINISTIC derived evaluation corpus (seeded). Labels come from the catalog record the query was
 * derived from — "verified by construction", NOT human relevance judgments. Output: tests/eval/derived.json
 */
const SEED = 20261021;
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const db = new DatabaseSync(resolveDbPath(), { readOnly: true });
const rnd = rng(SEED);
const pick = <T,>(xs: T[], n: number): T[] => { const a = [...xs]; const out: T[] = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]!); return out; };

const rows = db.prepare("SELECT product_id AS id, persian_title AS title, title_norm AS tn, model_keys AS mk, category_name AS cat, offer_count AS oc FROM products WHERE oc >= 1 AND persian_title IS NOT NULL AND persian_title <> 'عنوان حذف‌شده برای انتشار'").all() as Array<{ id: string; title: string; tn: string; mk: string; cat: string; oc: number }>;
const STOP = new Set([...STOP_WORDS].map(normalizeSearchText));
const ftsCount = (expr: string) => Number((db.prepare("SELECT count(*) AS n FROM product_fts WHERE product_fts MATCH ?").get(expr) as { n: number }).n);
const holders = (key: string) => (db.prepare("SELECT product_id AS id FROM products WHERE (' ' || model_keys || ' ') LIKE ?").all(`% ${key} %`) as Array<{ id: string }>).map((r) => r.id);

// ---- 1) exact-model queries --------------------------------------------------------------
const withKey = rows.filter((r) => r.mk.split(" ").some((k) => k.length >= 6 && k.length <= 18));
const exact: Array<{ id: string; query: string; form: string; key: string; relevant: string[] }> = [];
for (const r of pick(withKey, 70)) {
  const keys = r.mk.split(" ").filter((k) => k.length >= 6 && k.length <= 18);
  const key = keys[Math.floor(rnd() * keys.length)]!;
  const rel = holders(key);
  if (rel.length > 40) continue; // a "model" shared by dozens of products is not a model identifier
  // surface form 1: upper compact; 2: lower; 3: the token exactly as printed in the title (e.g. with hyphens)
  const printed = r.title.split(/\s+/).find((w) => extractModelKeys(w).includes(key)) ?? key;
  for (const [form, query] of [["compact", key], ["lower", key.toLowerCase()], ["as_printed", printed]] as const) exact.push({ id: r.id, query, form, key, relevant: rel });
}

// ---- 2) descriptive Persian queries (3 consecutive content words of a title) ------------------
const words = (t: string) => t.split(/\s+/).filter(Boolean);
const content = (w: string) => { const n = normalizeSearchText(w); return n.length >= 3 && !STOP.has(n) && !/\d/.test(n) && !/[a-z]/.test(n) ? n : null; };
const subset: Array<{ id: string; query: string; tokens: string[]; ambiguity: number; typoQuery: string | null; typoOf: string | null }> = [];
const pool = rows.filter((r) => words(r.title).length >= 5);
for (const r of pick(pool, 260)) {
  const ws = words(r.title);
  const starts: number[] = [];
  for (let i = 0; i + 3 <= ws.length; i++) if (ws.slice(i, i + 3).every((w) => content(w))) starts.push(i);
  if (!starts.length) continue;
  const i = starts[Math.floor(rnd() * starts.length)]!;
  const three = ws.slice(i, i + 3);
  const tokens = three.map((w) => content(w)!);
  const ambiguity = ftsCount(`{title} : ${tokens.map((t) => `"${t}"`).join(" AND ")}`);
  let typoQuery: string | null = null;
  let typoOf: string | null = null;
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0]!;
  if (longest.length >= 5 && ambiguity <= 5) {
    const p = 1 + Math.floor(rnd() * (longest.length - 2));
    const kind = subset.length % 3; // deletion / adjacent swap / substitution
    const bad = kind === 0 ? longest.slice(0, p) + longest.slice(p + 1) : kind === 1 ? longest.slice(0, p) + longest[p + 1] + longest[p] + longest.slice(p + 2) : longest.slice(0, p) + "ر" + longest.slice(p + 1);
    if (bad !== longest) { typoQuery = tokens.map((t) => (t === longest ? bad : t)).join(" "); typoOf = longest; }
  }
  subset.push({ id: r.id, query: three.join(" "), tokens, ambiguity, typoQuery, typoOf });
  if (subset.length >= 150) break;
}

fs.mkdirSync("tests/eval", { recursive: true });
fs.writeFileSync("tests/eval/derived.json", JSON.stringify({ meta: { seed: SEED, builtFrom: "data/app.sqlite", kind: "verified-by-construction (label = the catalog record the query was derived from)", products: rows.length }, exact, subset }, null, 1));
console.log(`exact-model cases: ${exact.length} (from ${exact.length / 3} products) · descriptive cases: ${subset.length} (typo variants: ${subset.filter((s) => s.typoQuery).length})`);
