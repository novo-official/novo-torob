import type { Readable } from "node:stream";
import { parse } from "csv-parse";
import type { CsvName } from "./sources";

/** Exact headers of the source files (verified in Phase 0 / the Phase 2 brief). */
export const EXPECTED_COLUMNS: Record<CsvName, readonly string[]> = {
  products: ["brand_name", "category_name", "image_urls", "model", "persian_title", "product_id", "specs"],
  offers: ["description", "last_price_changed_at", "offer_id", "price_toman", "product_id", "seller_title", "shop_id", "warranty"],
  shops: ["address", "category_names", "contacts", "instagram", "lat", "location_label", "lon", "name", "payment_options", "shop_id", "supports_fast_delivery", "website_url", "weekly_hours"],
};

export type CsvRow = Record<string, string>;

export function checkHeader(name: CsvName, header: readonly string[]): void {
  const want = new Set(EXPECTED_COLUMNS[name]);
  const got = new Set(header);
  const missing = [...want].filter((c) => !got.has(c));
  const extra = [...got].filter((c) => !want.has(c));
  if (missing.length || extra.length) {
    throw new Error(`${name}.csv header mismatch. missing: [${missing.join(",")}] unexpected: [${extra.join(",")}]`);
  }
}

/**
 * Stream rows (RFC-4180 aware: quoted newlines inside fields are common — 1,013 products and
 * 15,455 offers contain them). Yields 1-based data-row ordinals for provenance.
 */
export async function* readCsv(name: CsvName, input: Readable): AsyncGenerator<{ row: CsvRow; ordinal: number }> {
  const parser = input.pipe(
    parse({
      columns: (header: string[]) => {
        checkHeader(name, header);
        return header;
      },
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: false,
    }),
  );
  let ordinal = 0;
  for await (const row of parser as AsyncIterable<CsvRow>) {
    ordinal++;
    yield { row, ordinal };
  }
}
