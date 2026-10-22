import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "src/server/db/migrations");

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: Number(f.slice(0, 3)), name: f.slice(4, -4), sql: fs.readFileSync(path.join(dir, f), "utf8") }));
}

/** Apply pending migrations in order, each inside a transaction. Idempotent. */
export function migrate(db: DatabaseSync, migrations = loadMigrations()): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const done = new Set((db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((r) => r.version));
  const applied: number[] = [];
  for (const m of migrations) {
    if (done.has(m.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, new Date().toISOString());
      db.exec("COMMIT");
      applied.push(m.version);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return applied;
}
