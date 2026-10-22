/** Isolated synthetic catalog for Sellers & Compare UI QA. Never writes data/app.sqlite. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { runImport } from "@/server/import/run";

async function main() {
  const out = path.resolve(".cache/qa-sellers");
  const source = path.join(out, "csv");
  fs.mkdirSync(source, { recursive: true });

  const read = (name: string) => parse(fs.readFileSync(`tests/fixtures/csv/${name}.csv`), { columns: true }) as Record<string, string>[];
  const products = read("products");
  const baseShops = read("shops");
  const baseOffers = read("offers");

  const hashId = (kind: string, value: string) => `${kind}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
  const ids = new Map<string, string>();
  for (const [rows, kind] of [[products, "product"], [baseShops, "shop"], [baseOffers, "offer"]] as const) {
    for (const row of rows) ids.set(row[`${kind}_id`]!, hashId(kind, row[`${kind}_id`]!));
  }
  for (const rows of [products, baseShops, baseOffers]) {
    for (const row of rows) {
      for (const key of ["product_id", "shop_id", "offer_id"]) {
        if (row[key] && ids.has(row[key]!)) row[key] = ids.get(row[key]!)!;
      }
    }
  }

  const cameraProdId = ids.get("product_fx_camera")!;
  const pumpProdId = ids.get("product_fx_pump")!;

  const shops = [...baseShops];
  const offers = [...baseOffers];

  // Add 16 additional synthetic shops around central Tehran (Ferdowsi, Sheikh Hadi, Baharestan)
  // so that we have >= 20 shops with offers for camera & pump
  const locations = [
    { label: "فردوسی", lat: 35.6932, lon: 51.4205 },
    { label: "فردوسی", lat: 35.6940, lon: 51.4215 },
    { label: "فردوسی", lat: 35.6925, lon: 51.4195 },
    { label: "شیخ هادی", lat: 35.6950, lon: 51.4095 },
    { label: "شیخ هادی", lat: 35.6945, lon: 51.4085 },
    { label: "شیخ هادی", lat: 35.6960, lon: 51.4110 },
    { label: "بهارستان", lat: 35.6915, lon: 51.4255 },
    { label: "بهارستان", lat: 35.6928, lon: 51.4270 },
    { label: "بهارستان", lat: 35.6905, lon: 51.4245 },
    { label: "فردوسی", lat: 35.6980, lon: 51.4220 }, // ~750m
    { label: "فردوسی", lat: 35.7010, lon: 51.4230 }, // ~1.1km
    { label: "شیخ هادی", lat: 35.7050, lon: 51.4050 }, // ~1.8km
    { label: "بهارستان", lat: 35.7100, lon: 51.4350 }, // ~2.5km
    { label: "تهرانسر", lat: 35.6900, lon: 51.2600 }, // ~15km (outside radius)
    { label: "پیروزی", lat: 35.6850, lon: 51.4750 }, // ~5.5km
    { label: "تجریش", lat: 35.8050, lon: 51.4300 }, // ~12km
  ];

  const templateShop = baseShops[0]!;
  locations.forEach((loc, i) => {
    const shopId = hashId("shop", `sellers-qa-shop-${i + 1}`);
    shops.push({
      ...templateShop,
      shop_id: shopId,
      name: `فروشگاه آزمایشی پایتخت ${i + 1}`,
      location_label: loc.label,
      lat: String(loc.lat),
      lon: String(loc.lon),
      address: `تهران، ${loc.label}، پلاک ${i * 10 + 12}`,
      category_names: '["دوربین مدار بسته","پمپ آب"]',
    });

    // Camera offer
    offers.push({
      offer_id: hashId("offer", `sellers-qa-cam-${i + 1}`),
      product_id: cameraProdId,
      shop_id: shopId,
      seller_title: `دوربین مداربسته داهوا DH-HAC-HDW1200CLQP-IL-A (فروشگاه ${i + 1})`,
      price_toman: String(3_950_000 + i * 50_000),
      last_price_changed_at: `2026-10-${String((i % 12) + 1).padStart(2, "0")}T08:00:00.000000+00:00`,
      description: "",
      warranty: i % 2 === 0 ? '{"period_months":18,"provider":"گارانتی اصلی"}' : "null",
    });

    // Pump offer
    offers.push({
      offer_id: hashId("offer", `sellers-qa-pump-${i + 1}`),
      product_id: pumpProdId,
      shop_id: shopId,
      seller_title: `پمپ آب الکتروژن مدل CM100 کد ${i + 1}`,
      price_toman: String(14_500_000 + i * 80_000),
      last_price_changed_at: `2026-10-${String((i % 12) + 1).padStart(2, "0")}T08:00:00.000000+00:00`,
      description: "",
      warranty: "null",
    });
  });

  for (const [name, rows] of [["products", products], ["shops", shops], ["offers", offers]] as const) {
    const fields = Object.keys(rows[0]!);
    const csv = [fields, ...rows.map((row) => fields.map((key) => row[key] ?? ""))].map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
    fs.writeFileSync(path.join(source, `${name}.csv`), csv);
  }

  await runImport({ source: { kind: "dir", path: source }, outPath: path.join(out, "catalog.sqlite") });

  const manifest = {
    synthetic: true,
    camera: cameraProdId,
    pump: pumpProdId,
    wire: ids.get("product_fx_wire"),
    shopsCount: shops.length,
    offersCount: offers.length,
    firstShop: shops[0]!.shop_id,
  };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Sellers QA: ${shops.length} shops, ${offers.length} offers → .cache/qa-sellers/catalog.sqlite`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
