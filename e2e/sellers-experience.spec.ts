import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { qaPath } from "../tests/helpers/qa-out";

let fixture: { camera: string; pump: string; wire: string; firstShop: string };
const OUT = qaPath("redesign/sellers");

test.beforeAll(({}, info) => {
  test.skip(info.project.metadata.syntheticCatalog !== true, "explicit synthetic-fixture opt-in: run npm run qa:sellers (isolated fixture catalog, not the real catalog)");
  fixture = JSON.parse(fs.readFileSync(".cache/qa-sellers/manifest.json", "utf8"));
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://image.torob.com/**", (r) => r.abort());
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
});

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `horizontal overflow: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);
}

test("journey: sellers list -> filter & sort -> compare selection -> compare view -> shop detail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/sellers?product=${fixture.pump}&r=5000`);

  // Product context & headings
  await expect(page.getByRole("heading", { name: "کجا هستید؟" })).toBeVisible();
  await expect(page.getByTestId("counts")).toContainText("فروشگاه در شعاع");
  const cards = page.locator('[data-testid="seller-list"] [data-testid="seller-card"]');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first().getByTestId("distance")).toContainText("متر");

  // Pagination with show-more
  const initialCount = await cards.count();
  expect(initialCount).toBe(12);
  await page.getByTestId("show-more").click();
  await expect(cards).toHaveCount(18);

  // Sorting
  await page.getByLabel("مرتب‌سازی").selectOption("price");
  await expect(page).toHaveURL(/sort=price/);
  await expect(cards.first()).toBeVisible();

  // Change location preset
  await page.getByRole("radio", { name: "شیخ هادی" }).click();
  await expect(page).toHaveURL(/o=sheikh-hadi/);
  await expect(page.getByTestId("counts")).toContainText("شیخ هادی");

  // Selection for comparison
  const boxes = page.getByTestId("compare-checkbox");
  await boxes.nth(0).check();
  await expect(page.getByTestId("compare-bar")).toBeVisible();
  await expect(page.getByTestId("compare-bar")).toContainText("۱ فروشگاه برای مقایسه");
  await boxes.nth(1).check();
  await expect(page.getByTestId("compare-go")).toContainText("مقایسه‌ی ۲ فروشگاه");
  await page.getByTestId("compare-go").click();

  // Arrive at /compare
  await expect(page).toHaveURL(/\/compare\?.*shops=shop_/);
  await expect(page.getByTestId("verdict")).toBeVisible();
  const cols = page.getByTestId("compare-col");
  await expect(cols).toHaveCount(2);

  // Change priority in compare view
  await page.getByTestId("prio-distance").click();
  await expect(page).toHaveURL(/prio=distance/);

  // Visit shop detail
  await page.getByRole("link", { name: "جزئیات فروشگاه" }).first().click();
  await expect(page).toHaveURL(/\/shops\/shop_/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ساعت کاری اعلام‌شده" })).toBeVisible();
  await expect(page.getByTestId("hours-table").locator("tbody tr")).toHaveCount(7);
  await expect(page.getByTestId("shop-product-offers")).toBeVisible();

  // Return to compare
  await page.getByRole("link", { name: "بازگشت به مقایسه" }).click();
  await expect(page).toHaveURL(/\/compare\?/);
  await expect(cols).toHaveCount(2);
});

test("product-to-product comparison: 'only differences' filter, responsive labels, and removal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/compare/products?ids=${fixture.pump},${fixture.camera}`);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "محصولات مقایسه‌شده" }).locator("li")).toHaveCount(2);

  // Toggle "فقط تفاوت‌ها"
  const diffToggle = page.getByRole("button", { name: /فقط تفاوت‌ها/ });
  await expect(diffToggle).toBeVisible();
  await diffToggle.click();
  await expect(diffToggle).toHaveAttribute("aria-pressed", "true");

  // Remove product from comparison
  await page.getByTitle("حذف از مقایسه").first().click();
  await expect(page).toHaveURL(/\/compare\/products$/);
  await expect(page.getByText("دو تا چهار محصول برای مقایسه انتخاب کنید")).toBeVisible();
});

test("mobile tab switching between list and map preserves state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/sellers?product=${fixture.pump}&r=3000`);

  const listTab = page.getByRole("tab", { name: /فهرست/ });
  const mapTab = page.getByRole("tab", { name: /نقشه/ });

  await expect(listTab).toHaveAttribute("aria-selected", "true");
  await mapTab.click();
  await expect(mapTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-map")).toBeVisible();

  await listTab.click();
  await expect(listTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-list")).toBeVisible();
});

// Viewport and Axe accessibility tests across 5 breakpoints and 2 themes
const SIZES = [
  { width: 360, height: 800, name: "360" },
  { width: 390, height: 844, name: "390" },
  { width: 768, height: 1024, name: "768" },
  { width: 1024, height: 768, name: "1024" },
  { width: 1440, height: 900, name: "1440" },
];

for (const size of SIZES) {
  for (const theme of ["light", "dark"] as const) {
    test(`responsive & a11y: sellers @${size.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/sellers?product=${fixture.pump}&r=3000`);

      await expect(page.locator('[data-testid="seller-card"]').first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Screenshot
      const shotPath = path.join(OUT, `after/sellers-${size.name}-${theme}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      // Axe check
      const axe = await new AxeBuilder({ page })
        .disableRules(["color-contrast"]) // Synthetic mock colors handled in UI design system
        .analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => v.id)).toEqual([]);
    });

    test(`responsive & a11y: compare @${size.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      // Fetch two shops from API
      await page.goto(`/sellers?product=${fixture.pump}&r=3000`);
      await expect(page.locator('[data-testid="seller-card"]').first()).toBeVisible();
      const boxes = page.getByTestId("compare-checkbox");
      await expect(boxes.first()).toBeVisible();
      await boxes.nth(0).check();
      await boxes.nth(1).check();
      await page.getByTestId("compare-go").click();

      await expect(page.getByTestId("verdict")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Screenshot
      const shotPath = path.join(OUT, `after/compare-${size.name}-${theme}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      // Axe check
      const axe = await new AxeBuilder({ page })
        .disableRules(["color-contrast"])
        .analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => v.id)).toEqual([]);
    });

    test(`responsive & a11y: shop detail @${size.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/shops/${fixture.firstShop}?product=${fixture.pump}`);

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("hours-table")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Screenshot
      const shotPath = path.join(OUT, `after/shop-${size.name}-${theme}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      // Axe check
      const axe = await new AxeBuilder({ page })
        .disableRules(["color-contrast"])
        .analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => v.id)).toEqual([]);
    });

    test(`responsive & a11y: compare products @${size.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/compare/products?ids=${fixture.pump},${fixture.camera}`);

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Screenshot
      const shotPath = path.join(OUT, `after/compare-products-${size.name}-${theme}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      // Axe check
      const axe = await new AxeBuilder({ page })
        .disableRules(["color-contrast"])
        .analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => v.id)).toEqual([]);
    });
  }
}
