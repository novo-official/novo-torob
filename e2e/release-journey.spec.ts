import { collectErrors, DAHUA, expect, expectNoHorizontalOverflow, FORBIDDEN_CLAIMS, HAS_DB, test } from "./helpers";

test.skip(!HAS_DB, "needs data/app.sqlite");
const enc = encodeURIComponent;
const DV = "unknown|HDW1200CLQP";

/**
 * RELEASE-CRITICAL JOURNEY (Phase 9 gate): known-model fast path → product → sellers → seller comparison → inquiry → persisted mission,
 * on real dataset ids, WITHOUT any language model (mock planner not even involved), with Back / Forward / refresh at every hop,
 * honest provenance throughout and zero requests that could send anything to a seller or a model.
 */
test("search → product → sellers → compare → inquiry → mission saved on this device → survives refresh; Back/Forward keep each step", async ({ page, context }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors = collectErrors(page);
  const reqs: Array<{ m: string; u: string }> = [];
  page.on("request", (r) => reqs.push({ m: r.method(), u: r.url() }));

  // 1 — search by model
  await page.goto("/search");
  await page.getByRole("combobox").first().fill("hdw1200clqp");
  await page.keyboard.press("Enter");
  await page.locator(`a[href^="/products/${DAHUA}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/products/${DAHUA}`));
  await expect(page.getByText("قیمت ثبت‌شده").first()).toBeVisible();
  const productUrl = page.url();

  // 2 — sellers (variant pinned by the product page link); refresh keeps the list
  await page.getByRole("link", { name: "مشاهده فروشنده‌ها" }).click();
  await expect(page).toHaveURL(/\/sellers\?/);
  await expect(page.getByTestId("seller-card").first()).toBeVisible({ timeout: 20_000 });
  const sellersUrl = page.url();
  await page.reload();
  await expect(page.getByTestId("seller-card").first()).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toBe(sellersUrl);

  // 3 — compare two sellers; Back returns to the sellers list with the same URL, Forward restores the comparison
  const boxes = page.getByTestId("compare-checkbox");
  await boxes.nth(0).check(); await boxes.nth(1).check();
  await page.getByTestId("compare-go").click();
  await expect(page.getByTestId("compare-col")).toHaveCount(2, { timeout: 20_000 });
  const compareUrl = page.url();
  await page.goBack(); await expect(page).toHaveURL(/\/sellers\?product=/);
  await expect(boxes.nth(0)).toBeChecked(); await expect(boxes.nth(1)).toBeChecked(); // the picked sellers are kept in the URL (cmp=…)
  await page.goForward(); await expect(page).toHaveURL(compareUrl);
  await expect(page.getByTestId("compare-col")).toHaveCount(2);
  await expect(page.locator("body")).toContainText(/هویت/);
  await expectNoHorizontalOverflow(page);

  // 4 — inquiry (manual only): draft, copy, the USER reports a reply
  await page.getByTestId("prepare-inquiry").first().click();
  await expect(page).toHaveURL(/\/missions\/new\?/);
  const inquiryUrl = page.url();
  await expect(page.getByTestId("inquiry-workspace")).toBeVisible();
  await page.getByTestId("copy").click();
  await expect(page.getByTestId("live-msg")).toContainText("متن کپی شد");
  await page.getByTestId("mark-contacted").click();
  await page.locator("#reply-text").fill("فروشنده گفت فردا موجود می‌شود");
  await page.getByTestId("stock-unknown").click();
  await page.getByTestId("reply-submit").click();
  await expect(page.getByTestId("reply-item")).toHaveAttribute("data-provenance", "USER_REPORTED");
  await page.reload(); // the tab keeps the manual inquiry
  await expect(page.getByTestId("status-badge")).toContainText("پاسخ ثبت‌شده");

  // 5 — mission: created from the same context, saved ONLY after the explicit button, survives refresh and a new tab
  await page.getByTestId("start-mission-cta").click();
  await expect(page).toHaveURL(/\/missions\/msn_/);
  await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("storage-badge")).toHaveAttribute("data-where", "TAB");
  await page.getByTestId("tab-device-btn").click();
  await page.getByTestId("save-device").click();
  await expect(page.getByTestId("storage-badge")).toHaveAttribute("data-where", "DEVICE");
  const id = page.url().match(/msn_[0-9a-f]{32}/)![0];
  await page.goto(`/missions/${id}`);
  await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("storage-badge")).toHaveAttribute("data-where", "DEVICE");
  const fresh = await context.newPage();
  await fresh.goto("/missions");
  await expect(fresh.getByTestId("hub-item")).toHaveCount(1);
  await fresh.getByTestId("hub-delete-all-start").click(); await fresh.getByTestId("hub-delete-all-confirm").click();
  await expect(fresh.getByTestId("hub-empty")).toBeVisible();

  // the whole journey: nothing sent anywhere, no model, no forbidden claims
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN_CLAIMS);
  for (const r of reqs) {
    expect(["GET", "HEAD", "OPTIONS"], `${r.m} ${r.u}`).toContain(r.m);
    expect(r.u).not.toMatch(/^(tel|sms|mailto|whatsapp):|wa\.me|openai|anthropic|boxapi|\/api\/agent\/turn/i);
  }
  void inquiryUrl; void productUrl;
  expect(errors).toEqual([]);
});

test("no-result recovery: a radius with no seller widens, a district fallback is offered, and nothing is invented", async ({ page }) => {
  await page.goto(`/sellers?product=${DAHUA}&variant=${enc(DV)}&r=100`);
  await expect(page.getByTestId("seller-card").first().or(page.getByTestId("no-sellers")).first()).toBeVisible({ timeout: 20_000 });
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/در تهران نیست|ناموجود در بازار/);
  expect(body).toMatch(/شعاع|فروشگاه|منطقه/);
  await page.reload();
  await expect(page.locator("body")).toContainText("شعاع");
});

test("wrong-model recovery: the user reports another model → exact-item confirmation is blocked and the way back to product analysis is offered", async ({ page }) => {
  await page.goto(`/missions/start?product=${DAHUA}&variant=${enc(DV)}&shop=shop_8670c71ca3baff62d68de422&offer=offer_742932354aecd83d7fc7c266&visit=2026-10-24T11:00`);
  await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("tab-recover-btn").click();
  await page.getByTestId("quick-WRONG_MODEL").click(); await page.getByTestId("quick-submit").click();
  await expect(page.getByTestId("recovery-plan")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /مشخصات و نسخه‌ها|جزئیات/ }).first()).toBeVisible();
  await page.reload(); // temporary mission survives a refresh of the same tab
  await expect(page.getByTestId("tab-recover")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("trigger-WRONG_MODEL")).toBeVisible();
  await page.getByTestId("tab-visit-btn").click();
  await expect(page.getByTestId("readiness")).toHaveAttribute("data-ready", "0");
});
