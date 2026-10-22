import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Per-table SHA-256 over every column in primary-key order. Used to prove idempotent re-imports. */
export function fingerprintDb(db: DatabaseSync): Record<string, string> {
  const tables: Array<[string, string]> = [
    ["products", "SELECT * FROM products ORDER BY product_id"],
    ["shops", "SELECT * FROM shops ORDER BY shop_id"],
    ["offers", "SELECT * FROM offers ORDER BY offer_id"],
    ["quality_flags", "SELECT entity_type, entity_id, code, severity, rules_version, reason, details_json FROM quality_flags ORDER BY entity_type, entity_id, code, details_json"],
    ["product_price_evidence", "SELECT * FROM product_price_evidence ORDER BY product_id"],
    ["product_fts", "SELECT rowid, * FROM product_fts_docsize ORDER BY id"],
  ];
  const out: Record<string, string> = {};
  const all = crypto.createHash("sha256");
  for (const [name, sql] of tables) {
    const h = crypto.createHash("sha256");
    for (const row of db.prepare(sql).iterate() as Iterable<Record<string, unknown>>) {
      h.update(JSON.stringify(Object.values(row), (_k, v) => (typeof v === "bigint" ? `${v}n` : v)));
      h.update("\n");
    }
    out[name] = h.digest("hex");
    all.update(name + out[name]);
  }
  out.combined = all.digest("hex");
  return out;
}
