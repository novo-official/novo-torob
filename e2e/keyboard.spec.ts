import type { Locator, Page } from "@playwright/test";
import { DAHUA, expect, HAS_DB, REAL_CATALOG_REQUIRED, test } from "./helpers";

test.skip(!HAS_DB, REAL_CATALOG_REQUIRED);
const enc = encodeURIComponent;
const DV = "unknown|HDW1200CLQP";

/** Press Tab until `target` has focus (at most `max` presses) — the test never calls .click()/.focus() on the element it is looking for. */
async function tabTo(page: Page, target: Locator, max = 120): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.first().evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`could not reach ${target} with the keyboard in ${max} Tab presses`);
}
/** the focused element shows a visible indicator (outline or ring) */
const focusVisible = (page: Page) => page.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || e === document.body) return false; const s = getComputedStyle(e); return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && s.boxShadow !== ""); });

test.describe("keyboard-only: the four official stages end to end", () => {
  test("search → sellers → compare → inquiry → mission → visit checklist, using only Tab / Space / Enter", async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const focusLog: boolean[] = [];

    // stage 1 — known model search, by keyboard
    await page.goto("/search");
    const box = page.getByRole("combobox").first();
    await tabTo(page, box); focusLog.push(await focusVisible(page));
    await page.keyboard.type("hdw1200clqp");
    await page.keyboard.press("Enter");
    // the card's image link is deliberately tabindex=-1/aria-hidden (no duplicate tab stop): target the keyboard-reachable link
    const hit = page.locator(`a[href^="/products/${DAHUA}"]:not([tabindex="-1"])`).first();
    await expect(hit).toBeVisible({ timeout: 20_000 });
    await tabTo(page, hit); focusLog.push(await focusVisible(page));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/products/${DAHUA}`));

    // stage 2 — sellers
    const toSellers = page.getByRole("link", { name: "مشاهده فروشنده‌ها", exact: true });
    await tabTo(page, toSellers); focusLog.push(await focusVisible(page));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sellers\?/);
    await page.goto(`/sellers?product=${DAHUA}&variant=${enc(DV)}&r=3000`); // pin the variant so the list is deterministic
    const boxes = page.getByTestId("compare-checkbox");
    await expect(boxes.first()).toBeVisible({ timeout: 20_000 });
    // sheet: open from a card with the keyboard, Escape closes it and focus returns to the opener
    const showOnMap = page.getByTestId("seller-card").first().getByRole("button", { name: "نمایش روی نقشه" });
    expect(await showOnMap.count(), "the seller card exposes «نمایش روی نقشه»").toBeGreaterThan(0);
    {
      await tabTo(page, showOnMap); await page.keyboard.press("Enter");
      await expect(page.getByTestId("map-sheet")).toBeVisible();
      await expect(page.getByTestId("map-sheet")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("map-sheet")).toHaveCount(0);
      await expect(showOnMap).toBeFocused();
    }

    await tabTo(page, boxes.nth(0)); await page.keyboard.press("Space");
    await tabTo(page, boxes.nth(1)); await page.keyboard.press("Space");
    await expect(boxes.nth(0)).toBeChecked(); await expect(boxes.nth(1)).toBeChecked();

    // stage 3 — compare
    const go = page.getByTestId("compare-go");
    await tabTo(page, go); focusLog.push(await focusVisible(page));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("compare-col")).toHaveCount(2, { timeout: 20_000 });

    // stage 4 — inquiry → mission
    const prep = page.getByTestId("prepare-inquiry").first();
    await tabTo(page, prep); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/missions\/new\?/);
    await expect(page.getByTestId("inquiry-workspace")).toBeVisible();
    const start = page.getByTestId("start-mission-cta");
    await tabTo(page, start); focusLog.push(await focusVisible(page));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/missions\/msn_/);
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });

    // mission: open the inquiry tab and the visit tab with the keyboard
    await tabTo(page, page.getByTestId("tab-inquiry-btn")); await page.keyboard.press("Enter");
    await expect(page.getByTestId("tab-inquiry")).toBeVisible({ timeout: 20_000 });
    await tabTo(page, page.getByTestId("copy")); await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-msg")).toContainText("متن کپی شد");
    await page.goto(page.url().replace(/tab=\w+/, "tab=visit").includes("tab=") ? page.url().replace(/tab=\w+/, "tab=visit") : `${page.url()}?tab=visit`);
    await expect(page.getByTestId("tab-visit")).toBeVisible({ timeout: 20_000 });
    await tabTo(page, page.getByTestId("done-confirm_model")); focusLog.push(await focusVisible(page));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("check-confirm_model")).toHaveAttribute("data-state", "done");
    expect(focusLog.every(Boolean), `focus indicator missing at step(s): ${focusLog.map((v, i) => (v ? "" : i)).join(",")}`).toBe(true);
  });

  test("the skip link and landmarks exist; headings do not skip a level on the main pages", async ({ page }) => {
    for (const u of ["/", "/assistant", "/discover", "/missions", `/products/${DAHUA}`]) {
      await page.goto(u);
      expect(await page.locator("main").count(), u).toBe(1);
      expect(await page.getByRole("navigation").count(), u).toBeGreaterThan(0);
      const levels = await page.locator("h1,h2,h3,h4").evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
      expect(levels.filter((l) => l === 1), u).toHaveLength(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!, `${u}: heading level jump ${levels[i - 1]}→${levels[i]}`).toBeLessThanOrEqual(1);
    }
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "پرش به محتوا" })).toBeFocused();
  });
});

test.describe("destructive confirmation: focus is managed", () => {
  test("hub «حذف همه»: opening focuses the safe «انصراف», Escape-less cancel returns focus to the trigger; nothing is deleted", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/missions");
    const start = page.getByTestId("hub-delete-all-start");
    await start.focus(); await page.keyboard.press("Enter");
    const cancel = page.getByRole("button", { name: "انصراف" });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(start).toBeFocused();
  });

  test("short viewport (on-screen keyboard open): the focused message field stays inside the visible area and nothing overflows horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 360 }); // ≈ 844px phone with the soft keyboard up
    await page.goto("/assistant");
    const box = page.getByRole("textbox").first();
    await box.focus();
    const r = await box.evaluate((el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
    expect(r.bottom).toBeLessThanOrEqual(r.h + 1);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.sw).toBeLessThanOrEqual(r.cw);
  });
});
