import { collectErrors, dbRow, expect, expectNoHorizontalOverflow, FORBIDDEN_CLAIMS, HAS_DB, HP, test } from "./helpers";
import type { Page } from "@playwright/test";

test.skip(!HAS_DB, "these journeys need the imported dataset (npm run db:import)");

const CCTV = "دوربین مدار بسته";
const enc = encodeURIComponent;
/** direct children only — reason lists inside a card are <li> too */
const results = (page: Page) => page.locator('ol[aria-label="محصولات پیشنهادی"] > li');

async function answerHeadphones(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "کمکم کن انتخاب کنم" }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await page.getByLabel(/نیازتان را کوتاه بنویسید/).fill("هدفون");
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByRole("heading", { name: /بیشتر برای چه کاری/ })).toBeVisible();
  await expect(page.getByText("گام ۲ از ۴")).toBeVisible();
  await page.getByRole("radio", { name: /ورزش/ }).click();
  await expect(page.getByRole("heading", { name: /اتصال را چطور/ })).toBeVisible();
  await expect(page.getByText("گام ۳ از ۴")).toBeVisible();
  await page.getByRole("radio", { name: /بی‌سیم/ }).click();
  await expect(page.getByRole("heading", { name: /بودجه‌تان چقدر است/ })).toBeVisible();
  await expect(page.getByText("گام ۴ از ۴")).toBeVisible();
  await page.getByRole("group", { name: "بازه‌های پیشنهادی" }).getByRole("button").nth(1).click();
  await expect(results(page).first()).toBeVisible();
}

for (const vp of [{ w: 390, h: 844 }, { w: 360, h: 800 }, { w: 1440, h: 900 }]) {
  test(`UNKNOWN-PRODUCT journey end to end @ ${vp.w}x${vp.h}: need → 3 steps → real results → explanation → compare → detail → seller handoff`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    const errors = collectErrors(page);
    await answerHeadphones(page);

    // real, selectable catalog products with honest price evidence
    const items = results(page);
    expect(await items.count()).toBeGreaterThanOrEqual(5);
    const ids = await items.evaluateAll((els) => els.map((e) => e.querySelector("a[href^='/products/']")?.getAttribute("href") ?? ""));
    for (const href of ids) expect(href).toMatch(/^\/products\/product_[0-9a-f]+/);
    await expect(items.first()).toContainText("قیمت تأییدشده در بودجه");
    expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN_CLAIMS);

    // explanation with quoted evidence
    await items.first().getByText("چرا پیشنهاد شد؟").click();
    await expect(items.first().getByText(/هم‌خوان با انتخاب شما/).first()).toBeVisible();
    await expect(items.first().getByText(/شاهد/).first()).toBeVisible();
    await expect(items.first().getByText(/وجود پیشنهاد به معنی موجودی نیست/)).toBeVisible();

    // compare two products
    await items.nth(0).getByRole("button", { name: /افزودن به مقایسه/ }).click();
    await items.nth(1).getByRole("button", { name: /افزودن به مقایسه/ }).click();
    await page.getByRole("link", { name: "مشاهده‌ی مقایسه" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /مقایسه‌ی محصولات کنار هم/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "ویژگی‌های کلیدی (با شاهد)" })).toBeVisible();
    await expect(page.getByText(/هیچ امتیاز کیفیت یا نظر کاربران در داده نیست/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.goBack();

    // detail → seller handoff
    await items.first().getByRole("link", { name: /مشاهده‌ی جزئیات/ }).click();
    await expect(page).toHaveURL(/\/products\/product_[0-9a-f]+/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "قیمت ثبت‌شده" })).toBeVisible();
    await expect(page.getByText(/نه قیمت امروز و نه تضمین موجودی/)).toBeVisible();
    await expect(page.getByRole("link", { name: /بازگشت به نتایج/ })).toBeVisible();
    await page.getByRole("link", { name: "مشاهده فروشنده‌ها" }).click();
    // Phase 4: the Selection now lands on the nearby-sellers step (matched offers only, stock never confirmed)
    await expect(page).toHaveURL(/\/sellers\?product=product_/);
    await expect(page.getByRole("heading", { level: 1, name: /پیشنهاد ثبت کرده‌اند/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "کجا هستید؟" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test("preferences survive refresh and the Back button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/discover?cat=${enc(HP)}`);
  await page.getByRole("radio", { name: /روزمره/ }).click();
  await expect(page.getByRole("heading", { name: /اتصال را چطور/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /اتصال را چطور/ })).toBeVisible(); // same step after refresh
  await page.getByRole("radio", { name: /با سیم/ }).click();
  await expect(page.getByRole("heading", { name: /بودجه‌تان چقدر است/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: /اتصال را چطور/ })).toBeVisible();
  expect(page.url()).toContain("a.use=general");
  expect(page.url()).not.toMatch(/lat=|lon=/);
});

test("changing the budget updates results without restarting", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/discover?cat=${enc(HP)}&a.connection=wireless&skip=use,budget&show=1`);
  await expect(results(page).first()).toBeVisible();
  const before = await page.getByText(/از .* محصول این دسته/).innerText();
  await page.getByRole("button", { name: "تغییر بودجه" }).click();
  await expect(page.getByRole("heading", { name: /بودجه‌تان چقدر است/ })).toBeVisible();
  await page.getByLabel("تا", { exact: true }).fill("۳٬۰۰۰٬۰۰۰");
  await page.getByRole("button", { name: "اعمال بودجه" }).click();
  await expect(page).toHaveURL(/bmax=3000000/);
  await expect(results(page).first()).toBeVisible();
  const after = await page.getByText(/از .* محصول این دسته/).innerText();
  expect(after).not.toBe(before);
  expect(after).toContain("خارج از بودجه");
  expect(page.url()).toContain("a.connection=wireless"); // the other answer is kept
  await expect(page.getByRole("button", { name: /تغییر پاسخ: .*اتصال/ })).toBeVisible();
});

test("ambiguous need asks which category, then continues with the right questions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/discover?text=${enc("دوربین برای مغازه")}`);
  await expect(page.getByRole("heading", { name: "منظورتان کدام دسته است؟" })).toBeVisible();
  await page.getByRole("button", { name: /دوربین مداربسته/ }).first().click();
  await expect(page.getByRole("heading", { name: /دوربین را کجا نصب می‌کنید/ })).toBeVisible();
});

test("«مطمئن نیستم» skips a question without filtering by it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/discover?cat=${enc(HP)}`);
  await page.getByRole("button", { name: /مطمئن نیستم/ }).click();
  await expect(page).toHaveURL(/skip=use/);
  await expect(page.getByRole("heading", { name: /اتصال را چطور/ })).toBeVisible();
  await page.getByRole("button", { name: /همین حالا نتایج را نشان بده/ }).click();
  await expect(results(page).first()).toBeVisible();
  await expect(page.getByText(/از .* محصول این دسته، .* مورد با شرط‌های شما می‌خواند/)).toBeVisible();
});

test("no verified product in budget → recovery suggestion that actually works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/discover?cat=${enc(CCTV)}&a.environment=outdoor&a.night=yes&bmax=50000&show=1`);
  const raise = page.getByRole("button", { name: /افزایش سقف بودجه/ });
  await expect(raise).toBeVisible();
  await raise.click();
  await expect(page).not.toHaveURL(/bmax=50000/);
  await expect(page.getByText("قیمت تأییدشده در بودجه").first()).toBeVisible();
});

test("KNOWN-PRODUCT journey: exact model → exact_model match → detail with honest price status", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = collectErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "مدل محصول رو می‌دونم" }).click();
  await page.getByRole("combobox").fill("hdw1200clqp");
  await page.getByRole("button", { name: "جست‌وجوی کالا" }).click();
  await expect(page).toHaveURL(/\/search\?q=hdw1200clqp/);
  const first = page.locator("ol > li").filter({ hasText: "تطبیق مدل" }).first();
  await expect(first).toContainText("HDW1200CLQP");
  await expect(first).toContainText("تطبیق مدل");
  await first.getByRole("link", { name: /مشاهده‌ی جزئیات/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("HDW1200CLQP");
  await expect(page.getByText(/قیمت قابل اتکا موجود نیست \(پراکندگی/).first()).toBeVisible(); // 3.9× spread → no single "price"
  await expect(page.getByText(/فقط برای اطلاع \(قابل مقایسه نیست\)/)).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "نسخه‌ی دقیق محصول" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("search: typo correction, stop-word-only input and typeahead", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/search?q=${enc("هدفن بیسیم")}`);
  await expect(page.getByText(/املای «هدفن» اصلاح شد/)).toBeVisible();
  await expect(page.getByRole("list").getByRole("listitem").first()).toBeVisible();

  await page.goto(`/search?q=${enc("و با")}`);
  await expect(page.getByText("عبارت خیلی کلی است. نام کالا، کاربرد یا مدل را بنویسید", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "کمکم کن انتخاب کنم" })).toBeVisible();

  await page.goto("/search");
  const box = page.getByRole("combobox");
  await box.fill("هندزف");
  const listbox = page.getByRole("listbox", { name: "پیشنهادهای جست‌وجو" });
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option").first()).toBeVisible();
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/products\/|\/search\?q=/);
});

test("variant ambiguity: the product page demands a variant and keeps the choice in the URL", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { id } = dbRow<{ id: string }>(`SELECT o.product_id id FROM offers o JOIN quality_flags f ON f.entity_id = o.offer_id AND f.code = 'VARIANT_MODEL_MISMATCH'
     GROUP BY o.product_id HAVING (SELECT count(*) FROM offers x WHERE x.product_id = o.product_id) >= 4 ORDER BY o.product_id LIMIT 1`);
  await page.goto(`/products/${id}`);
  await expect(page.getByRole("alert").filter({ hasText: "لزوماً یک کالای یکسان نیستند" })).toBeVisible();
  const picker = page.getByRole("radiogroup", { name: "نسخه‌ی دقیق محصول" });
  expect(await picker.getByRole("radio").count()).toBeGreaterThanOrEqual(3);
  await picker.getByRole("radio").first().click();
  await expect(page).toHaveURL(/variant=/);
  await expect(page.getByRole("link", { name: "مشاهده فروشنده‌ها" })).toHaveAttribute("href", /variant=/);
  await expect(page.getByText(/کد مدل شبیه ولی متفاوت/).first()).toBeVisible();
});

test("keyboard only: tab to an answer and press Enter", async ({ page }) => {
  await page.goto(`/discover?cat=${enc(HP)}`);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.getAttribute("role") === "radio")) break;
  }
  expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("radio");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /اتصال را چطور/ })).toBeVisible();
});

test("the advisor works with reduced motion and exposes progress semantics", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/discover?cat=${enc(HP)}`);
  const bar = page.getByRole("progressbar", { name: "پیشرفت مشاور" });
  await expect(bar).toHaveAttribute("aria-valuenow", "2");
  await expect(bar).toHaveAttribute("aria-valuemax", "4");
});
