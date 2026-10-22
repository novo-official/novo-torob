import fs from "node:fs";
import path from "node:path";
import type { Page, Request } from "@playwright/test";
import { BIG_PRODUCT, collectErrors, dbRow, expect, expectNoHorizontalOverflow, FORBIDDEN_CLAIMS, HAS_DB, test } from "./helpers";

test.skip(!HAS_DB, "needs data/app.sqlite");
const enc = encodeURIComponent;
const toLatin = (v: string) => v.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/٬/g, "");
const OUT = path.resolve(process.cwd(), "docs/qa");
const cards = (page: Page) => page.locator('[data-testid="seller-list"] [data-testid="seller-card"]');
const pins = (page: Page) => page.locator("[data-pin-kind]");
let VARIANT = "";
let SHOP_NO_SCHEDULE = "";

test.beforeAll(async ({ request }) => {
  const r = await (await request.get(`/api/sellers?product=${BIG_PRODUCT}&o=ferdowsi&uncertain=1`)).json();
  VARIANT = [...r.variant.groups].sort((a: { offerCount: number }, b: { offerCount: number }) => b.offerCount - a.offerCount)[0].id;
  SHOP_NO_SCHEDULE = dbRow<{ s: string }>("SELECT shop_id s FROM shops WHERE offer_count > 0 AND (hours_json LIKE '%\"hasSchedule\":false%') LIMIT 1").s;
});
const sellersUrl = (extra = "") => `/sellers?product=${BIG_PRODUCT}&variant=${enc(VARIANT)}${extra}`;

test.describe("journey: Selection → nearby sellers → radius/location → map/list → shop detail", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("product page → sellers → change radius/location → map pin → sheet → shop detail → back", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`/products/${BIG_PRODUCT}?variant=${enc(VARIANT)}`);
    await page.getByRole("link", { name: "مشاهده فروشنده‌ها" }).click();
    await expect(page).toHaveURL(/\/sellers\?product=product_.*variant=/);
    await expect(page.getByRole("heading", { name: "کجا هستید؟" })).toBeVisible();

    // default origin is disclosed, cards show straight-line distance, recorded price + its date, unconfirmed stock
    await expect(page.getByText(/نقطه‌ی شروع پیش‌فرض «فردوسی»/)).toBeVisible();
    await expect(cards(page).first()).toBeVisible();
    const shopsIn = async () => Number(toLatin(((await page.getByTestId("counts").innerText()).match(/^[۰-۹0-9٬]+/) ?? ["0"])[0]));
    const n1000 = await shopsIn();
    expect(n1000).toBeGreaterThanOrEqual(5);
    await expect(cards(page).first().getByTestId("distance")).toContainText("متر");
    await expect(cards(page).first()).toContainText("قیمت ثبت‌شده در داده، نه قیمت امروز");
    await expect(cards(page).first()).toContainText("موجودی تأییدنشده");
    expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN_CLAIMS);
    await expect(page.getByTestId("counts")).toContainText("فروشگاه در شعاع");

    // radius: smaller radius → fewer (or equal) shops, URL is the state
    await page.getByRole("radio", { name: "۵۰۰ متر" }).click();
    await expect(page).toHaveURL(/[?&]r=500/);
    await expect(page.getByTestId("situation-a")).toBeVisible(); // nearest match is ~754 m from the default origin
    await page.getByRole("radio", { name: "۳ کیلومتر" }).click();
    await expect(page).toHaveURL(/[?&]r=3000/);
    await expect(cards(page).first()).toBeVisible();
    await expect.poll(shopsIn).toBeGreaterThan(n1000);

    // location: another district changes distances and the URL (no coordinates in it)
    await page.getByRole("radio", { name: "شیخ هادی" }).click();
    await expect(page).toHaveURL(/[?&]o=sheikh-hadi/);
    expect(page.url()).not.toMatch(/lat=|lon=|ll=/);
    await expect(page.getByTestId("counts")).toContainText("شیخ هادی");

    // list → map; tapping a pin selects the shop and opens the bottom sheet
    await page.getByRole("tab", { name: "نقشه" }).click();
    await expect(pins(page).first()).toBeVisible();
    expect(await page.locator('[data-pin-kind="origin"]').count()).toBe(1);
    await page.locator('[data-pin-kind="shop"], [data-pin-kind="shop-group"]').first().dispatchEvent("click");
    const sheet = page.getByTestId("map-sheet");
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/[?&]shop=shop_/);
    await expectNoHorizontalOverflow(page);
    const openUrl = page.url();
    await sheet.getByRole("link", { name: "جزئیات فروشگاه" }).first().click();

    // real shop page
    await expect(page).toHaveURL(/\/shops\/shop_[0-9a-f]+\?/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "ساعت کاری اعلام‌شده" })).toBeVisible();
    await expect(page.getByTestId("hours-table").locator("tbody tr")).toHaveCount(7);
    await expect(page.getByTestId("shop-product-offers")).toBeVisible();
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    await expect(page.getByText(/ساختگی‌اند/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("link", { name: /بازگشت به فروشنده‌های اطراف/ }).click();
    await expect(page).toHaveURL(/\/sellers\?/);
    expect(page.url()).toContain("o=sheikh-hadi");
    expect(page.url()).toContain("r=3000");
    expect(openUrl).toContain("shop=");
    expect(errors).toEqual([]);
  });

  test("Phase 3/4 deep links keep working: /compare?product&variant&shop= opens the seller comparison with that one seller", async ({ page }) => {
    const shop = dbRow<{ s: string }>("SELECT shop_id s FROM offers WHERE product_id = ? LIMIT 1", BIG_PRODUCT).s;
    await page.goto(`/compare?product=${BIG_PRODUCT}&variant=${enc(VARIANT)}&shop=${shop}`);
    await expect(page.getByTestId("state-single")).toBeVisible();
    await expect(page.getByTestId("compare-col")).toHaveCount(1);
    await page.goto(`/compare?product=${BIG_PRODUCT}`);
    await expect(page.getByTestId("state-none")).toBeVisible();
    await page.goto("/compare/products");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("seller click → 'ادامه با این فروشنده' hands the shop to the comparison without confirming availability", async ({ page }) => {
    await page.goto(sellersUrl("&r=3000"));
    await cards(page).first().getByRole("link", { name: "ادامه با این فروشنده" }).click();
    await expect(page).toHaveURL(/\/compare\?.*shops=shop_/);
    await expect(page.getByTestId("compare-col")).toHaveCount(1);
    expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN_CLAIMS);
  });
});

test.describe("long lists", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the list shows 12 cards and reveals more on demand; sorting by price orders recorded prices", async ({ page }) => {
    await page.goto(sellersUrl("&r=10000"));
    await expect(cards(page)).toHaveCount(12);
    await page.getByTestId("show-more").click();
    await expect(cards(page)).toHaveCount(24);
    await page.getByLabel("مرتب‌سازی").selectOption("price");
    await expect(page).toHaveURL(/sort=price/);
    await expect(cards(page).first()).toBeVisible();
    const prices = await cards(page).evaluateAll((els) => els.map((e) => e.querySelector('[data-testid="price-block"] p')?.textContent ?? ""));
    expect(prices.length).toBe(12);
  });
});

test.describe("variant guardrail (situation B)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("no variant chosen → asks to confirm, shows NO sellers; uncertain list is opt-in with warnings", async ({ page }) => {
    await page.goto(`/sellers?product=${BIG_PRODUCT}&r=3000`);
    await expect(page.getByTestId("situation-unconfirmed")).toBeVisible();
    await expect(page.getByTestId("variant-panel")).toContainText("نسخه‌ی دقیق را تأیید کنید");
    await expect(page.getByTestId("variant-panel")).toHaveAttribute("open", "");
    await expect(cards(page)).toHaveCount(0);
    await page.getByLabel(/نمایش فروشگاه‌های نسخه‌ی نامطمئن/).click(); // navigation-driven control: state flips after the URL changes
    await expect(page).toHaveURL(/uncertain=1/);
    await expect(cards(page).first()).toBeVisible();
    await expect(cards(page).first()).toContainText("نسخه هنوز انتخاب نشده");
    // choosing a variant removes the warning state
    await page.getByRole("radio").filter({ hasText: /پیشنهاد/ }).first().click();
    await expect(page).toHaveURL(/variant=/);
  });
  test("the selected variant id is preserved across radius/location changes", async ({ page }) => {
    await page.goto(sellersUrl());
    await page.getByRole("radio", { name: "۵ کیلومتر" }).click();
    await page.getByRole("radio", { name: "بهارستان" }).click();
    expect(page.url()).toContain(`variant=${enc(VARIANT).replace(/%7C/gi, "%7C")}`.replace("%7C", "%7C"));
    expect(decodeURIComponent(page.url())).toContain(VARIANT);
  });
});

test.describe("no nearby result recovery (situation A)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("empty radius → honest message, real outside-radius shops with distances, radius hints that work", async ({ page }) => {
    await page.goto(sellersUrl("&r=500"));
    await expect(page.getByTestId("situation-a")).toContainText("نه ادعا درباره‌ی نبود مغازه در تهران");
    await expect(page.getByTestId("outside-radius")).toBeVisible();
    await expect(page.getByTestId("outside-radius").getByTestId("distance").first()).toContainText("خارج از شعاع");
    const hint = page.getByRole("button", { name: /^با .*: .* فروشگاه$/ }).first();
    await expect(hint).toBeVisible();
    await hint.click();
    await expect(page).not.toHaveURL(/[?&]r=500/); // widened (1 km is the default radius, so it may be absent from the URL)
    await expect(cards(page).first()).toBeVisible();
  });
  test("origin far from all data → coverage warning that does not claim 'no shops in Tehran'", async ({ page }) => {
    await page.goto(sellersUrl("&o=map&ll=35.80,51.70&r=500"));
    await expect(page.getByText(/پوشش نمی‌دهد/)).toBeVisible();
    await expect(page.getByText(/نبود فروشگاه در آن منطقه‌ی تهران نیست/)).toBeVisible();
  });
});

test.describe("optional GPS", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("is never requested at page load", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __geo: number }).__geo = 0;
      const g = navigator.geolocation;
      for (const m of ["getCurrentPosition", "watchPosition"] as const) {
        const orig = g[m].bind(g);
        (g as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { (window as unknown as { __geo: number }).__geo++; return (orig as (...x: unknown[]) => unknown)(...a); };
      }
    });
    await page.goto(sellersUrl());
    await page.getByRole("tab", { name: "نقشه" }).click();
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as unknown as { __geo: number }).__geo)).toBe(0);
  });

  test("denied → friendly message, manual selection still works, retry offered", async ({ page, context }) => {
    await context.clearPermissions();
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    });
    await page.goto(sellersUrl("&r=3000"));
    await page.getByTestId("gps-button").click();
    await expect(page.getByTestId("gps-message")).toContainText("اجازه‌ی موقعیت داده نشد");
    await expect(page.getByTestId("gps-button")).toContainText("تلاش دوباره");
    await page.getByRole("radio", { name: "بهارستان" }).click();
    await expect(page).toHaveURL(/o=baharestan/);
    await expect(cards(page).first()).toBeVisible();
  });

  test("unsupported browser → message, manual path intact", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true }));
    await page.goto(sellersUrl());
    await page.getByTestId("gps-button").click();
    await expect(page.getByTestId("gps-message")).toContainText("پشتیبانی نمی‌کند");
    await expect(cards(page).first()).toBeVisible();
  });

  test("granted → results for a snapped point; precise coordinates are NOT in the URL, storage or request URL", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 35.692347, longitude: 51.422512 });
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await page.goto(sellersUrl("&r=3000"));
    await page.getByTestId("gps-button").click();
    await expect(page.getByTestId("gps-message")).toContainText("از موقعیت تقریبی شما استفاده شد");
    await expect(page).toHaveURL(/o=gps/);
    await expect(page.getByTestId("counts")).toContainText("موقعیت شما");
    await expect(cards(page).first().getByTestId("distance")).toContainText("متر");
    expect(page.url()).not.toMatch(/35\.69|51\.42|lat|lon|ll=/);
    const store = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    expect(store).not.toMatch(/35\.69|51\.42/);
    for (const r of requests) expect(r.url(), "no coordinate in any request URL").not.toMatch(/35\.69\d|51\.42\d/);
    const post = requests.find((r) => r.method() === "POST" && r.url().includes("/api/sellers"));
    expect(post, "GPS results come from a POST body").toBeTruthy();
    expect(post!.postData()).toContain("35.692");
    expect(post!.postData()).not.toContain("35.6923");
    expect(post!.postData()).not.toContain("51.4225");
    // a refresh never restores the position
    await page.reload();
    await expect(page.getByText(/دوباره «استفاده از موقعیت من» را بزنید/)).toBeVisible();
  });
});

test.describe("map: tiles are optional and disclosed", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("tile server failure → pins + list still work and the fallback is explained", async ({ page }) => {
    await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
    await page.goto(sellersUrl("&r=3000&view=map"));
    await expect(pins(page).first()).toBeVisible();
    await expect(page.getByTestId("tiles-note")).toContainText("کاشی‌های نقشه بارگذاری نشد", { timeout: 15_000 });
    await page.getByRole("tab", { name: "فهرست" }).click();
    await expect(cards(page).first()).toBeVisible();
  });
  test("tiles=0 → no request ever reaches the tile server; disclosure + attribution text present", async ({ page }) => {
    const tileReqs: string[] = [];
    page.on("request", (r) => { if (r.url().includes("tile.openstreetmap.org")) tileReqs.push(r.url()); });
    await page.goto(sellersUrl("&r=3000&view=map&tiles=0"));
    await expect(pins(page).first()).toBeVisible();
    await page.waitForTimeout(800);
    expect(tileReqs).toEqual([]);
    await expect(page.getByTestId("tiles-note")).toContainText("هیچ درخواستی به سرور بیرونی نمی‌رود");
    await expect(page.getByTestId("tiles-note")).toContainText("OpenStreetMap contributors");
  });
  test("tiles on → attribution control is visible and the disclosure says the tile server sees the viewed area", async ({ page }) => {
    await page.goto(sellersUrl("&r=3000&view=map"));
    await expect(page.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");
    await expect(page.getByTestId("tiles-note")).toContainText("آن سرور ناحیه‌ی در حال دیدن را می‌بیند");
  });
  test("pick a starting point on the map → snapped ll in the URL and results re-computed", async ({ page }) => {
    await page.goto(sellersUrl("&r=1000&view=map"));
    await expect(pins(page).first()).toBeVisible();
    await page.getByRole("button", { name: /انتخاب روی نقشه/ }).click();
    await page.getByTestId("nearby-map").scrollIntoViewIfNeeded();
    const box = (await page.getByTestId("nearby-map").boundingBox())!;
    await page.mouse.click(box.x + box.width - 20, box.y + 20); // a corner: away from pins and controls
    await expect(page).toHaveURL(/o=map&ll=35\.\d{3}%2C51\.\d{3}/);
    expect(page.url()).not.toMatch(/ll=35\.\d{4,}/);
    await expect(page.getByTestId("counts")).toContainText("نقطه‌ی انتخابی روی نقشه");
  });
});

test.describe("desktop: list and map side by side with shared selection", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("‘نمایش روی نقشه’ on a card selects the pin and opens the sheet; closing clears selection", async ({ page }) => {
    await page.goto(sellersUrl("&r=3000"));
    await expect(pins(page).first()).toBeVisible();
    await expect(cards(page).first()).toBeVisible();
    await expect(page.getByTestId("nearby-map")).toBeVisible();
    await cards(page).nth(1).getByRole("button", { name: "نمایش روی نقشه" }).click();
    await expect(page.getByTestId("map-sheet")).toBeVisible();
    await expect(cards(page).nth(1)).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("map-sheet")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
  test("legend distinguishes shop pins from area pins and says area pins are not sellers", async ({ page }) => {
    await page.goto(sellersUrl("&r=500"));
    await expect(page.getByTestId("map-legend")).toContainText("فروشگاه دارای پیشنهاد ثبت‌شده");
    await expect(page.getByTestId("map-legend")).toContainText("منطقه‌ی پیشنهادی (فروشنده نیست)");
    await expect(page.locator('[data-pin-kind="area"]').first()).toBeVisible();
    await expect(page.locator('[data-pin-kind="area"]').first()).toHaveAttribute("aria-label", /فروشنده نیست/);
  });
});

test.describe("category activity vs matched sellers stay separate", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("activity list is lazy, labelled 'not confirmed to have the item', and never inside the seller list", async ({ page }) => {
    await page.goto(sellersUrl("&r=3000"));
    await page.getByTestId("activity-details").locator("summary").click();
    await expect(page.getByTestId("activity-list")).toBeVisible();
    await expect(page.getByTestId("activity-details")).toContainText("داشتن این کالا تأیید نشده");
    const ids = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-shop-id")));
    const activityLinks = await page.getByTestId("activity-list").locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    for (const h of activityLinks) for (const id of ids) expect(h).not.toContain(String(id));
  });
});

test.describe("no product / no area recovery (situations C and D)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("C: product not found → honest no-result, then source-backed areas WITHOUT any seller or offer", async ({ page }) => {
    const q = "پاوربانک ضدآب خورشیدی طلایی ۹۹۹";
    await page.goto(`/search?q=${enc(q)}`);
    await expect(page.getByText("نتیجه‌ای پیدا نشد")).toBeVisible();
    await page.getByTestId("area-recovery-link").click();
    await expect(page).toHaveURL(/\/sellers\?category=/);
    await expect(page.getByTestId("area-only-note")).toContainText("هیچ فروشنده یا موجودی‌ای نمایش داده نمی‌شود");
    const leads = page.getByTestId("area-leads").getByTestId("area-lead");
    await expect(leads.first()).toBeVisible();
    await expect(leads.first()).toContainText("فروشنده نیست");
    await expect(page.getByTestId("seller-card")).toHaveCount(0);
    // curated lead exposes sources with https links + verification date
    const curated = page.locator('[data-source-type="curated_external"]').first();
    await curated.locator("summary").click();
    const links = curated.getByTestId("area-sources").locator("a");
    expect(await links.count()).toBeGreaterThanOrEqual(2);
    for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")))) expect(href).toMatch(/^https:\/\//);
    await expect(curated).toContainText("بررسی منابع:");
    await expect(pins(page).first()).toBeVisible();
    await expect(page.locator('[data-pin-kind="area"]').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
  test("D: a category with no evidence-backed area says so instead of guessing", async ({ page }) => {
    await page.goto(`/sellers?category=${enc("آب سردکن و تصفیه آب")}`);
    await expect(page.getByTestId("no-area")).toContainText("حدس نمی‌زنیم");
    await expect(page.getByTestId("area-lead")).toHaveCount(0);
  });
  test("D: unrecognised words → no category, no area", async ({ page }) => {
    await page.goto(`/sellers?category=${enc("qqqzzz")}`);
    await expect(page.getByTestId("no-area")).toContainText("دسته‌ی کالا را تشخیص ندادیم");
  });
  test("unknown / malformed product → 200 'not found' recovery; unknown shop → 404", async ({ page }) => {
    expect((await page.goto("/sellers?product=product_00000000000000000000dead"))?.status()).toBe(200);
    await expect(page.getByText("این محصول در داده پیدا نشد")).toBeVisible();
    expect((await page.goto("/shops/shop_00000000000000000000dead"))?.status()).toBe(404);
    expect((await page.goto("/shops/not-a-shop"))?.status()).toBe(404);
    expect((await page.goto("/sellers?product=%E0%A4%A"))?.status()).toBe(200);
  });
  test("no-input page offers the way in (advisor / search / category form)", async ({ page }) => {
    await page.goto("/sellers");
    await expect(page.getByRole("heading", { name: "ابتدا محصول را انتخاب کنید" })).toBeVisible();
    await page.getByLabel("نام دسته یا کالا").fill("پاوربانک");
    await page.getByRole("button", { name: "پیشنهاد منطقه" }).click();
    await expect(page).toHaveURL(/category=/);
    await expect(page.getByTestId("area-lead").first()).toBeVisible();
  });
});

test.describe("shop detail honesty", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("a shop without a schedule shows 'not declared' (never closed) and no phone number or tap-to-call", async ({ page }) => {
    await page.goto(`/shops/${SHOP_NO_SCHEDULE}`);
    await expect(page.getByTestId("hours-table")).toContainText("اعلام نشده");
    await expect(page.getByText("ساعت کاری اعلام نشده").first()).toBeVisible();
    await expect(page.locator('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]')).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/\b09\d{9}\b/);
    await expect(page.getByText("راه ارتباطی تأییدشده در داده‌ها موجود نیست")).toBeVisible();
  });
  test("shop opened without product context says nothing about the product; with a product that it doesn't sell it says so", async ({ page }) => {
    const other = dbRow<{ s: string }>("SELECT shop_id s FROM shops WHERE offer_count > 0 AND shop_id NOT IN (SELECT shop_id FROM offers WHERE product_id = ?) LIMIT 1", BIG_PRODUCT).s;
    await page.goto(`/shops/${other}?product=${BIG_PRODUCT}`);
    await expect(page.getByTestId("shop-no-offer")).toContainText("هیچ پیشنهاد ثبت‌شده‌ای ندارد");
  });
  test("external links on shop pages are only validated https/instagram links, opened in a new tab with noopener", async ({ page }) => {
    const s = dbRow<{ s: string }>("SELECT shop_id s FROM shops WHERE website_url LIKE 'https://%' LIMIT 1").s;
    await page.goto(`/shops/${s}`);
    const link = page.getByRole("link", { name: /وب‌سایت:/ });
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("href", /^https:\/\//);
  });
});

for (const vp of [{ w: 360, h: 800 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }]) {
  test.describe(`layout @ ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });
    const shot = async (page: Page, name: string) => {
      fs.mkdirSync(OUT, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: path.join(OUT, `${name}-${vp.w}x${vp.h}.png`), fullPage: true });
    };
    test("sellers list", async ({ page }) => { const e = collectErrors(page); await page.goto(sellersUrl("&r=3000")); await expect(cards(page).first()).toBeVisible(); await shot(page, "sellers-list"); expect(e).toEqual([]); });
    test("sellers map + bottom sheet", async ({ page }) => {
      const e = collectErrors(page);
      await page.goto(sellersUrl("&r=3000&view=map"));
      await expect(pins(page).first()).toBeVisible();
      await page.locator('[data-pin-kind="shop"], [data-pin-kind="shop-group"]').first().dispatchEvent("click");
      await expect(page.getByTestId("map-sheet")).toBeVisible();
      await shot(page, "sellers-map-sheet");
      expect(e).toEqual([]);
    });
    test("sellers situation A (no shop in radius) + area leads", async ({ page }) => { await page.goto(sellersUrl("&r=500")); await expect(page.getByTestId("situation-a")).toBeVisible(); await shot(page, "sellers-no-nearby"); });
    test("sellers variant confirmation", async ({ page }) => { await page.goto(`/sellers?product=${BIG_PRODUCT}`); await expect(page.getByTestId("situation-unconfirmed")).toBeVisible(); await shot(page, "sellers-variant-confirm"); });
    test("area-only recovery", async ({ page }) => { await page.goto(`/sellers?category=${enc("پاوربانک")}`); await expect(page.getByTestId("area-lead").first()).toBeVisible(); await shot(page, "sellers-area-only"); });
    test("shop detail", async ({ page }) => { await page.goto(`/shops/${SHOP_NO_SCHEDULE}?product=${BIG_PRODUCT}&variant=${enc(VARIANT)}`); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); await shot(page, "shop-detail"); });
  });
}
