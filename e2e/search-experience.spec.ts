import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

let fixture: { product: string; camera: string; noPrice: string };
test.beforeAll(({}, info) => {
  test.skip(info.project.metadata.syntheticCatalog !== true, "explicit synthetic-fixture opt-in: run npm run qa:search (isolated fixture catalog, not the real catalog)");
  fixture = JSON.parse(fs.readFileSync(".cache/qa-search/manifest.json", "utf8"));
});
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://image.torob.com/**", (r) => r.abort());
});
const queryUrl = (q: string) => `/search?${new URLSearchParams({ q })}`;

// Results are server rendered: the fixture exercises real search/facets/pagination rather than mocking cards.
test("category filters, pagination, selected products and detail return preserve the search context", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(queryUrl("پمپ"));
  const cards = page.getByTestId("product-card");
  await expect(cards).toHaveCount(12);
  await page.getByRole("navigation", { name: "فیلتر دسته‌های جست‌وجو" }).getByRole("link", { name: /تجهیزات آزمایشی/ }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("cat") === "تجهیزات آزمایشی");
  expect(new URL(page.url()).searchParams.get("cat")).toBe("تجهیزات آزمایشی");
  await expect(cards).toHaveCount(8);
  await page.reload();
  await expect(page.getByRole("combobox")).toHaveValue("پمپ");
  await page.getByRole("link", { name: /حذف فیلتر دسته/ }).click();
  await expect(cards).toHaveCount(12);
  expect(new URL(page.url()).searchParams.has("cat")).toBe(false);
  await cards.first().getByRole("button", { name: /افزودن به مقایسه/ }).click();
  await page.getByRole("navigation", { name: "صفحه‌بندی" }).getByRole("link", { name: "بعدی" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("offset") === "12");
  expect(new URL(page.url()).searchParams.get("offset")).toBe("12");
  await expect(page.getByRole("combobox")).toHaveValue("پمپ");
  await page.goBack();
  await expect(cards.first().getByRole("button", { name: /در مقایسه/ })).toHaveAttribute("aria-pressed", "true");
  const returnUrl = page.url();
  await cards.first().getByRole("link", { name: /مشاهده‌ی جزئیات/ }).click();
  await page.getByRole("link", { name: /بازگشت به نتایج/ }).click();
  await expect(page).toHaveURL(returnUrl);
  await expect(page.getByRole("combobox")).toHaveValue("پمپ");
});

test("invalid, absent, partial, unpriced and exhausted-page results each offer an honest recovery", async ({ page }) => {
  await page.goto(queryUrl("و با"));
  await expect(page.getByRole("heading", { name: "عبارت کافی نیست" })).toBeVisible();
  await expect(page.getByTestId("product-card")).toHaveCount(0);
  await page.goto(queryUrl("zzzzzqqqqq"));
  await expect(page.getByRole("heading", { name: "نتیجه‌ای پیدا نشد" })).toBeVisible();
  await expect(page.getByText(/به معنی نبودن کالا در بازار نیست/)).toBeVisible();
  await page.goto(queryUrl("پمپ ززززززز"));
  await expect(page.getByText(/فقط بخشی از کلمه‌ها را دارند/)).toBeVisible();
  await expect(page.getByTestId("product-card").first()).toContainText("تطبیق جزئی");
  await page.goto(queryUrl("بدون قیمت"));
  const unpriced = page.getByTestId("product-card").filter({ hasText: "پمپ آب آزمایشی بدون قیمت" });
  await expect(unpriced).toContainText("قیمت قابل اتکا موجود نیست");
  expect(await unpriced.innerText()).not.toMatch(/(?:^|\s)۰ تومان/);
  await page.goto(queryUrl("پمپ") + "&offset=492&cat=" + encodeURIComponent("پمپ آب"));
  await expect(page.getByRole("heading", { name: "در این صفحه نتیجه‌ای نیست" })).toBeVisible();
  await page.getByRole("link", { name: "برگشت به اولین نتایج" }).click();
  expect(new URL(page.url()).searchParams.get("cat")).toBe("پمپ آب");
  await expect(page.getByTestId("product-card")).toHaveCount(12);
});

test("a response for the previous query cannot replace current suggestions; Escape cancels the active option", async ({ page }) => {
  let releaseOld!: () => void;
  let finishOld!: () => void;
  const held = new Promise<void>((resolve) => { releaseOld = resolve; });
  const completed = new Promise<void>((resolve) => { finishOld = resolve; });
  await page.route("**/api/suggest?*", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q")!;
    if (q === "قدیمی") await held;
    try {
      await route.fulfill({ json: { query: q, tooShort: false, corrections: [], categories: [], products: [{ id: fixture.product, title: q === "قدیمی" ? "پیشنهاد قبلی" : "پیشنهاد تازه", categoryName: "پمپ آب" }] } });
    } catch { /* The earlier request is expected to be aborted. */ }
    if (q === "قدیمی") finishOld();
  });
  await page.goto("/search");
  const input = page.getByRole("combobox");
  const oldRequested = page.waitForRequest((r) => r.url().includes("/api/suggest?") && new URL(r.url()).searchParams.get("q") === "قدیمی");
  await input.fill("قدیمی");
  await oldRequested;
  await input.fill("تازه");
  await expect(page.getByRole("option", { name: /پیشنهاد تازه/ })).toBeVisible();
  releaseOld();
  await completed;
  await expect(page.getByRole("option", { name: /پیشنهاد قبلی/ })).toHaveCount(0);
  await input.press("ArrowDown");
  const optionId = await input.getAttribute("aria-activedescendant");
  expect(optionId).toBeTruthy();
  await expect(page.locator(`[id="${optionId}"]`)).toHaveAttribute("aria-selected", "true");
  await input.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(input).not.toHaveAttribute("aria-activedescendant");
  await input.press("Enter");
  expect(new URL(page.url()).pathname).toBe("/search");
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "تازه");
  expect(new URL(page.url()).searchParams.get("q")).toBe("تازه");
});

test("failed suggestions leave normal search usable, and Back restores the visible query", async ({ page }) => {
  await page.route("**/api/suggest?*", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto("/search");
  const input = page.getByRole("combobox");
  await input.fill("پمپ");
  await expect(page.getByText(/پیشنهادها دریافت نشدند/)).toBeVisible();
  await page.getByRole("button", { name: "جست‌وجوی کالا" }).click();
  await expect(page.getByTestId("product-card")).toHaveCount(12);
  await input.fill("داهوا");
  await page.getByRole("button", { name: "جست‌وجوی کالا" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "داهوا");
  await expect(input).toHaveValue("داهوا");
  await page.goBack();
  await expect(input).toHaveValue("پمپ");
});

test("comparison limit explains disabled choices and selection remains accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(queryUrl("پمپ"));
  const cards = page.getByTestId("product-card");
  for (let i = 0; i < 4; i++) await cards.nth(i).getByRole("button", { name: /افزودن به مقایسه/ }).click();
  const fifth = cards.nth(4).getByRole("button", { name: /افزودن به مقایسه/ });
  await expect(fifth).toBeDisabled();
  await expect(cards.nth(4).getByText(/حداکثر ۴ محصول/)).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
  await cards.first().getByRole("button", { name: /حذف از مقایسه/ }).click();
  await expect(fifth).toBeEnabled();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`search results and shared advisor cards are responsive and accessible — ${colorScheme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(queryUrl("پمپ"));
      await expect(page.getByTestId("product-card")).toHaveCount(12);
      const size = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(size.sw).toBeLessThanOrEqual(size.cw);
      if (width === 390 || width === 1440) {
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
      }
    }
    await page.goto("/discover?cat=" + encodeURIComponent("پمپ آب") + "&show=1");
    await expect(page.getByTestId("product-card").first()).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
}

test("search preserves the category in its native GET fallback without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto("/search");
    await page.getByRole("combobox").fill("پمپ");
    await page.getByRole("button", { name: "جست‌وجوی کالا" }).click();
    await expect(page.getByTestId("product-card")).toHaveCount(12);
    await page.goto(queryUrl("پمپ") + "&cat=" + encodeURIComponent("پمپ آب"));
    await page.getByRole("combobox").fill("CM100");
    await page.getByRole("button", { name: "جست‌وجوی کالا" }).click();
    expect(new URL(page.url()).searchParams.get("q")).toBe("CM100");
    expect(new URL(page.url()).searchParams.get("cat")).toBe("پمپ آب");
    await expect(page.getByTestId("product-card").first()).toBeVisible();
  } finally { await context.close(); }
});

test.describe("touch selection", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("a suggestion opens with a touch tap and returns to the typed search context", async ({ page }) => {
    await page.goto("/search");
    await page.getByRole("combobox").fill("پمپ");
    await page.getByRole("option").first().tap();
    await expect(page).toHaveURL(/\/products\/product_/);
    await page.getByRole("link", { name: /بازگشت به نتایج/ }).click();
    await expect(page.getByRole("combobox")).toHaveValue("پمپ");
    await expect(page.getByTestId("product-card")).toHaveCount(12);
  });
});

test("clearing a pending suggestion cannot reopen it, and long queries still support full search", async ({ page }) => {
  let release!: () => void;
  let complete!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const finished = new Promise<void>((resolve) => { complete = resolve; });
  await page.route("**/api/suggest?*", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    await held;
    try { await route.fulfill({ json: { query: q, tooShort: false, corrections: [], categories: [], products: [{ id: fixture.product, title: "پیشنهاد دیررس", categoryName: "پمپ آب" }] } }); } catch { /* Aborted by clearing. */ }
    complete();
  });
  await page.goto("/search");
  const input = page.getByRole("combobox");
  const requested = page.waitForRequest("**/api/suggest?*");
  await input.fill("پمپ");
  await requested;
  await page.getByRole("button", { name: "پاک کردن عبارت" }).click();
  release();
  await finished;
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("option")).toHaveCount(0);
  await input.fill("مدل".repeat(30));
  await expect(page.getByText(/برای عبارت بلند، دکمهٔ جست‌وجو/)).toBeVisible();
  await expect(page.getByRole("button", { name: "جست‌وجوی کالا" })).toBeEnabled();
});

test("slow search navigation reports pending state until new server results arrive", async ({ page }) => {
  await page.goto("/search");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/search?*", async (route) => {
    if (route.request().headers().rsc === "1") await held;
    await route.continue();
  });
  await page.getByRole("combobox").fill("پمپ");
  await page.getByRole("button", { name: "جست‌وجوی کالا" }).click();
  await expect(page.getByRole("status").filter({ hasText: "در حال جست‌وجو…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "جست‌وجوی کالا" })).toBeDisabled();
  release();
  await expect(page.getByTestId("product-card")).toHaveCount(12);
  await expect(page.getByRole("button", { name: "جست‌وجوی کالا" })).toBeEnabled();
});
