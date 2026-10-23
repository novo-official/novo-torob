import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const REAL_CATALOG = { products: 225_903, shops: 6_476, offers: 331_506 } as const;

export interface CatalogStatus {
  path: string;
  present: boolean;
  /** true only for the FULL Torob catalog (never the fixture / ui-qa / synthetic QA databases) */
  real: boolean;
  products: number;
  reason: string;
}

/** Read-only probe of DATABASE_PATH (default data/app.sqlite). Never writes, never creates the file. */
export function probeCatalog(): CatalogStatus {
  const p = path.resolve(process.env.DATABASE_PATH || "data/app.sqlite");
  if (!fs.existsSync(p)) return { path: p, present: false, real: false, products: 0, reason: `no database at ${p}` };
  try {
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const products = Number((db.prepare("SELECT count(*) AS n FROM products").get() as { n: number }).n);
      const real = products === REAL_CATALOG.products;
      return { path: p, present: true, real, products, reason: real ? "ok" : `database has ${products} products, the real catalog has ${REAL_CATALOG.products} (fixture or partial import)` };
    } finally {
      db.close();
    }
  } catch (e) {
    return { path: p, present: true, real: false, products: 0, reason: `cannot read database: ${(e as Error).message}` };
  }
}

export const BLOCKED_BANNER = (s: CatalogStatus) =>
  [
    "",
    "################################################################################",
    "#  BLOCKED: AWAITING REAL DATA — dataset-backed tests will be SKIPPED",
    `#  ${s.reason}`,
    "#  Place the original archive at .data/torob-dataset.zip and run `npm run db:import`,",
    "#  or provide a validated data/app.sqlite. A run with this banner is NOT a full pass.",
    "################################################################################",
    "",
  ].join("\n");
