import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite access uses Node's built-in `node:sqlite` (Node >= 22.5; this repo targets Node 24).
 * Why: no native addon to compile or ship (the Docker image only needs the Node runtime), and it
 * bundles FTS5 + R-Tree (verified at import time). Trade-off: the module still prints an
 * ExperimentalWarning on some Node versions and its API is younger than better-sqlite3's.
 */
export const DEFAULT_DB_PATH = "data/app.sqlite";

export const resolveDbPath = (env: NodeJS.ProcessEnv = process.env): string => path.resolve(/*turbopackIgnore: true*/ env.DATABASE_PATH || DEFAULT_DB_PATH);

export class DatabaseUnavailableError extends Error {
  constructor(public readonly dbPath: string) {
    super(`Database not found at ${dbPath}. Run "npm run db:import" first.`);
    this.name = "DatabaseUnavailableError";
  }
}

/** The file exists but is not the expected catalog (e.g. a fixture or partial copy was mounted in production). */
export class CatalogMismatchError extends DatabaseUnavailableError {
  constructor(dbPath: string, public readonly products: number, public readonly expectedMin: number) {
    super(dbPath);
    this.message = `Database at ${dbPath} has ${products} products, expected at least ${expectedMin}.`;
    this.name = "CatalogMismatchError";
  }
}

/** The file exists but is not a complete SQLite database (empty, random bytes, or truncated — e.g. an interrupted upload). */
export class CorruptDatabaseError extends DatabaseUnavailableError {
  constructor(dbPath: string, public readonly why: string) {
    super(dbPath);
    this.message = `Database at ${dbPath} is incomplete or not a SQLite file (${why}).`;
    this.name = "CorruptDatabaseError";
  }
}

/** Cheap structural check (reads 100 bytes + stat): magic string, and file size >= in-header page count x page size. Catches empty/garbage/truncated files without scanning 800 MB. */
export function assertCompleteSqliteFile(dbPath: string): void {
  const fd = fs.openSync(dbPath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 100) throw new CorruptDatabaseError(dbPath, "smaller than the SQLite header");
    const h = Buffer.alloc(100);
    fs.readSync(fd, h, 0, 100, 0);
    if (h.toString("latin1", 0, 16) !== "SQLite format 3\0") throw new CorruptDatabaseError(dbPath, "not a SQLite file");
    const pageSize = h.readUInt16BE(16) === 1 ? 65536 : h.readUInt16BE(16);
    const pages = h.readUInt32BE(28);
    if (pages > 0 && size < pages * pageSize) throw new CorruptDatabaseError(dbPath, `truncated: ${size} bytes < ${pages * pageSize}`);
  } finally { fs.closeSync(fd); }
}

/** Optional production guard: REQUIRE_MIN_PRODUCTS=225903 makes a fixture/partial database "unavailable" instead of silently serving it. Unset = no check. */
export const requiredMinProducts = (env: Record<string, string | undefined> = process.env): number => {
  const n = Number.parseInt(env.REQUIRE_MIN_PRODUCTS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

let readDb: { path: string; db: DatabaseSync } | null = null;

/** Shared read-only connection for request handlers. Cannot modify data (OS + SQLite level). */
export function getReadDb(dbPath = resolveDbPath()): DatabaseSync {
  if (readDb && readDb.path === dbPath) return readDb.db;
  if (!fs.existsSync(/*turbopackIgnore: true*/ dbPath)) throw new DatabaseUnavailableError(dbPath);
  readDb?.db.close();
  assertCompleteSqliteFile(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;"); } catch (e) { db.close(); throw new CorruptDatabaseError(dbPath, e instanceof Error ? e.message : "unreadable"); }
  const min = requiredMinProducts();
  if (min > 0) {
    const products = Number((db.prepare("SELECT count(*) AS n FROM products").get() as { n: number }).n);
    if (products < min) { db.close(); throw new CatalogMismatchError(dbPath, products, min); }
  }
  readDb = { path: dbPath, db };
  return db;
}

export function closeReadDb(): void {
  readDb?.db.close();
  readDb = null;
}

/** Writable connection for scripts (init / import). Not for request handlers. */
export function openWritableDb(dbPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return new DatabaseSync(dbPath);
}

export function assertSqliteFeatures(db: DatabaseSync): { version: string } {
  const row = db
    .prepare("SELECT sqlite_version() AS v, sqlite_compileoption_used('ENABLE_FTS5') AS fts5, sqlite_compileoption_used('ENABLE_RTREE') AS rtree")
    .get() as { v: string; fts5: number; rtree: number };
  if (!row.fts5 || !row.rtree) throw new Error(`SQLite ${row.v} lacks FTS5 or R-Tree support`);
  return { version: row.v };
}
