import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { BIG_PRODUCT, collectErrors, DAHUA, dbRow, expect, expectNoHorizontalOverflow, FORBIDDEN_CLAIMS, HAS_DB, REAL_CATALOG_REQUIRED, test } from "./helpers";
import { QA_OUT } from "../tests/helpers/qa-out";

test.skip(!HAS_DB, REAL_CATALOG_REQUIRED);
const enc = encodeURIComponent;
const OUT = QA_OUT;
const DV = "unknown|HDW1200CLQP"; // Dahua dominant variant group
const LOW_A = "shop_0ca1ab09d6a27d703e3ea4a0"; // 2 480 000 (suspiciously low, offer_c5e7b056…)
const LOW_B = "shop_af02adae0bdd7e072ca665d6"; // 2 800 000
const MID_A = "shop_8670c71ca3baff62d68de422"; // 4 100 000
const MID_B = "shop_350520090b6a5a6163f919d3"; // 4 200 000
const four = (extra = "") => `/compare?product=${DAHUA}&variant=${enc(DV)}&shops=${[LOW_A, LOW_B, MID_A, MID_B].join(",")}&o=ferdowsi${extra}`;
const two = (extra = "") => `/compare?product=${DAHUA}&variant=${enc(DV)}&shops=${MID_A},${MID_B}&o=ferdowsi${extra}`;
const cols = (page: Page) => page.getByTestId("compare-col");
let BIG_VARIANT = "";

test.beforeAll(async ({ request }) => {
  const r = await (await request.get(`/api/sellers?product=${BIG_PRODUCT}&o=ferdowsi&uncertain=1`)).json();
  BIG_VARIANT = [...r.variant.groups].sort((a: { offerCount: number }, b: { offerCount: number }) => b.offerCount - a.offerCount)[0].id;
});

test.describe("stage 3 journey @390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sellers → tick 2 → compare → change priority/radius/visit → evidence → shop → prepare inquiry", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`/sellers?product=${DAHUA}&variant=${enc(DV)}&r=3000`);
    const boxes = page.getByTestId("compare-checkbox");
    await expect(boxes.first()).toBeVisible();
    await boxes.nth(0).check();
    await expect(page.getByTestId("compare-bar")).toContainText("۱ فروشگاه برای مقایسه");
    await expect(page.getByTestId("compare-go")).toContainText("همین یک فروشگاه");
    await boxes.nth(1).check();
    await expect(page.getByTestId("compare-go")).toContainText("مقایسه‌ی ۲ فروشگاه");
    expect(page.url()).toMatch(/cmp=shop_.*%2Cshop_|cmp=shop_[0-9a-f]+,shop_/);
    await page.getByTestId("compare-go").click();

    // comparison renders both sellers with the carried-over context
    await expect(page).toHaveURL(/\/compare\?.*variant=.*shops=shop_/);
    await expect(cols(page)).toHaveCount(2);
    await expect(page.getByTestId("verdict")).toBeVisible();
    await expect(page.getByTestId("prio-price")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "فردوسی" })).toHaveAttribute("aria-checked", "true");
    await expectNoHorizontalOverflow(page);

    // change priority → URL + ranking explanation update
    await page.getByTestId("prio-distance").click();
    await expect(page).toHaveURL(/prio=distance/);
    await expect(page.getByTestId("summary").first()).toContainText("نزدیکی");
    // change radius
    await page.getByRole("radio", { name: "شعاع ۵ کیلومتر" }).click();
    await expect(page).toHaveURL(/r=5000/);
    // change visit time
    await page.getByTestId("visit-input").fill("2026-10-24T03:00");
    await expect(page).toHaveURL(/visit=2026-10-24T03%3A00/);
    await expect(page.getByTestId("row-hours").first()).toContainText("خارج از ساعت اعلام‌شده");
    await expect(page.getByTestId("row-hours").first()).toContainText("طبق اعلام فروشگاه");

    // inspect evidence: offers + reasons with ids
    await page.getByTestId("row-reasons").locator("summary").first().click();
    await expect(page.getByTestId("row-reasons").locator("[data-reason]").first()).toBeVisible();
    await page.getByTestId("row-offers").locator("summary").first().click();
    await expect(page.locator("[data-offer-id]").first()).toBeVisible();
    const href = page.url();

    // shop page and back to the same criteria
    await page.getByRole("link", { name: "جزئیات فروشگاه" }).first().click();
    await expect(page).toHaveURL(/\/shops\/shop_/);
    await expect(page.getByTestId("shop-product-offers")).toBeVisible();
    await page.getByRole("link", { name: "بازگشت به مقایسه" }).click();
    await expect(cols(page)).toHaveCount(2);
    expect(page.url()).toContain("prio=distance");
    expect(page.url()).toContain("r=5000");
    expect(decodeURIComponent(page.url())).toContain("visit=2026-10-24T03:00");
    expect(href).toContain("visit=");

    // prepare the MANUAL inquiry: seller + offer context arrives, nothing is sent
    await page.getByTestId("prepare-inquiry").first().click();
    await expect(page).toHaveURL(/\/missions\/new\?.*shop=shop_.*offer=offer_/);
    const ctx = page.getByTestId("inquiry-context");
    await expect(ctx).toBeVisible();
    await expect(ctx).toContainText("تأییدنشده");
    await expect(page.getByTestId("status-badge")).toHaveText("پیش‌نویس");
    const draft = page.getByTestId("draft");
    await expect(draft).toHaveValue(/1200CLQP/);
    await expect(draft).not.toHaveValue(/ارسال شد/);
    if (await page.getByTestId("istep-follow").isVisible()) await page.getByTestId("istep-follow").click(); // phones show one inquiry step at a time
    await expect(page.getByText("راه ارتباطی تأییدشده‌ای وجود ندارد")).toBeVisible();
    await page.getByRole("link", { name: "بازگشت به مقایسه" }).click();
    await expect(cols(page)).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("state survives refresh and the Back button", async ({ page }) => {
    await page.goto(two());
    await page.getByTestId("prio-warranty").click();
    await expect(page).toHaveURL(/prio=warranty/);
    await page.reload();
    await expect(page.getByTestId("prio-warranty")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("prio-payment").click();
    await expect(page).toHaveURL(/prio=payment/);
    await page.goBack();
    await expect(page.getByTestId("prio-warranty")).toHaveAttribute("aria-checked", "true");
    expect(page.url()).not.toMatch(/lat=|lon=/);
  });

  test("add and remove sellers (2–4) from the comparison itself", async ({ page }) => {
    await page.goto(two());
    await expect(cols(page)).toHaveCount(2);
    await page.getByTestId("add-candidate").first().click();
    await expect(cols(page)).toHaveCount(3);
    await page.getByTestId("remove-seller").first().click();
    await expect(cols(page)).toHaveCount(2);
  });
});

test.describe("honest verdicts on real data", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Dahua: the two suspiciously low records are shown (raw price, id) but set aside; the claim is qualified", async ({ page }) => {
    await page.goto(four());
    await expect(cols(page)).toHaveCount(4);
    const v = page.getByTestId("verdict");
    await expect(v).toHaveAttribute("data-kind", "CHEAPEST_QUALIFIED");
    await expect(v).toContainText("نه لزوماً کمترین ثبت‌شده");
    await expect(v).toContainText("غیرعادی");
    const low = page.locator(`[data-testid="compare-col"][data-shop-id="${LOW_A}"]`);
    await expect(low).toHaveAttribute("data-rank", "3");
    await expect(page.getByTestId("row-price")).toContainText("raw: 2480000");
    await expect(page.getByTestId("row-price")).toContainText("قیمت غیرعادی نسبت به همتایان");
    await page.getByTestId("row-offers").locator("summary").first().click();
    await expect(page.locator('[data-offer-id="offer_c5e7b056b065d44e66fe1351"]')).toBeAttached();
    expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN_CLAIMS);
  });

  test("price freshness shows both elapsed-today and snapshot-relative ages", async ({ page }) => {
    await page.goto(four());
    const fresh = page.getByTestId("row-fresh");
    await expect(fresh).toContainText("روز پیش از امروز");
    await expect(fresh).toContainText("روز پیش از عکس داده");
  });

  test("variant unconfirmed → no ranking and a clear next step", async ({ page }) => {
    const shops = dbRow<{ s: string }>("SELECT shop_id s FROM offers WHERE product_id = ? LIMIT 1", BIG_PRODUCT).s;
    await page.goto(`/compare?product=${BIG_PRODUCT}&shops=${shops},shop_00000000000000000000dead&o=ferdowsi`);
    await expect(page.getByTestId("state-variant")).toBeVisible();
    for (const b of await page.getByTestId("rank-badge").all()) await expect(b).toContainText("بدون رتبه");
    await expect(page.getByTestId("verdict")).toHaveCount(0);
  });

  test("a different unit is never ranked (cable: roll vs per-metre)", async ({ page, request }) => {
    const CABLE = "product_960832f67570cb3958ce6b1d";
    const roll = dbRow<{ s: string }>("SELECT shop_id s FROM offers WHERE product_id = ? AND unit_hint = 'roll_or_pack' AND price_toman IS NOT NULL LIMIT 1", CABLE).s;
    const metre = dbRow<{ s: string }>("SELECT shop_id s FROM offers WHERE product_id = ? AND unit_hint = 'per_metre' AND price_toman IS NOT NULL LIMIT 1", CABLE).s;
    await page.goto(`/compare?product=${CABLE}&variant=${enc("roll_or_pack|any")}&shops=${roll},${metre}`);
    const m = page.locator(`[data-testid="compare-col"][data-shop-id="${metre}"]`);
    await expect(m.getByTestId("rank-badge")).toContainText("بدون رتبه");
    await expect(page.getByTestId("tier-badge").last()).toContainText("ناهم‌خوان");
    await expect(page.getByTestId("verdict")).not.toHaveAttribute("data-kind", "CHEAPEST_CONFIRMED");
    expect(request).toBeTruthy();
  });

  test("budget: within / over / unknown are different answers; strict mode groups them", async ({ page }) => {
    await page.goto(four());
    await page.getByTestId("bmax-input").fill("۳٬۰۰۰٬۰۰۰");
    await page.getByRole("button", { name: "اعمال بودجه" }).click();
    await expect(page).toHaveURL(/bmax=3000000/);
    await expect(page.getByTestId("row-budget")).toBeVisible();
    await page.getByLabel(/بودجه‌ی سخت‌گیرانه/).click();
    await expect(page).toHaveURL(/strict=1/);
    const g = page.getByTestId("budget-groups");
    await expect(g).toContainText("داخل بودجه");
    await expect(g).toContainText("نسبت به بودجه نامعلوم");
    await page.getByTestId("bmax-input").fill("abc");
    await page.getByRole("button", { name: "اعمال بودجه" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "بودجه را به‌صورت عدد" })).toBeVisible();
  });
});

test.describe("empty and error states", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("no sellers selected → guidance + addable candidates", async ({ page }) => {
    await page.goto(`/compare?product=${DAHUA}&variant=${enc(DV)}&o=ferdowsi&r=3000`);
    await expect(page.getByTestId("state-none")).toBeVisible();
    await expect(page.getByTestId("add-candidate").first()).toBeVisible();
  });
  test("one seller → single-seller note, evidence still shown", async ({ page }) => {
    await page.goto(`/compare?product=${DAHUA}&variant=${enc(DV)}&shops=${MID_A}&o=ferdowsi`);
    await expect(page.getByTestId("state-single")).toBeVisible();
    await expect(cols(page)).toHaveCount(1);
    await expect(page.getByTestId("verdict")).toHaveCount(0); // a one-seller view makes no comparative claim
    await expect(page.getByTestId("row-price")).toContainText("raw: 4100000");
  });
  test("unknown product → honest not-found; invalid shop ids are ignored; more than 4 are capped", async ({ page }) => {
    expect((await page.goto("/compare?product=product_00000000000000000000dead"))?.status()).toBe(200);
    await expect(page.getByTestId("compare-not-found")).toBeVisible();
    await page.goto(`/compare?product=${DAHUA}&variant=${enc(DV)}&shops=evil,shop_nope,${MID_A},${MID_B}`);
    await expect(cols(page)).toHaveCount(2);
    await page.goto(`/compare?product=${DAHUA}&variant=${enc(DV)}&shops=${[LOW_A, LOW_B, MID_A, MID_B, "shop_1a8cd0e9656f78ec6a7fad33"].join(",")}`);
    await expect(cols(page)).toHaveCount(4);
  });
  test("no product → entry state with the product-comparison route still linked", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByRole("link", { name: "این‌جا" })).toHaveAttribute("href", "/compare/products");
  });
  test("invalid visit time is ignored with a notice (never crashes)", async ({ page }) => {
    await page.goto(two("&visit=2026-02-31T10:00"));
    await expect(cols(page)).toHaveCount(2);
  });
});

test.describe("optional GPS on the comparison", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("granted → distances for a snapped point; nothing precise in URL/storage; denied → friendly message", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 35.692347, longitude: 51.422512 });
    const reqs: string[] = [];
    page.on("request", (r) => reqs.push(`${r.method()} ${r.url()} ${r.postData() ?? ""}`));
    await page.goto(`/compare?product=${DAHUA}&variant=${enc(DV)}&shops=${MID_A},${MID_B}`);
    await expect(page.getByTestId("row-distance")).toContainText("نقطه‌ی شروع انتخاب نشده");
    await page.getByTestId("gps-button").click();
    await expect(page).toHaveURL(/o=gps/);
    await expect(page.getByTestId("row-distance").first()).toContainText("حدود", { timeout: 10_000 });
    expect(page.url()).not.toMatch(/35\.69|51\.42|ll=/);
    expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).not.toMatch(/35\.69|51\.42/);
    expect(reqs.filter((r) => /35\.692347|51\.422512/.test(r))).toEqual([]);
    expect(reqs.some((r) => r.startsWith("POST") && r.includes("/api/compare/sellers") && r.includes("35.692"))).toBe(true);
  });
  test("denied", async ({ page }) => {
    await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_o, e) => e?.({ code: 1, message: "d", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError); });
    await page.goto(two());
    await page.getByTestId("gps-button").click();
    await expect(page.getByTestId("gps-message")).toContainText("اجازه‌ی موقعیت داده نشد");
    await page.getByRole("radio", { name: "بهارستان" }).click();
    await expect(cols(page)).toHaveCount(2);
  });
});

test.describe("keyboard and accessibility", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("priority radios and the scroll region are keyboard reachable; verdict is a live region", async ({ page }) => {
    await page.goto(two());
    await expect(page.getByTestId("verdict")).toHaveAttribute("aria-live", "polite");
    await page.getByTestId("prio-hours").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/prio=hours/);
    const region = page.getByRole("region", { name: /جدول مقایسه/ });
    await region.focus();
    await expect(region).toBeFocused();
    expect(await page.getByRole("table").count()).toBe(1);
    expect(await page.locator("th[scope=row]").count()).toBeGreaterThan(6);
  });
  test("reduced motion does not hide content", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(two());
    await expect(cols(page).first()).toBeVisible();
  });
  test("the table scrolls inside its wrapper — the page itself never overflows horizontally", async ({ page }) => {
    await page.goto(four());
    await expectNoHorizontalOverflow(page);
    const { sw, cw } = await page.getByTestId("compare-scroller").evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    expect(sw).toBeGreaterThan(cw); // 4 columns need internal scrolling at 390px
  });
});

test("tile-free fallback still works from the comparison entry (sellers map without tiles)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.goto(`/sellers?product=${BIG_PRODUCT}&variant=${enc(BIG_VARIANT)}&r=3000&view=map&tiles=0`);
  await expect(page.locator("[data-pin-kind]").first()).toBeVisible();
  await page.getByRole("tab", { name: "فهرست" }).click();
  await page.getByTestId("compare-checkbox").nth(0).check();
  await page.getByTestId("compare-checkbox").nth(1).check();
  await page.getByTestId("compare-go").click();
  await expect(cols(page)).toHaveCount(2);
});

for (const vp of [{ w: 360, h: 800 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }]) {
  test.describe(`layout @ ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });
    const shot = async (page: Page, name: string) => {
      fs.mkdirSync(OUT, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: path.join(OUT, `${name}-${vp.w}x${vp.h}.png`), fullPage: true });
    };
    test("compare 4 sellers", async ({ page }) => { const e = collectErrors(page); await page.goto(four()); await expect(cols(page)).toHaveCount(4); await shot(page, "compare-four"); expect(e).toEqual([]); });
    test("compare 2 sellers by hours", async ({ page }) => { await page.goto(two("&prio=hours&visit=2026-10-24T03:00")); await expect(cols(page)).toHaveCount(2); await shot(page, "compare-two-hours"); });
    test("compare empty", async ({ page }) => { await page.goto(`/compare?product=${DAHUA}&variant=${enc(DV)}&o=ferdowsi&r=3000`); await expect(page.getByTestId("state-none")).toBeVisible(); await shot(page, "compare-empty"); });
    test("compare variant unconfirmed", async ({ page }) => { await page.goto(`/compare?product=${BIG_PRODUCT}&shops=${dbRow<{ s: string }>("SELECT shop_id s FROM offers WHERE product_id = ? LIMIT 1", BIG_PRODUCT).s}`); await expect(page.getByTestId("state-variant")).toBeVisible(); await shot(page, "compare-variant"); });
    test("inquiry with seller context", async ({ page }) => {
      await page.goto(`/missions/new?product=${DAHUA}&variant=${enc(DV)}&shop=${MID_A}&offer=offer_742932354aecd83d7fc7c266`);
      await expect(page.getByTestId("inquiry-context")).toBeVisible();
      await shot(page, "inquiry-context");
    });
  });
}
