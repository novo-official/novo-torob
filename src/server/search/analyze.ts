import { extractModelKeys, normalizeSearchText } from "@/server/domain/text";
import { CATEGORY_HINTS, PREFERENCE_WORDS, SPLIT_VARIANTS, STOP_WORDS, SYNONYM_GROUPS } from "./lexicon";
import type { Vocabulary } from "./vocab";

export type InvalidReason = "empty" | "only_stopwords" | "too_short";

export interface QueryGroup {
  /** What the user typed for this slot (normalized). */
  source: string;
  kind: "word" | "model" | "number";
  /** FTS5 expressions (already quoted); any of them satisfies the group. First one is the literal form. */
  alternatives: string[];
  /** Plain-text forms of the alternatives (for in-title matching during ranking). */
  forms: string[];
  /** Token is not in the vocabulary and could not be corrected: searching for it will find nothing. */
  unknown: boolean;
}

export interface AnalyzedQuery {
  raw: string;
  normalized: string;
  valid: boolean;
  invalidReason?: InvalidReason;
  groups: QueryGroup[];
  modelKeys: string[];
  droppedStopWords: string[];
  preferences: Array<"cheap" | "premium">;
  corrections: Array<{ from: string; to: string }>;
  expansions: Array<{ from: string; to: string[] }>;
  categoryHints: string[];
}

const MAX_TOKENS = 8;
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
const isDigits = (t: string) => /^\d+$/.test(t);
const hasLetterAndDigit = (t: string) => /[a-z]/i.test(t) && /\d/.test(t);

const norm = normalizeSearchText;
const STOP = new Set([...STOP_WORDS].map(norm));
const PREF = new Map(Object.entries(PREFERENCE_WORDS).map(([k, v]) => [norm(k), v]));
const SYN_TERMS = SYNONYM_GROUPS.map((g) => g.map(norm));
const SYN_INDEX = new Map<string, number>(); // normalized term → group index
SYN_TERMS.forEach((g, i) => g.forEach((t) => SYN_INDEX.set(t, i)));
const SPLITS = SPLIT_VARIANTS.map(([a, b]) => [norm(a), norm(b)] as const);
const HINTS = CATEGORY_HINTS.map((h) => ({ phrases: h.phrases.map(norm), category: h.category }));

/** Does the (possibly multi-word) term exist in the vocabulary? */
const termKnown = (term: string, vocab: Vocabulary): boolean => term.split(" ").every((w) => vocab.doc(w) > 0);

function typoBudget(len: number): number {
  if (len < 4) return 0;
  return len <= 6 ? 1 : 2;
}

export function analyzeQuery(raw: string, vocab: Vocabulary): AnalyzedQuery {
  const base: AnalyzedQuery = {
    raw, normalized: norm(raw), valid: false, groups: [], modelKeys: [], droppedStopWords: [], preferences: [], corrections: [], expansions: [], categoryHints: [],
  };
  if (!base.normalized) return { ...base, invalidReason: "empty" };

  const groups: QueryGroup[] = [];
  const order = new Map<QueryGroup, number>(); // position of the user's chunk, to keep groups in query order
  const plain: string[] = [];
  const plainChunk: number[] = [];
  const modelKeys = new Set<string>();
  const dropped: string[] = [];
  const prefs: AnalyzedQuery["preferences"] = [];

  // --- 1) model-like chunks (DH-HAC-HDW1200CLQP-IL-A, JD8500) become dedicated groups
  for (const [chunkIdx, chunk] of raw.trim().split(/\s+/).slice(0, 12).entries()) {
    const nChunk = norm(chunk);
    if (!nChunk) continue;
    const keys = extractModelKeys(chunk);
    const looksModel = keys.length > 0 && hasLetterAndDigit(chunk.replace(/[^A-Za-z0-9۰-۹٠-٩]/g, ""));
    if (looksModel) {
      const parts = nChunk.split(" ");
      const alts = new Set<string>();
      const forms = new Set<string>();
      if (parts.length > 1) {
        alts.add(quote(parts.join(" ")));
        forms.add(parts.join(" "));
      }
      for (const k of keys) {
        alts.add(quote(k.toLowerCase()));
        forms.add(k.toLowerCase());
        modelKeys.add(k);
      }
      if (parts.length === 1) {
        alts.add(quote(parts[0]!));
        forms.add(parts[0]!);
      }
      const mg: QueryGroup = { source: nChunk, kind: "model", alternatives: [...alts], forms: [...forms], unknown: ![...forms].some((f) => termKnown(f, vocab)) };
      groups.push(mg);
      order.set(mg, chunkIdx);
      continue;
    }
    for (const t of nChunk.split(" ")) { plain.push(t); plainChunk.push(chunkIdx); }
  }

  // --- 2) preferences, stop words, single letters
  const content: string[] = [];
  const pos: number[] = []; // original position of each content token (adjacency must survive dropped words)
  for (let i = 0; i < plain.length; i++) {
    const t = plain[i]!;
    const two = i + 1 < plain.length ? `${t} ${plain[i + 1]}` : "";
    if (two && PREF.has(two)) {
      prefs.push(PREF.get(two)!);
      i++;
      continue;
    }
    if (PREF.has(t)) {
      prefs.push(PREF.get(t)!);
      continue;
    }
    if (STOP.has(t)) {
      dropped.push(t);
      continue;
    }
    if (t.length < 2 && !isDigits(t)) {
      dropped.push(t);
      continue;
    }
    content.push(t);
    pos.push(i);
  }
  const adjacent = (a: number, n: number) => pos[a + n - 1]! - pos[a]! === n - 1;

  const out: AnalyzedQuery = { ...base, groups, modelKeys: [...modelKeys], droppedStopWords: dropped, preferences: [...new Set(prefs)] };

  // --- 3) synonyms (longest match first, up to 3 words), spacing variants, joins, typo correction
  const used = new Array(content.length).fill(false);
  const pushed: Array<{ idx: number; group: QueryGroup }> = [];
  for (let i = 0; i < content.length && pushed.length + groups.length < MAX_TOKENS; i++) {
    if (used[i]) continue;
    let matched = false;
    for (let n = Math.min(3, content.length - i); n >= 1 && !matched; n--) {
      if (!adjacent(i, n)) continue;
      const phrase = content.slice(i, i + n).join(" ");
      const gi = SYN_INDEX.get(phrase);
      if (gi === undefined) continue;
      const terms = SYN_TERMS[gi]!.filter((t) => termKnown(t, vocab));
      if (terms.length < 1) continue;
      const literalKnown = termKnown(phrase, vocab);
      const all = literalKnown ? [phrase, ...terms.filter((t) => t !== phrase)] : terms;
      if (all.length > 1) out.expansions.push({ from: phrase, to: all.filter((t) => t !== phrase) });
      pushed.push({ idx: i, group: { source: phrase, kind: "word", alternatives: all.map((t) => quote(t)), forms: all, unknown: false } });
      for (let k = i; k < i + n; k++) used[k] = true;
      matched = true;
    }
    if (matched) continue;

    const t = content[i]!;
    // joins: "پاور بانک" ⇄ "پاوربانک"
    const nxt = content[i + 1];
    if (nxt && !used[i + 1] && adjacent(i, 2)) {
      const joined = t + nxt;
      if (vocab.doc(joined) >= 3) {
        out.expansions.push({ from: `${t} ${nxt}`, to: [joined] });
        pushed.push({ idx: i, group: { source: `${t} ${nxt}`, kind: "word", alternatives: [quote(`${t} ${nxt}`), quote(joined)], forms: [`${t} ${nxt}`, joined], unknown: false } });
        used[i] = used[i + 1] = true;
        continue;
      }
    }
    // known spacing variants (single token → two tokens)
    const split = SPLITS.find(([a, b]) => a === t || b === t);
    if (split) {
      const alts = [...new Set([t, split[0], split[1]])].filter((x) => termKnown(x, vocab));
      if (alts.length > 1) out.expansions.push({ from: t, to: alts.filter((x) => x !== t) });
      pushed.push({ idx: i, group: { source: t, kind: "word", alternatives: (alts.length ? alts : [t]).map(quote), forms: alts.length ? alts : [t], unknown: !alts.length } });
      used[i] = true;
      continue;
    }
    const kind: QueryGroup["kind"] = isDigits(t) ? "number" : "word";
    const isLast = i === content.length - 1;
    const known = vocab.doc(t) > 0 || (isLast && t.length >= 3 && vocab.hasPrefix(t));
    const alts = [quote(t)];
    const forms = [t];
    let unknown = !known;
    // Typo handling: unknown words always; very rare words only when a much more frequent neighbour exists
    // (so "هدفن" — present in 1 title — still reaches "هدفون").
    const docOfT = vocab.doc(t);
    if (kind === "word" && (!known || docOfT < 50)) {
      const budget = typoBudget(t.length);
      // an existing-but-rare word is "corrected" only toward a neighbour that is ≥50× more frequent
      const minDoc = known ? Math.max(30, docOfT * 50) : 3;
      const fixes = budget > 0 ? vocab.fuzzy(t, budget, 3, minDoc) : [];
      if (fixes.length) {
        for (const f of fixes) {
          alts.push(quote(f.term));
          forms.push(f.term);
          out.corrections.push({ from: t, to: f.term });
        }
        unknown = false;
      }
    }
    pushed.push({ idx: i, group: { source: t, kind, alternatives: alts, forms, unknown } });
    used[i] = true;
  }
  pushed.sort((a, b) => a.idx - b.idx);
  for (const p of pushed) { groups.push(p.group); order.set(p.group, plainChunk[pos[p.idx]!]!); }
  groups.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)); // stable: keeps the user's word order, models included

  // prefix match on the last typed word (autocomplete-style), only for sufficiently long literal tokens
  const last = groups[groups.length - 1];
  if (last && last.kind !== "number" && last.source.length >= 3 && !last.source.includes(" ") && last.alternatives[0] === quote(last.source)) {
    last.alternatives[0] = `${quote(last.source)}*`;
  }

  // --- 4) category hints
  const normalized = ` ${out.normalized} `;
  out.categoryHints = [...new Set(HINTS.filter((h) => h.phrases.some((p) => normalized.includes(` ${p} `) || normalized.includes(` ${p}`))).map((h) => h.category))];

  // --- 5) validity
  if (groups.length === 0) {
    out.invalidReason = content.length === 0 && (dropped.length > 0 || prefs.length > 0) ? "only_stopwords" : "too_short";
    return out;
  }
  out.valid = true;
  return out;
}

/** FTS5 MATCH expression for the whole query (AND of groups). `columns` restricts to specific FTS columns. */
export function toFtsExpr(groups: readonly QueryGroup[], columns?: readonly string[]): string {
  const body = groups.map((g) => (g.alternatives.length > 1 ? `(${g.alternatives.join(" OR ")})` : g.alternatives[0]!)).join(" AND ");
  return columns?.length ? `{${columns.join(" ")}} : (${body})` : body;
}

/** Same query with exactly one group removed — used for the clearly-labelled partial-match fallback. */
export function withoutGroup(groups: readonly QueryGroup[], index: number): QueryGroup[] {
  return groups.filter((_, i) => i !== index);
}
