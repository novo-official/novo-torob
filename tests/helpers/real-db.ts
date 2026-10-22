import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Phase 3 tests that need the REAL imported dataset run only when data/app.sqlite exists and has the Phase 3 schema.
 * Otherwise they are SKIPPED (reported as skipped, never as passed). Build it with `npm run db:import`.
 */
export function openRealDb(): DatabaseSync | null {
  const p = path.resolve(process.env.DATABASE_PATH || "data/app.sqlite");
  if (!fs.existsSync(p)) return null;
  try {
    const db = new DatabaseSync(p, { readOnly: true });
    const ok = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('product_price_evidence','product_fts_vocab')").get() as { n: number };
    if (Number(ok.n) < 2) { db.close(); return null; }
    const n = db.prepare("SELECT count(*) AS n FROM products").get() as { n: number };
    return Number(n.n) > 100_000 ? db : null; // only the FULL dataset, not the fixture
  } catch {
    return null;
  }
}
