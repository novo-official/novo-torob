import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "@/server/db/connect";
import { fingerprintDb } from "@/server/import/fingerprint";
import { evaluateDeclaredHours, shopsNear } from "@/server/repositories/shops";
import { searchProducts } from "@/server/repositories/products";
import { listOffersForProduct } from "@/server/repositories/offers";
import { getImportInfo } from "@/server/repositories/shared";

/**
 * Integrity + sanity verification of the REAL imported database.
 *   npm run db:verify                 # checks + demo queries + query plans
 *   npm run db:verify -- --fingerprint   # also print per-table SHA-256 (idempotency evidence)
 *   npm run db:verify -- --db <path> --expect-fixture   # fixture mode (counts 6/6/21)
 * Exit code is non-zero if any hard check fails.
 */
const args = process.argv.slice(2);
const dbPath = args.includes("--db") ? args[args.indexOf("--db") + 1]! : resolveDbPath();
const EXPECT = args.includes("--expect-fixture") ? { products: 6, shops: 6, offers: 21 } : { products: 225_903, shops: 6_476, offers: 331_506 };
const REAL = !args.includes("--expect-fixture");

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Run "npm run db:import" first.`);
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
};
const n = (sql: string, ...p: Array<string | number>) => Number((db.prepare(sql).get(...p) as { n: number }).n);
const rows = <T>(sql: string, ...p: Array<string | number>) => db.prepare(sql).all(...p) as T[];
const ms = <T>(f: () => T): [T, number] => {
  const t = performance.now();
  const r = f();
  return [r, +(performance.now() - t).toFixed(2)];
};

console.log(`\n== Database: ${dbPath} (${(fs.statSync(dbPath).size / 1024 ** 2).toFixed(1)} MiB)`);
const info = getImportInfo(db);
console.log("import run:", info);

console.log("\n== Row counts & referential integrity");
check("products", n("SELECT count(*) n FROM products") === EXPECT.products, `${n("SELECT count(*) n FROM products")}`);
check("shops", n("SELECT count(*) n FROM shops") === EXPECT.shops, `${n("SELECT count(*) n FROM shops")}`);
check("offers", n("SELECT count(*) n FROM offers") === EXPECT.offers, `${n("SELECT count(*) n FROM offers")}`);
check("no orphan offers (product)", n("SELECT count(*) n FROM offers o LEFT JOIN products p ON p.product_id=o.product_id WHERE p.product_id IS NULL") === 0);
check("no orphan offers (shop)", n("SELECT count(*) n FROM offers o LEFT JOIN shops s ON s.shop_id=o.shop_id WHERE s.shop_id IS NULL") === 0);
check("FTS rows == products", n("SELECT count(*) n FROM product_fts_docsize") === EXPECT.products);
check("R-Tree rows == shops with coordinates", n("SELECT count(*) n FROM shop_geo") === n("SELECT count(*) n FROM shops WHERE lat IS NOT NULL"));
check("PRAGMA integrity_check", (db.prepare("PRAGMA integrity_check").get() as Record<string, string>)["integrity_check"] === "ok");

if (REAL) {
  console.log("\n== Source facts the brief requires (real data)");
  check("shops without any offer = 2,684", n("SELECT count(*) n FROM shops WHERE offer_count=0") === 2684);
  check("null price = 15,083 (kept as NULL, raw text 'null' preserved)", n("SELECT count(*) n FROM offers WHERE price_toman IS NULL AND price_out_of_range=0 AND price_toman_raw='null'") === 15083);
  check("missing price timestamp = 769 (stays unknown)", n("SELECT count(*) n FROM offers WHERE price_changed_at IS NULL AND last_price_changed_at_raw='null'") === 769);
  const pairs = db.prepare("SELECT count(*) AS pairs, sum(c) AS rows_in_pairs FROM (SELECT count(*) c FROM offers GROUP BY shop_id, product_id HAVING c>1)").get() as { pairs: number; rows_in_pairs: number };
  check("repeated shop/product pairs = 9,557 (29,872 rows all preserved as separate offers)", pairs.pairs === 9557 && pairs.rows_in_pairs === 29872, JSON.stringify(pairs));
  check("exact duplicates reported separately (1,818 extra rows) and still stored", n("SELECT count(*) n FROM quality_flags WHERE code='EXACT_DUPLICATE_OFFER'") === 1818);
  const distinctTitles = n("SELECT count(*) n FROM (SELECT shop_id, product_id FROM offers GROUP BY shop_id, product_id HAVING count(DISTINCT seller_title)>1)");
  console.log(`INFO  pairs whose offers carry DIFFERENT seller titles (kept distinct): ${distinctTitles}`);
  check("prices beyond 2^53 kept as exact raw text", n("SELECT count(*) n FROM offers WHERE price_out_of_range=1 AND price_toman IS NULL") > 0, `${n("SELECT count(*) n FROM offers WHERE price_out_of_range=1")} rows`);
  const big = db.prepare("SELECT price_toman_raw r FROM offers WHERE price_out_of_range=1 ORDER BY length(price_toman_raw) DESC, price_toman_raw DESC LIMIT 1").get() as { r: string };
  check("largest raw price preserved verbatim", big.r === "733518940747298944", big.r);
}

console.log("\n== Quality flag counts");
for (const r of rows<{ code: string; severity: string; n: number }>("SELECT code, severity, count(*) n FROM quality_flags GROUP BY code, severity ORDER BY n DESC")) console.log(`  ${r.code.padEnd(32)} ${r.severity.padEnd(6)} ${r.n}`);

console.log("\n== Declared hours (never unknown→closed)");
const noSched = rows<{ shop_id: string }>("SELECT shop_id FROM shops WHERE has_schedule=0");
const probe = [new Date("2026-10-21T11:00:00+03:30"), new Date("2026-10-23T12:00:00+03:30"), new Date("2026-10-21T23:30:00+03:30")];
let wrong = 0;
for (const s of noSched) for (const t of probe) if (evaluateDeclaredHours(db, s.shop_id, t)!.status.state !== "unknown") wrong++;
check(`${noSched.length} shops without a schedule are 'unknown' at ${probe.length} probe times`, wrong === 0);
const tally: Record<string, number> = { open: 0, closed: 0, unknown: 0 };
const [, tHours] = ms(() => {
  for (const s of rows<{ shop_id: string }>("SELECT shop_id FROM shops")) tally[evaluateDeclaredHours(db, s.shop_id, probe[0]!)!.status.state]!++;
});
console.log(`INFO  all ${EXPECT.shops} shops at Wed 2026-10-21 11:00 Asia/Tehran →`, tally, `(${tHours} ms)`);
check("placeholder-only: no shop is 'open' purely from 00:00–00:00 (24/7 impossible)", n("SELECT count(*) n FROM shops WHERE hours_json LIKE '%\"start\":\"00:00\",\"end\":\"00:00\"%'") === 0);

console.log("\n== Search / index sanity (real products with shop-linked offers)");
const demo = !REAL ? [] : [["دوربین داهوا HDW1200CLQP-IL-A", "دوربین"], ["پمپ الکتروژن CM100", "پمپ"], ["موتور برق JD8500", "موتور برق"]] as const;
for (const [q] of demo) {
  const [res, t] = ms(() => searchProducts(db, q, { limit: 3 }));
  console.log(`\n  query «${q}» → strategy=${res.strategy}, ${res.items.length} hit(s) in ${t} ms`);
  const top = res.items[0];
  if (!top) continue;
  console.log(`  top: ${top.id} | ${top.title} | offers=${top.offerCount} priced=${top.pricedOfferCount}`);
  const offers = listOffersForProduct(db, top.id, { near: { lat: 35.6935, lon: 51.415 }, sort: "price" });
  const eligible = offers.filter((o) => o.comparisonEligible);
  console.log(`  offers listed=${offers.length}, comparison-eligible=${eligible.length}, flagged=${offers.length - eligible.length}`);
  for (const o of eligible.slice(0, 3)) console.log(`    ${String(o.offer.priceToman).padStart(11)} تومان | ${o.shop.name} (${o.shop.locationLabel}) | ${Math.round(o.distanceMeters ?? 0)} m | ${o.offer.sellerTitle.slice(0, 50)}`);
  check(`«${q}» has ≥1 shop-linked offer`, offers.length > 0);
}
const [near, tn] = ms(() => shopsNear(db, 35.6935, 51.415, { radiusMeters: 800, withOffersOnly: true, limit: 5 }));
const warm = Array.from({ length: 20 }, () => ms(() => shopsNear(db, 35.6935, 51.415, { radiusMeters: 800, withOffersOnly: true, limit: 5 }))[1]).sort((a, b) => a - b);
console.log(`\n  shopsNear(35.6935,51.415, 800 m, offers-only) → ${near.length} shown; cold ${tn} ms, warm median ${warm[10]} ms`, near.map((x) => `${Math.round(x.distanceMeters)}m`).join(", "));
const warmSearch = Array.from({ length: 20 }, () => ms(() => searchProducts(db, "دوربین داهوا HDW1200CLQP", { limit: 20 }))[1]).sort((a, b) => a - b);
console.log(`  searchProducts("دوربین داهوا HDW1200CLQP", 20) warm median ${warmSearch[10]} ms`);

console.log("\n== Query plans (EXPLAIN QUERY PLAN)");
const plans: Array<[string, string, Array<string | number>]> = [
  ["product by id", "SELECT * FROM products WHERE product_id = ?", ["product_x"]],
  ["offers of a product", "SELECT * FROM offers WHERE product_id = ? ORDER BY source_row", ["product_x"]],
  ["offers of a shop", "SELECT * FROM offers WHERE shop_id = ?", ["shop_x"]],
  ["flags of an offer", "SELECT * FROM quality_flags WHERE entity_type='offer' AND entity_id = ?", ["offer_x"]],
  ["FTS search", "SELECT p.product_id FROM product_fts JOIN products p ON p.rowid=product_fts.rowid WHERE product_fts MATCH ? ORDER BY bm25(product_fts) LIMIT 20", ['"دوربین"']],
  ["R-Tree shops in box", "SELECT s.shop_id FROM shop_geo g JOIN shops s ON s.rowid=g.id WHERE g.min_lat>=? AND g.max_lat<=? AND g.min_lon>=? AND g.max_lon<=?", [35.69, 35.70, 51.41, 51.42]],
];
for (const [name, sql, p] of plans) {
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p) as Array<{ detail: string }>).map((r) => r.detail).join(" ⇒ ");
  console.log(`  ${name.padEnd(22)} ${plan}`);
}

console.log("\n== Table sizes (dbstat)");
try {
  for (const r of rows<{ name: string; mb: number }>("SELECT name, round(sum(pgsize)/1048576.0,1) mb FROM dbstat GROUP BY name HAVING mb >= 5 ORDER BY mb DESC")) console.log(`  ${r.name.padEnd(36)} ${r.mb} MiB`);
} catch {
  console.log("  (dbstat unavailable in this SQLite build)");
}

if (args.includes("--fingerprint")) console.log("\n== Fingerprints (SHA-256)\n", fingerprintDb(db));

db.close();
console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
