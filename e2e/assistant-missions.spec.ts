import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { qaPath } from "../tests/helpers/qa-out";

// Loaded lazily and only for the synthetic-fixture project (npm run qa:assistant): a clean clone must not crash at import time,
// and this spec must never run against the real catalog (its IDs are fixture IDs).
let fixture: { camera: string; pump: string; firstShop: string };
test.beforeAll(({}, info) => {
  test.skip(info.project.metadata.syntheticCatalog !== true, "explicit synthetic-fixture opt-in: run npm run qa:assistant (isolated fixture catalog, not the real catalog)");
  fixture = JSON.parse(fs.readFileSync(".cache/qa-sellers/manifest.json", "utf-8"));
});

// Valid sample offer from fixture SQLite
const SAMPLE_OFFER = "offer_dfa64e798afd1cfb3e0f4264";
const SAMPLE_SHOP = "shop_1038bc272de3c94ddf2a0f8f";

const BASE_QA = qaPath("redesign");

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `horizontal overflow: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);
}

// --------------------------------------------------------------------------
// 1. Assistant Journey
// --------------------------------------------------------------------------
test("journey: assistant chat -> ask question -> assistant reply with tools", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assistant");

  // Welcome state & honesty banner
  await expect(page.getByTestId("agent-root")).toBeVisible();
  await expect(page.getByTestId("agent-provider")).toBeVisible();
  await expect(page.getByTestId("agent-welcome")).toBeVisible();

  // Type query and submit
  const input = page.getByTestId("agent-input");
  await input.fill("دوربین مدار بسته برای مغازه");
  await page.getByTestId("agent-send").click();

  // Assistant response
  const assistantMsg = page.locator('[data-testid="agent-assistant-msg"][data-latest="1"]');
  await expect(assistantMsg).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId("agent-text")).toBeVisible();
  await expect(page.getByTestId("agent-trace")).toBeVisible();
});

// --------------------------------------------------------------------------
// 2. Inquiry Workspace Journey
// --------------------------------------------------------------------------
test("journey: inquiry workspace -> compose questions -> copy draft -> record reply", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/missions/new?product=${fixture.pump}&shop=${SAMPLE_SHOP}&offer=${SAMPLE_OFFER}`);

  // Context card and server facts
  await expect(page.getByTestId("inquiry-workspace")).toBeVisible();
  await expect(page.getByTestId("inquiry-context")).toBeVisible();
  await expect(page.getByTestId("ctx-price")).toContainText("۱۵٬۲۲۰٬۰۰۰ تومان");

  // Draft & Question list (expand editor on mobile)
  await expect(page.getByTestId("draft")).toBeVisible();
  await page.getByTestId("q-toggle").click();
  await expect(page.getByTestId("question-list")).toBeVisible();

  // Copy draft
  await page.getByTestId("copy").click();
  await expect(page.getByTestId("live-msg")).toContainText("متن کپی شد");

  // Switch to reply tab and fill reply form
  await page.getByTestId("istep-reply").click();
  await expect(page.getByTestId("reply-form")).toBeVisible();

  // Choose "گفت موجود است"
  await page.getByTestId("stock-yes").click();
  await page.getByTestId("reply-submit").click();

  // Decision panel outcome
  await expect(page.getByTestId("decision-panel")).toBeVisible();
  await expect(page.getByTestId("outcome-headline")).toBeVisible();
});

// --------------------------------------------------------------------------
// 3. Missions Hub & Mission Detail Journey
// --------------------------------------------------------------------------
test("journey: missions hub -> start mission from inquiry -> view 5 tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // 1. Visit empty missions hub
  await page.goto("/missions");
  await expect(page.getByTestId("mission-hub")).toBeVisible();
  await expect(page.getByTestId("hub-privacy")).toBeVisible();

  // 2. Create mission from inquiry
  await page.goto(`/missions/new?product=${fixture.pump}&shop=${SAMPLE_SHOP}&offer=${SAMPLE_OFFER}`);
  await page.getByTestId("start-mission-cta").click();

  // 3. Arrive at /missions/msn_...
  await expect(page).toHaveURL(/\/missions\/msn_/);
  await expect(page.getByRole("tab", { name: "خلاصه" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "برنامه‌ی مراجعه" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "پرسش و پاسخ" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "جایگزین‌ها" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "ذخیره‌سازی" })).toBeVisible();

  // Tab switching
  await page.getByRole("tab", { name: "برنامه‌ی مراجعه" }).click();
  await expect(page.getByTestId("tab-visit")).toBeVisible();
});

// --------------------------------------------------------------------------
// 4. Data Transparency Page
// --------------------------------------------------------------------------
test("journey: data transparency page stats and trust rules", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/data");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("محصولات ثبت‌شده")).toBeVisible();
  await expect(page.getByText("قواعد اعتماد و تعهد به کاربر")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

// --------------------------------------------------------------------------
// 5. Product Detail Page
// --------------------------------------------------------------------------
test("journey: product detail page header and seller CTA", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/products/${fixture.pump}`);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("قیمت ثبت‌شده")).toBeVisible();
  await expect(page.getByRole("link", { name: /مشاهده فروشنده‌ها/ }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

// --------------------------------------------------------------------------
// Responsive Viewport and Axe Accessibility Matrix (5 sizes x 2 themes)
// --------------------------------------------------------------------------
const SIZES = [
  { width: 360, height: 800, name: "360" },
  { width: 390, height: 844, name: "390" },
  { width: 768, height: 1024, name: "768" },
  { width: 1024, height: 768, name: "1024" },
  { width: 1440, height: 900, name: "1440" },
];

for (const size of SIZES) {
  for (const theme of ["light", "dark"] as const) {
    test(`responsive & a11y: assistant @${size.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/assistant");

      await expect(page.getByTestId("agent-root")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const shotPath = path.join(BASE_QA, `assistant/after/assistant-${size.name}-${theme}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      const axe = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => v.id)).toEqual([]);
    });

    test(`responsive & a11y: inquiry @${size.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/missions/new?product=${fixture.pump}&shop=${SAMPLE_SHOP}&offer=${SAMPLE_OFFER}`);

      await expect(page.getByTestId("inquiry-workspace")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const shotPath = path.join(BASE_QA, `inquiry/after/inquiry-${size.name}-${theme}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      const axe = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => v.id)).toEqual([]);
    });

    test(`responsive & a11y: missions hub @${size.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/missions");

      await expect(page.getByTestId("mission-hub")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const shotPath = path.join(BASE_QA, `missions/after/missions-${size.name}-${theme}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      const axe = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => v.id)).toEqual([]);
    });

    test(`responsive & a11y: data transparency @${size.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/data");

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const shotPath = path.join(BASE_QA, `data/after/data-${size.name}-${theme}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      const axe = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => v.id)).toEqual([]);
    });

    test(`responsive & a11y: product detail @${size.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/products/${fixture.pump}`);

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const shotPath = path.join(BASE_QA, `product/after/product-${size.name}-${theme}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      const axe = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => v.id)).toEqual([]);
    });
  }
}
