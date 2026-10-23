import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DAHUA, expect, HAS_DB, HP, REAL_CATALOG_REQUIRED, test } from "./helpers";

/**
 * Phase 9: axe-core (WCAG 2.0/2.1 A+AA, incl. colour contrast) over EVERY important route and state, at phone and desktop width.
 * Automated only — it does not replace keyboard testing (see keyboard.spec.ts) or a screen-reader pass (NOT performed).
 */
const enc = encodeURIComponent;
const DV = enc("unknown|HDW1200CLQP");
const SHOP = "shop_8670c71ca3baff62d68de422", SHOP_B = "shop_350520090b6a5a6163f919d3", OFFER = "offer_742932354aecd83d7fc7c266";
const ROUTES: Array<[string, string, boolean]> = [
  ["home", "/", false], ["assistant", "/assistant", true],
  ["discover-need", "/discover", true], ["discover-question", `/discover?cat=${enc(HP)}`, true], ["discover-budget", `/discover?cat=${enc(HP)}&a.use=sport&a.connection=wireless`, true],
  ["discover-results", `/discover?cat=${enc(HP)}&a.use=sport&a.connection=wireless&bmin=1000000&bmax=4000000`, true], ["discover-clarify", `/discover?text=${enc("دوربین برای مغازه")}`, true],
  ["discover-recovery", `/discover?cat=${enc("دوربین مدار بسته")}&a.environment=outdoor&a.night=yes&bmax=50000&show=1`, true],
  ["search-empty", "/search", false], ["search-results", `/search?q=${enc("هدفن بیسیم")}`, true], ["search-model", "/search?q=hdw1200clqp", true], ["search-invalid", `/search?q=${enc("و با")}`, true],
  ["product", `/products/${DAHUA}`, true], ["product-404", "/products/product_00000000000000000000dead", true],
  ["compare-products-empty", "/compare/products", false], ["compare-handoff", `/compare?product=${DAHUA}`, true],
  ["sellers", `/sellers?product=${DAHUA}&variant=${DV}&r=3000`, true], ["sellers-none", `/sellers?product=${DAHUA}&variant=${DV}&r=100`, true], ["sellers-empty", "/sellers", true],
  ["shop", `/shops/${SHOP}`, true], ["shop-404", "/shops/shop_00000000000000000000dead", true],
  ["compare-sellers", `/compare?product=${DAHUA}&variant=${DV}&shops=${SHOP},${SHOP_B}`, true],
  ["inquiry-legacy", "/missions/new", false], ["inquiry", `/missions/new?product=${DAHUA}&variant=${DV}&shop=${SHOP}&offer=${OFFER}&visit=2026-10-24T11:00`, true], ["inquiry-error", `/missions/new?product=${DAHUA}&shop=${SHOP_B}&offer=${OFFER}`, true],
  ["missions-hub", "/missions", false], ["data", "/data", false], ["not-found", "/no-such-page", false],
];
const audit = async (page: Page, label: string) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${label}: ${v.id} (${v.impact}) ×${v.nodes.length} → ${v.nodes[0]?.target.join(" ")} :: ${(v.nodes[0]?.any[0]?.message ?? v.help).slice(0, 140)}`), label).toEqual([]);
  return r.violations.filter((v) => v.impact === "moderate" || v.impact === "minor").map((v) => `${label}: ${v.id} (${v.impact}) ×${v.nodes.length}`);
};

for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  test.describe(`axe sweep @ ${vp.w}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });
    for (const [name, url, db] of ROUTES) {
      test(`${name}`, async ({ page }) => {
        test.skip(db && !HAS_DB, REAL_CATALOG_REQUIRED);
        await page.emulateMedia({ reducedMotion: "reduce" }); // the pages fade sections in; a mid-fade frame blends colours (false contrast reading)
        await page.goto(url);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        await audit(page, name);
      });
    }
  });
}
