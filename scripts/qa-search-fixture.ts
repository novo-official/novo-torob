/** Isolated synthetic catalog for search UI QA. Never writes data/app.sqlite. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { runImport } from "@/server/import/run";

async function main() {
  const out = path.resolve(".cache/qa-search");
  const source = path.join(out, "csv");
  fs.mkdirSync(source, { recursive: true });
  const read = (name: string) => parse(fs.readFileSync(`tests/fixtures/csv/${name}.csv`), { columns: true }) as Record<string, string>[];
  const products = read("products"), shops = read("shops"), offers = read("offers");
  const hashId = (kind: string, value: string) => `${kind}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
  const ids = new Map<string, string>();
  for (const [rows, kind] of [[products, "product"], [shops, "shop"], [offers, "offer"]] as const) {
    for (const row of rows) ids.set(row[`${kind}_id`]!, hashId(kind, row[`${kind}_id`]!));
  }
  for (const rows of [products, shops, offers]) for (const row of rows) {
    for (const key of ["product_id", "shop_id", "offer_id"]) if (row[key] && ids.has(row[key]!)) row[key] = ids.get(row[key]!)!;
  }
  const pump = products.find((p) => p.product_id === ids.get("product_fx_pump"))!;
  const offer = offers.find((o) => o.offer_id === ids.get("offer_fx_12"))!;
  for (let i = 1; i <= 26; i++) {
    const productId = hashId("product", `search-qa-${i}`);
    products.push({ ...pump, product_id: productId, category_name: i <= 18 ? "پمپ آب" : "تجهیزات آزمایشی", persian_title: `پمپ آب الکتروژن CM100 — نمونهٔ آزمایشی ${i}`, image_urls: "[]" });
    offers.push({ ...offer, product_id: productId, offer_id: hashId("offer", `search-qa-${i}`), price_toman: String(14_000_000 + i * 100_000) });
  }
  const noPrice = hashId("product", "search-qa-no-price");
  products.push({ ...pump, product_id: noPrice, persian_title: "پمپ آب آزمایشی بدون قیمت", image_urls: "[]" });
  offers.push({ ...offer, product_id: noPrice, offer_id: hashId("offer", "search-qa-no-price"), price_toman: "null" });
  for (const [name, rows] of [["products", products], ["shops", shops], ["offers", offers]] as const) {
    const fields = Object.keys(rows[0]!);
    const csv = [fields, ...rows.map((row) => fields.map((key) => row[key] ?? ""))].map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
    fs.writeFileSync(path.join(source, `${name}.csv`), csv);
  }
  await runImport({ source: { kind: "dir", path: source }, outPath: path.join(out, "catalog.sqlite") });
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ synthetic: true, product: ids.get("product_fx_pump"), camera: ids.get("product_fx_camera"), noPrice, rows: { products: products.length, shops: shops.length, offers: offers.length } }, null, 2));
  console.log(`Search QA: ${products.length} synthetic products → .cache/qa-search/catalog.sqlite`);
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
