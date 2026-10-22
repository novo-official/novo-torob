import fs from "node:fs";
import { assertSqliteFeatures, openWritableDb, resolveDbPath } from "@/server/db/connect";
import { migrate } from "@/server/db/migrate";

/** Create an EMPTY database with the schema applied (idempotent). `db:import` rebuilds data into a staging file instead. */
const target = process.argv[2] ? process.argv[2] : resolveDbPath();
if (fs.existsSync(target)) {
  console.error(`Refusing to touch existing database: ${target} (db:import replaces it atomically).`);
  process.exit(1);
}
const db = openWritableDb(target);
console.log("SQLite", assertSqliteFeatures(db).version);
console.log("applied migrations:", migrate(db));
db.close();
console.log("created", target);
