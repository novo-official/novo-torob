import { expect, DAHUA, HAS_DB, test } from "./helpers";

/**
 * Document-title regression (Phase 10A): the title must be correct after every full navigation, after a refresh, and after CLIENT-side
 * navigation, where Next also mirrors it into its route announcer (aria-live) for assistive technology. Assertions use bounded retries only.
 */
const SUFFIX = " | هم‌قدم";
const ROUTES: Array<[string, string]> = [
  ["/", "هم‌قدم — دستیار خرید حضوری تهران"],
  ["/assistant", "دستیار خرید" + SUFFIX],
  ["/discover", "کمکم کن انتخاب کنم" + SUFFIX],
  ["/search", "جست‌وجوی مدل" + SUFFIX],
  ["/sellers", "فروشنده‌های اطراف" + SUFFIX],
  ["/compare", "مقایسه‌ی فروشنده‌ها" + SUFFIX],
  ["/compare/products", "مقایسه‌ی محصولات" + SUFFIX],
  ["/missions", "ماموریت‌های من" + SUFFIX],
  ["/missions/new", "پرسش از فروشنده" + SUFFIX],
  ["/data", "درباره‌ی داده‌ها و محدودیت‌ها" + SUFFIX],
];

test.describe("document title", () => {
  for (const [path, title] of ROUTES) {
    test(`${path}: full load and refresh`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await page.reload();
      await expect(page).toHaveTitle(title);
    });
  }

  test("client-side navigation (real link clicks) updates the title and the route announcer, repeatedly (no stale / empty title)", async ({ page }) => {
    // Next swaps <title> during a transition, so document.title can be empty for a tick (the announcer then falls back to the page's h1).
    // We assert the settled state with bounded retries, and that every navigation is announced to assistive technology.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForFunction(() => !!document.querySelector("next-route-announcer"));
    const nav = page.getByRole("navigation", { name: "ناوبری اصلی (موبایل)" });
    const announcer = page.locator("#__next-route-announcer__");
    const order: Array<[string, string]> = [["دستیار", "/assistant"], ["راهنما", "/discover"], ["خریدهای من", "/missions"], ["جست‌وجو", "/search"], ["خانه", "/"]];
    for (let round = 0; round < 3; round++) {
      for (const [label, path] of order) {
        await nav.getByRole("link", { name: label }).click();
        const want = ROUTES.find(([p]) => p === path)![1];
        await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : path + "$"}`));
        await expect(page).toHaveTitle(want);
        await expect(announcer).toHaveAttribute("aria-live", "assertive");
        await expect(announcer).toHaveText(want);
      }
    }
  });

  test("mission flow: start → mission → tab switches keep a non-empty, correct title", async ({ page }) => {
    test.skip(!HAS_DB, "needs data/app.sqlite");
    const start = `/missions/start?product=${DAHUA}&variant=${encodeURIComponent("unknown|HDW1200CLQP")}&shop=shop_8670c71ca3baff62d68de422&offer=offer_742932354aecd83d7fc7c266&visit=2026-10-24T11:00&district=ferdowsi&bmax=4500000`;
    for (let i = 0; i < 3; i++) {
      await page.goto(start);
      await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
      await expect(page).toHaveTitle("ماموریت مراجعه" + SUFFIX);
      for (const t of ["visit", "inquiry", "recover"]) {
        await page.getByTestId(`tab-${t}-btn`).click();
        await expect(page.getByTestId(`tab-${t}`)).toBeVisible({ timeout: 20_000 });
        await expect(page).toHaveTitle("ماموریت مراجعه" + SUFFIX);
      }
      await page.reload();
      await expect(page).toHaveTitle("ماموریت مراجعه" + SUFFIX);
    }
  });
});
