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

let readDb: { path: string; db: DatabaseSync } | null = null;

/** Shared read-only connection for request handlers. Cannot modify data (OS + SQLite level). */
export function getReadDb(dbPath = resolveDbPath()): DatabaseSync {
  if (readDb && readDb.path === dbPath) return readDb.db;
  if (!fs.existsSync(/*turbopackIgnore: true*/ dbPath)) throw new DatabaseUnavailableError(dbPath);
  readDb?.db.close();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
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
