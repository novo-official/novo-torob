import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogMismatchError, CorruptDatabaseError, closeReadDb, DatabaseUnavailableError, getReadDb, requiredMinProducts } from "./connect";

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-guard-"));
  file = path.join(dir, "app.sqlite");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE products (product_id TEXT PRIMARY KEY); INSERT INTO products VALUES ('a'),('b'),('c');");
  db.close();
});
afterEach(() => {
  closeReadDb();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("REQUIRE_MIN_PRODUCTS production guard", () => {
  it("is off by default (fixtures and partial databases still open in dev/tests)", () => {
    expect(requiredMinProducts({})).toBe(0);
    expect(getReadDb(file)).toBeTruthy();
  });
  it("refuses a database smaller than the expected catalog, as a kind of 'unavailable' (pages already handle that)", () => {
    vi.stubEnv("REQUIRE_MIN_PRODUCTS", "10");
    let err: unknown;
    try { getReadDb(file); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CatalogMismatchError);
    expect(err).toBeInstanceOf(DatabaseUnavailableError);
    expect((err as CatalogMismatchError).products).toBe(3);
  });
  it("accepts a database that meets the minimum; ignores junk values", () => {
    vi.stubEnv("REQUIRE_MIN_PRODUCTS", "3");
    expect(getReadDb(file)).toBeTruthy();
    expect(requiredMinProducts({ REQUIRE_MIN_PRODUCTS: "abc" })).toBe(0);
    expect(requiredMinProducts({ REQUIRE_MIN_PRODUCTS: "-5" })).toBe(0);
  });
});

describe("incomplete or corrupt database file (e.g. interrupted upload) is 'unavailable', not a 500", () => {
  it("rejects empty, random-bytes and truncated files with CorruptDatabaseError (a DatabaseUnavailableError)", () => {
    const empty = path.join(dir, "empty.sqlite"); fs.writeFileSync(empty, "");
    const junk = path.join(dir, "junk.sqlite"); fs.writeFileSync(junk, Buffer.alloc(8192, 7));
    const db = new DatabaseSync(path.join(dir, "big.sqlite"));
    db.exec("CREATE TABLE products (product_id TEXT, pad TEXT)");
    const ins = db.prepare("INSERT INTO products VALUES (?, ?)");
    for (let i = 0; i < 400; i++) ins.run(String(i), "x".repeat(400));
    db.close();
    const full = fs.readFileSync(path.join(dir, "big.sqlite"));
    const part = path.join(dir, "part.sqlite"); fs.writeFileSync(part, full.subarray(0, Math.floor(full.length / 2)));
    for (const f of [empty, junk, part]) {
      let err: unknown;
      try { getReadDb(f); } catch (e) { err = e; }
      expect(err, f).toBeInstanceOf(CorruptDatabaseError);
      expect(err).toBeInstanceOf(DatabaseUnavailableError);
    }
    expect(getReadDb(path.join(dir, "big.sqlite"))).toBeTruthy(); // the complete file still opens
  });
});
