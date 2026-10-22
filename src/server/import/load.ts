import type { DatabaseSync } from "node:sqlite";
import type { Readable } from "node:stream";
import { readCsv } from "./csv";
import { parseOffer, parseProduct, parseShop } from "./parse";
import type { CsvName } from "./sources";

const BATCH = 5000;
type Bind = string | number | bigint | null;
const issues = (a: string[]): string | null => (a.length ? JSON.stringify(a) : null);

async function load(
  db: DatabaseSync,
  name: CsvName,
  input: Readable,
  insertSql: string,
  map: (row: Record<string, string>, ordinal: number) => Bind[],
  failAfterRows?: number,
): Promise<{ read: number }> {
  const stmt = db.prepare(insertSql);
  let read = 0;
  db.exec("BEGIN");
  try {
    for await (const { row, ordinal } of readCsv(name, input)) {
      stmt.run(...map(row, ordinal));
      read++;
      if (failAfterRows !== undefined && read >= failAfterRows) throw new Error(`Injected failure after ${read} ${name} rows`);
      if (read % BATCH === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { read };
}

export const loadProducts = (db: DatabaseSync, input: Readable, failAfterRows?: number) =>
  load(
    db, "products", input,
    `INSERT INTO products(product_id, brand_name, category_name, model, persian_title, image_urls_raw, specs_raw, images_json, specs_json, spec_count, parse_issues, title_norm, brand_norm, category_norm, model_keys, source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    (row, n) => {
      const p = parseProduct(row);
      return [p.product_id, p.brand_name, p.category_name, p.model, p.persian_title, p.image_urls_raw, p.specs_raw, p.images_json, p.specs_json, p.spec_count, issues(p.parse_issues), p.title_norm, p.brand_norm, p.category_norm, p.model_keys, n];
    },
    failAfterRows,
  );

export const loadShops = (db: DatabaseSync, input: Readable, failAfterRows?: number) =>
  load(
    db, "shops", input,
    `INSERT INTO shops(shop_id, name, address, location_label, lat, lon, category_names_raw, category_names_json, contacts_raw, instagram_raw, instagram_url, website_url_raw, website_url,
       payment_options_raw, payment_json, supports_fast_delivery_raw, supports_fast_delivery, weekly_hours_raw, hours_json, has_schedule, placeholder_shifts, unsupported_days, parse_issues, name_norm, label_norm, source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    (row, n) => {
      const s = parseShop(row);
      return [s.shop_id, s.name, s.address, s.location_label, s.lat, s.lon, s.category_names_raw, s.category_names_json, s.contacts_raw, s.instagram_raw, s.instagram_url, s.website_url_raw, s.website_url,
        s.payment_options_raw, s.payment_json, s.supports_fast_delivery_raw, s.supports_fast_delivery, s.weekly_hours_raw, s.hours_json, s.has_schedule, s.placeholder_shifts, s.unsupported_days, issues(s.parse_issues), s.name_norm, s.label_norm, n];
    },
    failAfterRows,
  );

export const loadOffers = (db: DatabaseSync, input: Readable, failAfterRows?: number) =>
  load(
    db, "offers", input,
    `INSERT INTO offers(offer_id, product_id, shop_id, seller_title, description, price_toman_raw, price_toman, price_out_of_range, last_price_changed_at_raw, price_changed_at, warranty_raw, warranty_months, warranty_provider, warranty_description,
       seller_title_norm, model_keys, unit_hint, parse_issues, source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    (row, n) => {
      const o = parseOffer(row);
      return [o.offer_id, o.product_id, o.shop_id, o.seller_title, o.description, o.price_toman_raw, o.price_toman, o.price_out_of_range, o.last_price_changed_at_raw, o.price_changed_at, o.warranty_raw, o.warranty_months, o.warranty_provider, o.warranty_description,
        o.seller_title_norm, o.model_keys, o.unit_hint, issues(o.parse_issues), n];
    },
    failAfterRows,
  );

/** Additive derived data: counters, FTS index, spatial index. Set-based SQL, no row-by-row JS. */
export function deriveIndexes(db: DatabaseSync): void {
  db.exec("BEGIN");
  db.exec(`UPDATE products SET offer_count = (SELECT count(*) FROM offers o WHERE o.product_id = products.product_id),
                               priced_offer_count = (SELECT count(*) FROM offers o WHERE o.product_id = products.product_id AND o.price_toman IS NOT NULL)`);
  db.exec(`UPDATE shops SET offer_count = (SELECT count(*) FROM offers o WHERE o.shop_id = shops.shop_id)`);
  // FTS: title + brand + category + model keys (product ∪ up to 16 distinct offer keys) + up to 8 distinct seller titles
  db.exec(`INSERT INTO product_fts(rowid, title, brand, category, model_keys, seller_titles)
    SELECT p.rowid, p.title_norm, p.brand_norm, p.category_norm,
      trim(p.model_keys || ' ' || COALESCE((SELECT group_concat(k, ' ') FROM (SELECT model_keys AS k FROM offers o WHERE o.product_id = p.product_id AND o.model_keys <> '' GROUP BY o.model_keys ORDER BY min(o.source_row) LIMIT 16)), '')),
      COALESCE((SELECT group_concat(t, ' ') FROM (SELECT seller_title_norm AS t FROM offers o WHERE o.product_id = p.product_id GROUP BY o.seller_title_norm ORDER BY min(o.source_row) LIMIT 8)), '')
    FROM products p ORDER BY p.rowid`);
  db.exec(`INSERT INTO shop_geo(id, min_lat, max_lat, min_lon, max_lon) SELECT rowid, lat, lat, lon, lon FROM shops WHERE lat IS NOT NULL AND lon IS NOT NULL`);
  db.exec("COMMIT");
}
