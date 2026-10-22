import AxeBuilder from "@axe-core/playwright";
import { expect, expectNoHorizontalOverflow, ROUTES, test } from "./helpers";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`redesigned shell — ${colorScheme}`, () => {
    test.use({ colorScheme, reducedMotion: "reduce" });

    test("home search is above the mobile navigation and submits the actual Persian query", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      const input = page.getByRole("searchbox", { name: "دنبال چه کالایی می‌گردید؟" });
      const nav = page.getByRole("navigation", { name: "ناوبری اصلی (موبایل)" });
      const inputBounds = (await input.boundingBox())!;
      expect(inputBounds.y + inputBounds.height).toBeLessThan((await nav.boundingBox())!.y);
      await input.fill("هدفون بی‌سیم");
      await page.getByRole("search").getByRole("button", { name: "جست‌وجو", exact: true }).click();
      await expect(page).toHaveURL(/\/search\?q=/);
      expect(new URL(page.url()).searchParams.get("q")).toBe("هدفون بی‌سیم");
      await expect(nav.getByRole("link", { name: "جست‌وجو", exact: true })).toHaveAttribute("aria-current", "page");
    });

    test("home and shared shell have no serious accessibility violations on phone and desktop", async ({ page }) => {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await page.evaluate(() => document.fonts.ready);
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
        await page.keyboard.press("Tab");
        await expect(page.getByRole("link", { name: "پرش به محتوا" })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.locator("main")).toBeFocused();
      }
    });
  });
}

test("shared navigation and all entry pages fit narrow phones, tablets and desktop", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ROUTES) {
      await page.goto(route);
      await expectNoHorizontalOverflow(page);
      const nav = page.getByRole("navigation", { name: width < 768 ? "ناوبری اصلی (موبایل)" : "ناوبری اصلی", exact: true });
      await expect(nav).toBeVisible();
      for (const link of await nav.getByRole("link").all()) expect((await link.boundingBox())!.height, `${route}: ${await link.innerText()}`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("comparison tray reserves its real height, expands with keyboard and stays clear of mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => sessionStorage.setItem("hamghadam.compare.v1", JSON.stringify(
    ["a1", "b2", "c3", "d4"].map((id) => ({ id: `product_${id}`, title: `محصول آزمایشی با نام طولانی برای بررسی فضای مقایسه ${id}` })),
  )));
  await page.goto("/");
  const tray = page.getByRole("complementary", { name: "سبد مقایسه" });
  await expect(tray).toBeVisible();
  const reserved = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--compare-tray-height")));
  await expect.poll(reserved).toBeGreaterThan(0);
  const collapsed = await reserved();
  const disclosure = tray.getByRole("button", { name: "مقایسهٔ ۴ محصول" });
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect.poll(reserved).toBeGreaterThan(collapsed);
  const bounds = (await tray.boundingBox())!;
  const nav = (await page.getByRole("navigation", { name: "ناوبری اصلی (موبایل)" }).boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThan(nav.y);
  await expectNoHorizontalOverflow(page);
  await tray.getByRole("button", { name: /حذف محصول آزمایشی/ }).first().click();
  await expect(tray.getByRole("button", { name: "مقایسهٔ ۳ محصول" })).toBeVisible();
  await tray.getByRole("button", { name: "پاک کردن", exact: true }).click();
  await expect(tray).toHaveCount(0);
  await expect.poll(reserved).toBe(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("hamghadam.compare.v1") ?? "[]"))).toEqual([]);
});

test("primary home search also works without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("searchbox", { name: "دنبال چه کالایی می‌گردید؟" }).fill("دوربین داهوا");
    await page.getByRole("search").getByRole("button", { name: "جست‌وجو", exact: true }).click();
    expect(new URL(page.url()).pathname).toBe("/search");
    expect(new URL(page.url()).searchParams.get("q")).toBe("دوربین داهوا");
  } finally {
    await context.close();
  }
});
