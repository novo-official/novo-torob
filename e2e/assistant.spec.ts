import path from "node:path";
import { collectErrors, DAHUA, expect, expectNoHorizontalOverflow, FORBIDDEN_CLAIMS, HAS_DB, test } from "./helpers";
import type { Page } from "@playwright/test";

const SHOTS = path.resolve("docs/qa");
const VIEWPORTS = [{ w: 360, h: 800 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }] as const;
const send = async (page: Page, text: string) => {
  const before = await page.getByTestId("agent-assistant-msg").count();
  await page.getByTestId("agent-input").fill(text);
  await page.getByTestId("agent-send").click();
  await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(page.getByTestId("agent-busy")).toBeHidden();
};
const latest = (page: Page) => page.locator('[data-testid="agent-assistant-msg"][data-latest="1"]');
const shot = async (page: Page, name: string) => { for (const v of VIEWPORTS) { await page.setViewportSize({ width: v.w, height: v.h }); await expectNoHorizontalOverflow(page); await page.screenshot({ path: path.join(SHOTS, `${name}-${v.w}x${v.h}.png`), fullPage: false }); } };
const fresh = async (page: Page) => { await page.goto("/assistant"); await page.evaluate(() => sessionStorage.clear()); await page.reload(); await expect(page.getByTestId("agent-root")).toBeVisible(); };

test.describe("assistant: honesty banner + page shell", () => {
  test("RTL Persian page, one h1, the mock is labelled as NOT a language model, no horizontal overflow at 4 viewports", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/assistant");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const banner = page.getByTestId("agent-provider");
    await expect(banner).toHaveAttribute("data-provider", "mock");
    await expect(banner).toContainText("هیچ مدل زبانی‌ای در کار نیست");
    expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN_CLAIMS);
    for (const v of VIEWPORTS) { await page.setViewportSize({ width: v.w, height: v.h }); await expectNoHorizontalOverflow(page); }
    expect(errors).toEqual([]);
  });
  test("keyboard: Ctrl+Enter sends from the textarea; focus is visible on card buttons; main targets ≥ 44px", async ({ page }) => {
    test.skip(!HAS_DB, "needs data/app.sqlite");
    await fresh(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const tooSmall = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="agent-example"], [data-testid="agent-send"], [data-testid="agent-input"], [data-testid="agent-panel-toggle"]')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 43.5).map((e) => e.textContent?.slice(0, 20)));
    expect(tooSmall).toEqual([]);
    await page.getByTestId("agent-input").focus();
    await page.getByTestId("agent-input").fill("HDW1200CLQP رو می‌خوام");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(1, { timeout: 30_000 });
    await expect(latest(page).getByTestId("agent-product")).toHaveCount(1);
    await page.getByTestId("agent-select-product").focus();
    const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}`; });
    expect(outline).not.toMatch(/^none\|0px\|none$/);
  });
  test("reduced motion: the page works and nothing animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/assistant");
    await expect(page.getByTestId("agent-welcome")).toBeVisible();
    expect(await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => { const s = getComputedStyle(e); return s.animationName !== "none" && parseFloat(s.animationDuration) > 0.05; }).length)).toBe(0);
  });
});

test.describe("DEMO A — full guided flow (real dataset ids, mock planner)", () => {
  test.skip(!HAS_DB, "needs data/app.sqlite");
  test("undecided buyer → questions → ≥2 real products → nearby sellers → comparison → draft → manual reply (USER_REPORTED)", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    const outbound: string[] = [];
    page.on("request", (r) => { const u = new URL(r.url()); if (!["127.0.0.1", "localhost", "image.torob.com", "tile.openstreetmap.org"].includes(u.hostname)) outbound.push(r.url()); });
    await fresh(page);
    await send(page, "یک هدفون بی‌سیم برای ورزش می‌خوام");
    // stage 1: structured questions (no free text needed)
    for (let i = 0; i < 6 && (await latest(page).getByTestId("agent-clarify").count()); i++) {
      const before = await page.getByTestId("agent-assistant-msg").count();
      await latest(page).getByTestId("agent-clarify-option").first().click();
      await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(before + 1, { timeout: 30_000 });
    }
    const products = latest(page).getByTestId("agent-product");
    expect(await products.count()).toBeGreaterThanOrEqual(2);
    await expect(products.first()).toContainText("داده‌ی رسمی ترب");
    await shot(page, "assistant-products");
    await page.setViewportSize({ width: 390, height: 844 });
    // stage 2: sellers
    await products.first().getByTestId("agent-select-product").click();
    await expect(latest(page).getByTestId("agent-trace")).toContainText("یافتن فروشنده‌ی نزدیک", { timeout: 30_000 });
    await expect(latest(page).getByTestId("agent-text")).toContainText("به معنی موجودی نیست");
    // stage 3: compare
    await send(page, "فروشنده‌ها را مقایسه کن");
    await expect(latest(page).getByTestId("agent-comparison")).toBeVisible();
    expect(await latest(page).getByTestId("agent-compare-row").count()).toBeGreaterThanOrEqual(2);
    await shot(page, "assistant-compare");
    // stage 4: draft + manual reply
    await latest(page).getByTestId("agent-compare-row").first().getByRole("button", { name: /پیش‌نویس پرسش/ }).click();
    await expect(latest(page).getByTestId("agent-inquiry")).toBeVisible({ timeout: 30_000 });
    await expect(latest(page).getByTestId("agent-inquiry")).toContainText("ارسال نشده");
    await send(page, "فروشنده گفت فردا موجود می‌شود");
    await expect(latest(page).getByTestId("agent-outcome")).toContainText("گزارش شما");
    await expect(latest(page).getByTestId("agent-outcome")).toContainText("تأییدنشده");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/ارسال\s*شد|پیامک\s*شد|تماس\s*گرفته\s*شد/);
    await shot(page, "assistant-draft");
    expect(outbound).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("DEMO B — intelligent recovery with a district", () => {
  test.skip(!HAS_DB, "needs data/app.sqlite");
  test("absent model + district → honest coverage statement, shopping areas with sources, map action, no seller invented", async ({ page }) => {
    await fresh(page);
    await send(page, "دوربین مداربسته مدل ZZ9999X رو می‌خوام نزدیک بهارستان");
    await expect(latest(page).getByTestId("agent-text")).toContainText("نمونه‌ی محدود");
    await expect(latest(page).getByTestId("agent-text")).not.toContainText("در تهران نیست");
    const areas = latest(page).getByTestId("agent-area");
    expect(await areas.count()).toBeGreaterThan(0);
    await expect(areas.first()).toContainText("فروشنده نیست");
    await expect(areas.first()).toContainText("اطمینان");
    await expect(latest(page).getByTestId("agent-seller")).toHaveCount(0);
    await expect(latest(page).getByRole("link", { name: /نمایش روی نقشه|نقشه/ }).first()).toHaveAttribute("href", /^\/sellers\?/);
    await shot(page, "assistant-recovery");
  });
});

test.describe("DEMO C — external specs/reviews (clearly-marked FIXTURES)", () => {
  test.skip(!HAS_DB, "needs data/app.sqlite");
  test("opt-in → fixture evidence with source, date, citation and the sibling-model conflict; dataset untouched", async ({ page }) => {
    await fresh(page);
    await send(page, "HDW1200CLQP رو می‌خوام");
    await latest(page).getByTestId("agent-select-product").click();
    await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(2, { timeout: 30_000 }); // the select turn finished (the OLD message also shows a trace)
    // without the opt-in nothing external is shown
    await send(page, "نظر و مشخصات بیرونی این محصول را بگو");
    await expect(latest(page).getByTestId("agent-evidence")).toHaveAttribute("data-status", "DISABLED");
    await expect(latest(page).getByTestId("evidence-item")).toHaveCount(0);
    // the user switches it on in the preferences panel
    await page.setViewportSize({ width: 1440, height: 900 });
    const before = await page.getByTestId("agent-assistant-msg").count();
    await page.getByTestId("agent-external").click();
    await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(before + 1, { timeout: 30_000 });
    await expect(page.getByTestId("agent-external")).toBeChecked();
    await send(page, "نظر و مشخصات بیرونی این محصول را بگو");
    const ev = latest(page).getByTestId("agent-evidence");
    await expect(ev).toHaveAttribute("data-mode", "fixture");
    await expect(ev).toContainText("نمونه‌ی آزمایشی — منبع واقعی نیست");
    const item = ev.getByTestId("evidence-item").first();
    await expect(item).toHaveAttribute("data-fixture", "1");
    await expect(item).toContainText("منبع:");
    await expect(item).toContainText("بازیابی:");
    await expect(ev.getByTestId("evidence-conflict")).toContainText("HDW1200CLQP-IL-B");
    await expect(ev).toContainText("هیچ امتیاز ستاره‌ای");
    await expect(ev.locator("a[href^='http']")).toHaveCount(0); // a fixture never links out
    await shot(page, "assistant-evidence");
  });
});

test.describe("failure states", () => {
  test("server error, rate limit, busy, network failure and timeout-like abort each show a recoverable message", async ({ page }) => {
    await fresh(page);
    const cases: Array<[number | "abort", string]> = [[503, "مشغول"], [429, "زیاد"], [500, "خطای داخلی"], ["abort", "ارتباط"]];
    for (const [mode, text] of cases) {
      await page.route("**/api/agent/turn", (r) => (mode === "abort" ? r.abort("failed") : r.fulfill({ status: mode, contentType: "application/json", body: JSON.stringify({ ok: false, error: mode === 503 ? "BUSY" : mode === 429 ? "RATE_LIMITED" : "INTERNAL", messageFa: mode === 503 ? "دستیار الان مشغول است؛ چند ثانیه‌ی دیگر دوباره امتحان کنید." : mode === 429 ? "درخواست‌ها زیاد است؛ کمی بعد دوباره امتحان کنید." : "خطای داخلی؛ دوباره تلاش کنید." }) })));
      await page.getByTestId("agent-input").fill("سلام");
      await page.getByTestId("agent-send").click();
      await expect(page.getByTestId("agent-error")).toContainText(text);
      await page.unroute("**/api/agent/turn");
    }
    // recovery: the real endpoint works again
    await send(page, "سلام");
    await expect(page.getByTestId("agent-error")).toHaveCount(0);
  });
  test("a forged/corrupt saved state is discarded on load (no crash); the server also refuses a forged state with 400", async ({ page, request }) => {
    await page.goto("/assistant");
    await page.evaluate(() => sessionStorage.setItem("hamghadam.agent.v1", JSON.stringify({ v: 1, state: { v: 1, phone: "09120000000" }, msgs: [] })));
    await page.reload();
    await expect(page.getByTestId("agent-welcome")).toBeVisible();
    await send(page, "سلام");
    await expect(page.getByTestId("agent-error")).toHaveCount(0);
    const r = await request.post("/api/agent/turn", { data: { message: "سلام", state: { v: 1, phone: "09120000000" } } });
    expect(r.status()).toBe(400);
    expect(await r.text()).not.toContain("09120000000");
  });
  test("the agent endpoint never reaches an external host and refuses cross-site posts", async ({ page, request }) => {
    const r = await request.post("/api/agent/turn", { headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" }, data: { message: "x", state: {} } });
    expect(r.status()).toBe(403);
    const ok = await request.get("/api/agent/status");
    expect(await ok.json()).toMatchObject({ enabled: true, provider: { id: "mock", isLanguageModel: false, liveVerified: false } });
    expect(await ok.text()).not.toMatch(/sk-|api[_-]?key|baseUrl/i);
    void page;
  });
});

test.describe("navigation + coexistence with the explicit pages", () => {
  test("the bottom nav has 5 items with 44px+ targets and marks the assistant active; every card link is an internal route", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/assistant");
    const nav = page.getByRole("navigation", { name: "ناوبری اصلی (موبایل)" });
    await expect(nav.getByRole("link", { name: "دستیار" })).toHaveAttribute("aria-current", "page");
    expect(await nav.getByRole("link").count()).toBe(5);
    for (const l of await nav.getByRole("link").all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
  });
  test("a product chosen in the assistant opens the explicit sellers page with the same product", async ({ page }) => {
    test.skip(!HAS_DB, "needs data/app.sqlite");
    await fresh(page);
    await send(page, "HDW1200CLQP رو می‌خوام");
    await latest(page).getByRole("link", { name: "جزئیات محصول" }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${DAHUA}`));
  });
});
