import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, HAS_DB, test } from "./helpers";

/**
 * Automated accessibility audit (axe-core, WCAG 2.0/2.1 A + AA rules incl. colour contrast) of the new assistant in its main states.
 * This is an AUTOMATED check only: it does not replace keyboard/screen-reader testing, which was NOT performed with a screen reader.
 */
const audit = async (page: Page, label: string) => {
  await expect.poll(() => page.title(), { message: "document title is set before axe runs (client navigation can lag a tick)" }).not.toBe("");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${label}: ${v.id} (${v.impact}) ×${v.nodes.length} → ${v.nodes[0]?.target.join(" ")}`), label).toEqual([]);
  return r.violations.length;
};
const send = async (page: Page, text: string) => {
  const n = await page.getByTestId("agent-assistant-msg").count();
  await page.getByTestId("agent-input").fill(text);
  await page.getByTestId("agent-send").click();
  await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(n + 1, { timeout: 30_000 });
};
const latest = (page: Page) => page.locator('[data-testid="agent-assistant-msg"][data-latest="1"]');

for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  test(`axe: assistant states at ${vp.w}×${vp.h} have no serious/critical violations`, async ({ page }) => {
    test.skip(!HAS_DB, "needs data/app.sqlite");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/assistant");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await audit(page, "welcome");
    await send(page, "HDW1200CLQP رو می‌خوام");
    await audit(page, "product-card");
    await latest(page).getByTestId("agent-select-product").click();
    await expect(latest(page).getByTestId("agent-trace")).toContainText("یافتن فروشنده‌ی نزدیک", { timeout: 30_000 });
    await audit(page, "sellers");
    await send(page, "فروشنده‌ها را مقایسه کن");
    await audit(page, "comparison");
    await send(page, "برای فروشنده‌ی اول پیش‌نویس سؤال بنویس");
    await audit(page, "inquiry-draft");
    await send(page, "دوربین مداربسته مدل ZZ9999X رو می‌خوام نزدیک بهارستان");
    await audit(page, "recovery-areas");
  });
}
test("axe: evidence card (fixtures) and the updated home page", async ({ page }) => {
  test.skip(!HAS_DB, "needs data/app.sqlite");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assistant");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await send(page, "HDW1200CLQP رو می‌خوام");
  await latest(page).getByTestId("agent-select-product").click();
  await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(2, { timeout: 30_000 });
  await page.getByTestId("agent-panel-toggle").click();
  const n = await page.getByTestId("agent-assistant-msg").count();
  await page.getByTestId("agent-external").click();
  await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(n + 1, { timeout: 30_000 });
  await send(page, "نظر و مشخصات بیرونی این محصول را بگو");
  await expect(latest(page).getByTestId("agent-evidence")).toHaveAttribute("data-mode", "fixture");
  await audit(page, "evidence");
  await page.emulateMedia({ reducedMotion: "reduce" }); // the home page fades its sections in; a mid-fade frame would blend colours and give a false contrast reading
  await page.goto("/");
  await audit(page, "home");
});

// ---------- Phase 8: missions ----------
const MDAHUA = "product_7308febc43c2f793fd0e1cf9";
const MSTART = `/missions/start?product=${MDAHUA}&variant=${encodeURIComponent("unknown|HDW1200CLQP")}&shop=shop_8670c71ca3baff62d68de422&offer=offer_742932354aecd83d7fc7c266&visit=2026-10-24T11:00&district=ferdowsi&bmax=4500000`;
const mtab = async (page: Page, t: string) => { await page.getByTestId(`tab-${t}-btn`).click(); await expect(page.getByTestId(`tab-${t}`)).toBeVisible({ timeout: 20_000 }); };
for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  test(`axe: mission states at ${vp.w}×${vp.h} have no serious/critical violations`, async ({ page }) => {
    test.skip(!HAS_DB, "needs data/app.sqlite");
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto(MSTART);
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
    await audit(page, "mission-summary");
    await mtab(page, "visit");
    await audit(page, "mission-visit");
    await page.getByTestId("mission-visit-input").fill("2026-10-24T21:00");
    await expect(page.getByTestId("visit-outside")).toBeVisible();
    await audit(page, "mission-visit-outside-hours");
    await mtab(page, "inquiry");
    await expect(page.getByTestId("inquiry-workspace")).toBeVisible({ timeout: 20_000 });
    await audit(page, "mission-inquiry");
    await mtab(page, "recover");
    await page.getByTestId("quick-PRICE_CHANGED").click(); await page.getByTestId("quick-price").fill("4900000"); await page.getByTestId("quick-submit").click();
    await expect(page.getByTestId("budget-scenario")).toBeVisible({ timeout: 20_000 });
    await audit(page, "mission-recovery");
    await mtab(page, "device");
    await audit(page, "mission-device");
    await page.goto("/missions");
    await expect(page.getByTestId("hub-list")).toBeVisible({ timeout: 20_000 });
    await audit(page, "mission-hub");
    await page.goto("/missions/msn_" + "a".repeat(32));
    await expect(page.getByTestId("mission-missing")).toBeVisible();
    await audit(page, "mission-missing");
  });
}
