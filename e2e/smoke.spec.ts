import { collectErrors, expect, expectNoHorizontalOverflow, FORBIDDEN_CLAIMS, HAS_DB, ROUTES, test } from "./helpers";

for (const route of ROUTES) {
  test(`route ${route} renders RTL Persian without errors`, async ({ page }) => {
    const errors = collectErrors(page);
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN_CLAIMS);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test("unknown routes show the framework 404", async ({ page }) => {
  expect((await page.goto("/no-such-page"))?.status()).toBe(404);
});

test("malformed percent-escapes in dynamic ids give a 404 page, not a 500", async ({ page }) => {
  for (const route of ["/products/%E0%A4%A", "/shops/%E0%A4%A", "/missions/%E0%A4%A"]) expect((await page.goto(route))?.status(), route).toBe(404);
});

test("an unknown or malformed product id is a real 404 with a recovery path", async ({ page }) => {
  test.skip(!HAS_DB, "needs data/app.sqlite");
  for (const id of ["product_nope", "product_00000000000000000000dead", "x"]) {
    const res = await page.goto(`/products/${id}`);
    expect(res?.status(), id).toBe(404);
    await expect(page.getByText("این محصول در کاتالوگ پیدا نشد")).toBeVisible();
    await expect(page.getByRole("link", { name: "جست‌وجوی مدل" })).toBeVisible();
  }
});

test("home offers both launch actions with the agreed copy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "کمکم کن انتخاب کنم" })).toBeVisible();
  await expect(page.getByRole("link", { name: "مدل محصول رو می‌دونم" })).toBeVisible();
  await page.getByRole("link", { name: "مدل محصول رو می‌دونم" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.goto("/");
  await page.getByRole("link", { name: "کمکم کن انتخاب کنم" }).click();
  await expect(page).toHaveURL(/\/discover$/);
});

test("home: all four stages are present and linked", async ({ page }) => {
  await page.goto("/");
  const stages = page.getByRole("list").filter({ hasText: "انتخاب محصول" }).first();
  for (const t of ["انتخاب محصول", "فروشنده‌های نزدیک", "مقایسه‌ی فروشنده‌ها", "پرسش از فروشنده"]) await expect(stages.getByRole("heading", { name: t })).toBeVisible();
});

test("without a database the pages say so honestly (no fake data)", async ({ page }) => {
  test.skip(HAS_DB, "only meaningful when the database is absent");
  await page.goto("/discover?category=x");
  await expect(page.getByText("داده‌ی کاتالوگ در این محیط در دسترس نیست")).toBeVisible();
});

test("mission Q&A: draft + copy never claims delivery and no network call goes to a seller", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const outbound: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["127.0.0.1", "localhost", "image.torob.com"].includes(u.hostname)) outbound.push(r.url());
    if (r.method() !== "GET" && u.pathname !== "/_next/webpack-hmr") outbound.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/missions/new");
  await expect(page.getByText("راه ارتباطی تأییدشده در داده‌ها موجود نیست").first()).toBeVisible();
  await page.getByLabel("نام یا مدل کالا").fill("دوربین DH-HAC-HDW1200CLQP");
  await page.getByRole("button", { name: "کپی متن" }).click();
  await expect(page.getByText(/متن کپی شد/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("DH-HAC-HDW1200CLQP");
  await page.getByLabel("پاسخی که شنیدید یا خواندید").fill("فردا موجود می‌شود");
  await page.getByRole("button", { name: "ثبت پاسخ" }).click();
  await expect(page.getByText("ثبت دستی توسط شما — تأییدنشده")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN_CLAIMS);
  expect(outbound).toEqual([]);
});

test("navigation: aria-current marks the active page (mobile bottom nav)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/discover");
  const nav = page.getByRole("navigation", { name: "ناوبری اصلی (موبایل)" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "راهنما" })).toHaveAttribute("aria-current", "page");
});

test("navigation: desktop shows the top nav and hides the bottom nav", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/compare");
  await expect(page.getByRole("navigation", { name: "ناوبری اصلی", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ناوبری اصلی (موبایل)" })).toBeHidden();
});

test("reduced motion: content is visible immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("home links to the assistant as an addition, not a replacement of the two launch actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "کمکم کن انتخاب کنم" })).toBeVisible();
  await page.getByTestId("home-assistant-link").click();
  await expect(page).toHaveURL(/\/assistant$/);
});
