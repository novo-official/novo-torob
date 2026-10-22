import fs from "node:fs";
import path from "node:path";
import type { Page, Request } from "@playwright/test";
import { collectErrors, DAHUA, dbRow, expect, expectNoHorizontalOverflow, FORBIDDEN_CLAIMS, HAS_DB, test } from "./helpers";

test.skip(!HAS_DB, "needs data/app.sqlite");
const enc = encodeURIComponent;
const DV = "unknown|HDW1200CLQP";
const SHOP_A = "shop_8670c71ca3baff62d68de422";
const OFFER_A = "offer_742932354aecd83d7fc7c266";

/**
 * GATE F — full MOCK-MODE rehearsal of docs/demo-script.md, scene by scene, on real dataset ids at a phone viewport.
 * Nothing here talks to a model or a seller; the run records per-scene wall time (machine-specific: informational only) and fails if
 * any non-GET request other than the three read-only POST endpoints is made, or any host outside the app/tiles/product photos is contacted.
 */
test("demo rehearsal (mock only): the five-minute script runs end to end on the real UI with every label in place", async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors = collectErrors(page);
  const reqs: Request[] = [];
  page.on("request", (r) => reqs.push(r));
  const scenes: Array<{ scene: string; ms: number }> = [];
  const t0 = Date.now(); let last = t0;
  const done = (scene: string) => { const n = Date.now(); scenes.push({ scene, ms: n - last }); last = n; };
  const noClaims = async (p: Page) => expect(await p.locator("main").innerText()).not.toMatch(FORBIDDEN_CLAIMS);

  // 0:00 — problem statement & standing disclaimer
  await page.goto("/");
  await expect(page.getByRole("note").filter({ hasText: "هیچ پیامی به فروشنده ارسال نمی‌شود" })).toBeVisible();
  done("00 home + standing disclaimer");

  // 0:25 — stage 1, known model
  await page.goto("/search");
  await page.getByRole("combobox").first().fill("hdw1200clqp");
  await page.keyboard.press("Enter");
  await page.locator(`a[href^="/products/${DAHUA}"]`).first().click();
  await expect(page.getByText("قیمت ثبت‌شده").first()).toBeVisible();
  await expect(page.getByText(/نه قیمت امروز و نه تضمین موجودی/)).toBeVisible();
  done("01 known model → product (recorded price, not today's)");

  // 1:00 — stage 1, ambiguous need: 3 questions → real catalog cards with reasons and evidence
  await page.goto("/discover");
  await page.getByLabel(/نیازتان را کوتاه بنویسید/).fill("هدفون");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("radio", { name: /ورزش/ }).click();
  await page.getByRole("radio", { name: /بی‌سیم/ }).click();
  await page.getByRole("group", { name: "بازه‌های پیشنهادی" }).getByRole("button").nth(1).click();
  const cards = page.locator('ol[aria-label="محصولات پیشنهادی"] > li');
  await expect(cards.first()).toBeVisible();
  await cards.first().getByText("چرا پیشنهاد شد؟").click();
  await expect(cards.first().getByText(/وجود پیشنهاد به معنی موجودی نیست/)).toBeVisible();
  await noClaims(page);
  done("02 need → 3 questions → catalog cards + evidence");

  // ambiguous variant: the page refuses to merge uncertain variants
  const { id: ambiguous } = dbRow<{ id: string }>(`SELECT o.product_id id FROM offers o JOIN quality_flags f ON f.entity_id = o.offer_id AND f.code = 'VARIANT_MODEL_MISMATCH'
     GROUP BY o.product_id HAVING (SELECT count(*) FROM offers x WHERE x.product_id = o.product_id) >= 4 ORDER BY o.product_id LIMIT 1`);
  await page.goto(`/products/${ambiguous}`);
  await expect(page.getByRole("alert").filter({ hasText: "لزوماً یک کالای یکسان نیستند" })).toBeVisible();
  await page.getByRole("radiogroup", { name: "نسخه‌ی دقیق محصول" }).getByRole("radio").first().click();
  await expect(page).toHaveURL(/variant=/);
  done("03 ambiguous variant → explicit choice required (identity not auto-confirmed)");

  // 1:30 — stage 2 sellers, map/list
  await page.goto(`/sellers?product=${DAHUA}&variant=${enc(DV)}&o=ferdowsi&r=3000`);
  await expect(page.getByTestId("seller-card").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("nearby-map").first()).toBeAttached();
  await expectNoHorizontalOverflow(page);
  done("04 sellers: list + map (default origin, labelled)");

  // 2:10 — stage 3 compare
  const boxes = page.getByTestId("compare-checkbox");
  await boxes.nth(0).check(); await boxes.nth(1).check();
  await page.getByTestId("compare-go").click();
  await expect(page.getByTestId("compare-col")).toHaveCount(2, { timeout: 20_000 });
  const cmp = await page.locator("main").innerText();
  expect(cmp).toMatch(/هویت/); expect(cmp).toMatch(/ساعت/); expect(cmp).toMatch(/فاصله/);
  await noClaims(page);
  done("05 compare 2 sellers (price/identity/hours/distance)");

  // 2:50 — stage 4 manual inquiry
  await page.getByTestId("prepare-inquiry").first().click();
  await expect(page.getByTestId("inquiry-workspace")).toBeVisible();
  await page.getByTestId("copy").click();
  await expect(page.getByTestId("live-msg")).toContainText("متن کپی شد");
  await page.getByTestId("mark-contacted").click();
  await page.locator("#reply-text").fill("فروشنده گفت قیمت ۲٬۶۰۰٬۰۰۰ است");
  await page.getByTestId("stock-unknown").click();
  await page.getByTestId("reply-submit").click();
  await expect(page.getByTestId("reply-item")).toHaveAttribute("data-provenance", "USER_REPORTED");
  await expect(page.getByTestId("reply-item")).toContainText("هنوز مستقلاً تأیید نشده");
  done("06 manual inquiry: copy → user-reported reply (unverified)");

  // 3:40 — clearly-labelled simulation, then everything disappears
  await page.goto(`/missions/new?product=${DAHUA}&variant=${enc(DV)}&shop=${SHOP_A}&offer=${OFFER_A}`);
  const follow = page.getByTestId("istep-follow"); if (await follow.isVisible()) await follow.click();
  await page.getByTestId("demo-consent").check();
  await page.getByTestId("mode-demo").click();
  await expect(page.getByTestId("demo-banner")).toContainText("حالت شبیه‌سازی — فقط دمو");
  const reply = page.getByTestId("istep-reply"); if (await reply.isVisible()) await reply.click();
  await page.getByTestId("scenario-NOT_AVAILABLE").click();
  await page.getByTestId("demo-run").click();
  await expect(page.getByTestId("demo-message")).toHaveCount(2);
  for (const m of await page.getByTestId("demo-message").all()) { await expect(m).toHaveAttribute("data-provenance", "DEMO_SIMULATED"); await expect(m.getByTestId("demo-tag")).toContainText("واقعی نیست"); }
  const outcome = page.getByTestId("istep-outcome"); if (await outcome.isVisible()) await outcome.click();
  await expect(page.getByTestId("decision-panel")).toHaveAttribute("data-mode", "DEMO");
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toMatch(/DEMO|NOT_AVAILABLE/i);
  done("07 DEMO simulation: every message tagged, nothing persisted");

  // 4:10 — mission, visit plan, price-change recovery
  await page.goto(`/missions/start?product=${DAHUA}&variant=${enc(DV)}&shop=${SHOP_A}&offer=${OFFER_A}&visit=2026-10-24T11:00&district=ferdowsi&bmax=4500000`);
  await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("storage-badge")).toHaveAttribute("data-where", "TAB");
  await page.getByTestId("tab-visit-btn").click();
  await page.getByTestId("mission-visit-input").fill("2026-10-24T21:00");
  await expect(page.getByTestId("visit-outside")).toBeVisible();
  await page.getByTestId("tab-recover-btn").click();
  await page.getByTestId("quick-PRICE_CHANGED").click(); await page.getByTestId("quick-price").fill("4900000"); await page.getByTestId("quick-submit").click();
  await expect(page.getByTestId("budget-scenario")).toBeVisible({ timeout: 20_000 });
  done("08 mission: visit-hours check + reported price change recovery");

  // 4:25 — no-results recovery with sourced shopping areas (mock assistant, labelled as NOT a language model)
  await page.goto("/assistant");
  await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await expect(page.getByTestId("agent-provider")).toHaveAttribute("data-provider", "mock");
  await expect(page.getByTestId("agent-provider")).toContainText("هیچ مدل زبانی‌ای در کار نیست");
  await page.getByTestId("agent-input").fill("دوربین مداربسته مدل ZZ9999X رو می‌خوام نزدیک بهارستان");
  await page.getByTestId("agent-send").click();
  const latest = page.locator('[data-testid="agent-assistant-msg"][data-latest="1"]');
  await expect(latest.getByTestId("agent-area").first()).toBeVisible({ timeout: 30_000 });
  await expect(latest.getByTestId("agent-area").first()).toContainText("فروشنده نیست");
  await expect(latest.getByTestId("agent-area").first()).toContainText("اطمینان");
  await expect(latest.getByTestId("agent-seller")).toHaveCount(0);
  await noClaims(page);
  done("09 no result → honest coverage + sourced areas, no seller invented");

  // whole run: no sends, no foreign hosts, no errors
  for (const r of reqs) {
    const u = r.url();
    if (r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS") expect(u, `${r.method()} ${u}`).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/(sellers|compare\/sellers|agent\/turn)$/);
    expect(u).toMatch(/^(http:\/\/127\.0\.0\.1|data:|blob:|https:\/\/tile\.openstreetmap\.org\/|https:\/\/image\.torob\.com\/)/);
    expect(u).not.toMatch(/^(tel|sms|mailto|whatsapp):|wa\.me|openai|anthropic|boxapi/i);
  }
  expect(errors).toEqual([]);
  const total = Date.now() - t0;
  const out = path.resolve("docs/qa/demo-rehearsal.json");
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), mode: "mock only; UI-driven steps without narration or pauses; machine-specific", viewport: "390x844", scenes, totalMs: total, nonGetRequests: reqs.filter((r) => r.method() !== "GET").map((r) => `${r.method()} ${new URL(r.url()).pathname}`) }, null, 2));
});
