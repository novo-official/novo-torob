import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { RULES_VERSION } from "@/domain/quality";
import { assertSqliteFeatures, openWritableDb } from "@/server/db/connect";
import { migrate } from "@/server/db/migrate";
import { computeProductEvidence } from "./evidence";
import { computeFlags } from "./flags";
import { deriveIndexes, loadOffers, loadProducts, loadShops } from "./load";
import { openSource, type SourceSpec } from "./sources";

export const IMPORTER_VERSION = "2.0.0";

export interface ImportOptions {
  source: SourceSpec;
  outPath: string;
  log?: (msg: string) => void;
  /** Report-and-continue instead of aborting when offers reference unknown products/shops. */
  allowOrphans?: boolean;
  /** Test hook: simulate a crash. */
  inject?: { failAfter?: { table: "products" | "shops" | "offers"; rows: number }; failBeforeSwap?: boolean };
}

export interface ImportResult {
  outPath: string;
  durationMs: number;
  phaseMs: Record<string, number>;
  rowsRead: { products: number; shops: number; offers: number };
  rowsStored: { products: number; shops: number; offers: number };
  orphans: { offersWithoutProduct: number; offersWithoutShop: number };
  flagCounts: Record<string, number>;
  priceEvidence: Record<string, number>;
  snapshotRef: string | null;
  peerComparableOffers: number;
  cohortsEvaluated: number;
  dbBytes: number;
  sourceSha256: string | null;
  sqliteVersion: string;
}

let activeStaging: string | null = null;

/** Called by CLI signal handlers: delete the in-flight staging file. The live database is never touched. */
export function abortCleanup(): void {
  if (activeStaging) for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(activeStaging + suffix, { force: true });
  activeStaging = null;
}

const stagingGlob = (outPath: string) => `${path.basename(outPath)}.importing-`;

/** Remove leftovers of crashed imports (only those whose owning process no longer exists). */
export function cleanStaleStaging(outPath: string): string[] {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) return [];
  const removed: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith(stagingGlob(outPath))) continue;
    const pid = Number(/importing-(\d+)/.exec(f)?.[1]);
    let alive = false;
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0); // signal 0 only probes for existence
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (!alive) {
      fs.rmSync(path.join(dir, f), { force: true });
      removed.push(f);
    }
  }
  return removed;
}

const count = (db: DatabaseSync, table: string): number => Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);

function fsyncPath(p: string): void {
  const fd = fs.openSync(p, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Rebuild the database from scratch in a STAGING file, verify it, then atomically rename it over
 * the live file. A crash, a failed gate or a Ctrl-C leaves the previous database untouched and never
 * produces a half-imported "successful" database. Re-running on the same source is idempotent.
 */
export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  const phaseMs: Record<string, number> = {};
  const phase = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const s = Date.now();
    try {
      return await fn();
    } finally {
      phaseMs[name] = Date.now() - s;
      log(`  ✓ ${name} (${phaseMs[name]} ms)`);
    }
  };

  const outPath = path.resolve(opts.outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const cleaned = cleanStaleStaging(outPath);
  if (cleaned.length) log(`removed stale staging files: ${cleaned.join(", ")}`);
  const staging = `${outPath}.importing-${process.pid}`;
  fs.rmSync(staging, { force: true });
  activeStaging = staging;

  const source = await openSource(opts.source);
  let db: DatabaseSync | null = null;
  try {
    db = openWritableDb(staging);
    db.exec("PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -200000; PRAGMA foreign_keys = OFF;");
    const { version } = assertSqliteFeatures(db);
    const importedAt = new Date().toISOString();
    migrate(db);
    const runId = Number(
      db.prepare("INSERT INTO import_runs(started_at, status, source_kind, importer_version, rules_version) VALUES (?, 'running', ?, ?, ?)").run(importedAt, source.kind, IMPORTER_VERSION, RULES_VERSION).lastInsertRowid,
    );
    const sourceSha256 = await phase("hash source", () => source.sha256());

    const read = { products: 0, shops: 0, offers: 0 };
    const fa = opts.inject?.failAfter;
    read.products = (await phase("load products", async () => loadProducts(db!, await source.open("products"), fa?.table === "products" ? fa.rows : undefined))).read;
    read.shops = (await phase("load shops", async () => loadShops(db!, await source.open("shops"), fa?.table === "shops" ? fa.rows : undefined))).read;
    read.offers = (await phase("load offers", async () => loadOffers(db!, await source.open("offers"), fa?.table === "offers" ? fa.rows : undefined))).read;

    await phase("derive indexes (counts, FTS5, R-Tree)", () => deriveIndexes(db!));
    const flagInfo = await phase("quality flags", () => computeFlags(db!, importedAt));
    const evidenceStats = await phase("price evidence", () => computeProductEvidence(db!));

    // ---------- verification gate (must pass before the swap) ----------
    const stored = { products: count(db, "products"), shops: count(db, "shops"), offers: count(db, "offers") };
    const orphans = {
      offersWithoutProduct: count(db, "(SELECT 1 FROM offers o LEFT JOIN products p ON p.product_id = o.product_id WHERE p.product_id IS NULL)"),
      offersWithoutShop: count(db, "(SELECT 1 FROM offers o LEFT JOIN shops s ON s.shop_id = o.shop_id WHERE s.shop_id IS NULL)"),
    };
    const problems: string[] = [];
    for (const k of ["products", "shops", "offers"] as const) if (read[k] !== stored[k]) problems.push(`${k}: read ${read[k]} but stored ${stored[k]}`);
    if (!opts.allowOrphans && (orphans.offersWithoutProduct || orphans.offersWithoutShop)) problems.push(`orphan offers: ${JSON.stringify(orphans)}`);
    if (count(db, "product_fts_docsize") !== stored.products) problems.push("FTS row count differs from products");
    if (count(db, "product_price_evidence") !== stored.products) problems.push("price-evidence row count differs from products");
    const geoExpected = Number((db.prepare("SELECT count(*) AS n FROM shops WHERE lat IS NOT NULL AND lon IS NOT NULL").get() as { n: number }).n);
    if (count(db, "shop_geo") !== geoExpected) problems.push("R-Tree row count differs from shops with coordinates");
    const qc = (db.prepare("PRAGMA quick_check").get() as Record<string, string>)["quick_check"];
    if (qc !== "ok") problems.push(`quick_check: ${qc}`);
    if (problems.length) throw new Error(`Import gate FAILED — live database untouched:\n - ${problems.join("\n - ")}`);
    log("  ✓ verification gate passed");
    if (opts.inject?.failBeforeSwap) throw new Error("Injected failure before swap");

    await phase("analyze", () => {
      db!.exec("ANALYZE; PRAGMA optimize;");
    });
    db.prepare("UPDATE import_runs SET status='complete', finished_at=?, source_sha256=?, snapshot_ref=?, stats_json=? WHERE id=?").run(
      new Date().toISOString(), sourceSha256, flagInfo.snapshotRef,
      JSON.stringify({ rowsRead: read, rowsStored: stored, orphans, flagCounts: flagInfo.stats, priceEvidence: evidenceStats, phaseMs, peerComparableOffers: flagInfo.peerComparableOffers, cohortsEvaluated: flagInfo.cohortsEvaluated }),
      runId,
    );
    db.close();
    db = null;

    // ---------- atomic swap ----------
    fsyncPath(staging);
    fs.renameSync(staging, outPath);
    fsyncPath(path.dirname(outPath));

    return {
      outPath, durationMs: Date.now() - t0, phaseMs, rowsRead: read, rowsStored: stored, orphans,
      flagCounts: flagInfo.stats, priceEvidence: evidenceStats, snapshotRef: flagInfo.snapshotRef, peerComparableOffers: flagInfo.peerComparableOffers,
      cohortsEvaluated: flagInfo.cohortsEvaluated, dbBytes: fs.statSync(outPath).size, sourceSha256, sqliteVersion: version,
    };
  } finally {
    try {
      db?.close();
    } catch {
      /* already closed */
    }
    for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(staging + suffix, { force: true });
    activeStaging = null;
    await source.close();
  }
}
