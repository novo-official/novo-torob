import type { DatabaseSync } from "node:sqlite";
import { osaDistance } from "@/server/domain/text";

/** In-memory view of the FTS vocabulary (term → document frequency). ~165k terms for the full dataset. */
export interface Vocabulary {
  size: number;
  doc(term: string): number;
  /** Does at least one term start with `prefix`? (binary search over the sorted term list) */
  hasPrefix(prefix: string): boolean;
  /** Terms within edit distance ≤ max of `term`, best first (distance, then frequency). */
  fuzzy(term: string, max: number, limit?: number, minDoc?: number): Array<{ term: string; doc: number; distance: number }>;
}

const cache = new WeakMap<DatabaseSync, Vocabulary>();

export function getVocabulary(db: DatabaseSync): Vocabulary {
  const hit = cache.get(db);
  if (hit) return hit;
  const rows = db.prepare("SELECT term, doc FROM product_fts_vocab ORDER BY term").all() as Array<{ term: string; doc: number }>;
  const map = new Map<string, number>();
  const sorted: string[] = [];
  for (const r of rows) {
    map.set(r.term, Number(r.doc));
    sorted.push(r.term);
  }
  const vocab: Vocabulary = {
    size: map.size,
    doc: (t) => map.get(t) ?? 0,
    hasPrefix(prefix) {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid]! < prefix) lo = mid + 1;
        else hi = mid;
      }
      return lo < sorted.length && sorted[lo]!.startsWith(prefix);
    },
    fuzzy(term, max, limit = 3, minDoc = 1) {
      const out: Array<{ term: string; doc: number; distance: number }> = [];
      for (const [t, d] of map) {
        if (d < minDoc || Math.abs(t.length - term.length) > max || t === term) continue;
        const dist = osaDistance(term, t, max);
        if (dist <= max) out.push({ term: t, doc: d, distance: dist });
      }
      return out.sort((a, b) => a.distance - b.distance || b.doc - a.doc || a.term.localeCompare(b.term)).slice(0, limit);
    },
  };
  cache.set(db, vocab);
  return vocab;
}
