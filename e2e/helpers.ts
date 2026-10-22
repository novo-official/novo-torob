import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test as base, type Page } from "@playwright/test";

/** 1×1 transparent PNG: product photos are stubbed so tests never depend on the external image host. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.route("https://image.torob.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    // map tiles are stubbed too: tests never depend on (or hit) the public OpenStreetMap tile servers
    await page.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await provide(page);
  },
});
export { expect };

export const DB_PATH = path.resolve(process.env.DATABASE_PATH || "data/app.sqlite");
export const HAS_DB = fs.existsSync(DB_PATH);

export function dbRow<T>(sql: string, ...p: Array<string | number>): T {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    return db.prepare(sql).get(...p) as T;
  } finally {
    db.close();
  }
}

/** A product with many shops (demo product for the nearby-sellers step) and its dominant variant group id. */
export const BIG_PRODUCT = HAS_DB
  ? dbRow<{ p: string }>("SELECT product_id p FROM offers GROUP BY product_id HAVING count(DISTINCT shop_id) >= 10 ORDER BY count(DISTINCT shop_id) DESC LIMIT 1").p
  : "";

export const DAHUA = "product_7308febc43c2f793fd0e1cf9";
export const HP = "هدفون، هدست و هندزفری";

export const ROUTES = ["/", "/assistant", "/discover", "/search", "/compare", "/compare/products", "/sellers", "/missions", "/missions/new", "/data"];

/** Phrases that would be dishonest anywhere in the UI. */
export const FORBIDDEN_CLAIMS = /ارسال\s*شد|ارسال\s*شده|موجود است(?!؟)|پیام شما فرستاده|در انبار|بهترین کیفیت|پرفروش|امتیاز کاربران بالا/;

export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export async function expectNoHorizontalOverflow(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `horizontal overflow: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);
}
