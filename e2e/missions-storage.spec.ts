import type { BrowserContext, Page } from "@playwright/test";
import { DAHUA, expect, HAS_DB, test } from "./helpers";

test.skip(!HAS_DB, "needs data/app.sqlite");
const enc = encodeURIComponent;
const DV = "unknown|HDW1200CLQP";
const SHOP_A = "shop_8670c71ca3baff62d68de422";
const OFFER_A = "offer_742932354aecd83d7fc7c266";
const START = (extra = "") => `/missions/start?product=${DAHUA}&variant=${enc(DV)}&shop=${SHOP_A}&offer=${OFFER_A}&visit=2026-10-24T11:00&district=ferdowsi${extra}`;
const MISSION_URL = /\/missions\/msn_[0-9a-f]{32}/;
const TAB_PREFIX = "hamghadam.mission.tab.v1:";

const root = (p: Page) => p.getByTestId("mission-root");
const tab = async (p: Page, t: "summary" | "visit" | "inquiry" | "recover" | "device") => { await p.getByTestId(`tab-${t}-btn`).click(); await expect(p.getByTestId(`tab-${t}`)).toBeVisible({ timeout: 20_000 }); };
async function begin(page: Page, extra = ""): Promise<string> {
  await page.goto(START(extra));
  await expect(page).toHaveURL(MISSION_URL);
  await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
  return page.url().match(/msn_[0-9a-f]{32}/)![0];
}
const idbDump = (page: Page) => page.evaluate(async () => {
  const dbs = (await indexedDB.databases?.()) ?? [];
  if (!dbs.some((d) => d.name === "hamghadam-missions")) return [] as unknown[];
  return await new Promise<unknown[]>((resolve) => {
    const open = indexedDB.open("hamghadam-missions", 1);
    open.onsuccess = () => { const db = open.result; if (!db.objectStoreNames.contains("missions")) return resolve([]); const r = db.transaction("missions").objectStore("missions").getAll(); r.onsuccess = () => { db.close(); resolve(r.result); }; r.onerror = () => resolve([]); };
    open.onerror = () => resolve([]);
  });
});
const tabKeys = (page: Page) => page.evaluate((p) => Object.keys(sessionStorage).filter((k) => k.startsWith(p)), TAB_PREFIX);
const rev = async (page: Page) => Number(await root(page).getAttribute("data-rev"));
const saveToDevice = async (page: Page, notes = false) => { await tab(page, "device"); if (notes) await page.getByTestId("keep-notes").check(); await page.getByTestId("save-device").click(); await expect(page.getByTestId("storage-badge")).toHaveAttribute("data-where", "DEVICE"); };
const wipe = async (ctx: BrowserContext, page: Page) => { await page.goto("/missions"); await page.getByTestId("hub-delete-all-start").click(); await page.getByTestId("hub-delete-all-confirm").click(); await expect(page.getByTestId("hub-msg")).toContainText("پاک شد"); void ctx; };

test.describe("persistence is opt-in, device-local, and deletable", () => {
  test("nothing reaches the device store without the explicit save; a new tab does not see a temporary mission", async ({ page, context }) => {
    await begin(page);
    await expect(root(page)).toHaveAttribute("data-where", "TAB");
    expect(await idbDump(page)).toEqual([]);
    expect((await tabKeys(page)).length).toBe(1);
    const p2 = await context.newPage();
    await p2.goto("/missions");
    await expect(p2.getByTestId("hub-empty")).toBeVisible();
    await p2.close();
  });

  test("save on this device → survives refresh, a closed/reopened tab and shows in the hub; notes stay out unless allowed", async ({ page, context }) => {
    const id = await begin(page);
    await tab(page, "device");
    await page.getByTestId("notes-input").fill("یادداشت خصوصی من");
    await page.getByTestId("notes-consent").check(); await page.getByTestId("notes-save").click();
    await saveToDevice(page, false);
    const rows = (await idbDump(page)) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, v: 1, notes: null });
    expect(JSON.stringify(rows)).not.toMatch(/یادداشت خصوصی|DEMO|phone|"lat"|"lon"|gps|\b09\d{9}\b/i);
    expect(await tabKeys(page)).toEqual([]); // the temporary tab copy is gone: no duplicate
    await page.goto(`/missions/${id}`);
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("storage-badge")).toHaveAttribute("data-where", "DEVICE");
    await page.close();
    const p2 = await context.newPage();
    await p2.goto("/missions");
    await expect(p2.getByTestId("hub-item")).toHaveCount(1);
    await p2.getByTestId("hub-item").click();
    await expect(p2.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
    await expect(root(p2)).toHaveAttribute("data-where", "DEVICE");
    await tab(p2, "device");
    await expect(p2.getByTestId("notes-input")).toHaveValue("");
    // with the extra consent the note is stored
    await p2.getByTestId("notes-input").fill("یادداشت دوم"); await p2.getByTestId("notes-consent").check(); await p2.getByTestId("notes-save").click();
    expect(((await idbDump(p2)) as Array<{ notes: string | null }>)[0]!.notes).toBe("یادداشت دوم");
    await wipe(context, p2);
  });

  test("«حذف از این دستگاه» keeps the tab copy only; «حذف کامل» removes every trace; «حذف همه» clears tab + device + legacy drafts", async ({ page, context }) => {
    const id = await begin(page);
    await saveToDevice(page);
    await tab(page, "device");
    await page.getByTestId("forget-device").click();
    await expect(page.getByTestId("storage-badge")).toHaveAttribute("data-where", "TAB");
    expect(await idbDump(page)).toEqual([]); expect((await tabKeys(page)).length).toBe(1);
    await saveToDevice(page);
    await page.getByTestId("delete-start").click(); await page.getByTestId("delete-confirm").click();
    await expect(page.getByTestId("mission-missing")).toBeVisible();
    expect(await idbDump(page)).toEqual([]); expect(await tabKeys(page)).toEqual([]);
    await page.goto(`/missions/${id}`);
    await expect(page.getByTestId("mission-missing")).toBeVisible();
    // two missions + a legacy inquiry draft, then delete everything at once
    await begin(page); await saveToDevice(page);
    await begin(page);
    await page.evaluate(() => sessionStorage.setItem("hamghadam.inquiry.v1:x|y|z", JSON.stringify({ v: 1 })));
    await wipe(context, page);
    expect(await idbDump(page)).toEqual([]);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("hamghadam.")))).toEqual([]);
    await expect(page.getByTestId("hub-empty")).toBeVisible();
  });
});

test.describe("storage denied: the shopping flow still works", () => {
  test("blocked sessionStorage + IndexedDB → memory fallback is announced; ticks work; a hard refresh rebuilds from the non-sensitive URL ids", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "fa-IR", timezoneId: "Asia/Tehran" });
    await ctx.addInitScript(() => {
      const block = () => { throw new DOMException("blocked", "SecurityError"); };
      Object.defineProperty(window, "sessionStorage", { get: block, configurable: true });
      Object.defineProperty(window, "indexedDB", { get: block, configurable: true });
    });
    await ctx.route("https://image.torob.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) }));
    const page = await ctx.newPage();
    await page.goto(START());
    await expect(page).toHaveURL(MISSION_URL);
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("storage-badge")).toHaveAttribute("data-where", "MEMORY");
    await tab(page, "visit");
    await page.getByTestId("done-confirm_model").click();
    await expect(page.getByTestId("check-confirm_model")).toHaveAttribute("data-state", "done");
    await tab(page, "device");
    await expect(page.getByTestId("storage-issue")).toContainText("مسدود");
    await expect(page.getByTestId("save-device")).toBeDisabled();
    await page.goto(page.url().replace("tab=device", "tab=summary"));
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 }); // rebuilt from the URL ids
    await page.goto("/missions");
    await expect(page.getByTestId("device-unavailable")).toBeVisible();
    await ctx.close();
  });
});

test.describe("tampered / forged / foreign state is never trusted", () => {
  test("malformed ids are 404; a well-formed unknown id is «not found on this device» (a URL alone opens nothing)", async ({ page }) => {
    for (const bad of ["/missions/abc", "/missions/msn_zz", `/missions/msn_${"g".repeat(32)}`, "/missions/msn_" + "a".repeat(31)]) expect((await page.goto(bad))?.status(), bad).toBe(404);
    const r = await page.goto(`/missions/msn_${"a".repeat(32)}`);
    expect(r?.status()).toBe(200);
    await expect(page.getByTestId("mission-missing")).toBeVisible();
    await expect(page.getByRole("heading", { name: "این ماموریت روی این دستگاه پیدا نشد" })).toBeVisible();
    expect(await page.getByTestId("mission-price").count()).toBe(0);
  });
  test("a poisoned stored record (extra phone/gps/demo fields, future version) is shown as unreadable and can be deleted", async ({ page }) => {
    const id = await begin(page);
    await page.evaluate(([k, i]) => { const raw = JSON.parse(sessionStorage.getItem(k!)!); raw.phone = "09120000000"; raw.gps = { lat: 35.7, lon: 51.4 }; sessionStorage.setItem(k!, JSON.stringify(raw)); void i; }, [TAB_PREFIX + id, id]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "این ماموریت قابل‌خواندن نیست" })).toBeVisible();
    await expect(page.getByTestId("mission-price")).toHaveCount(0);
    await page.evaluate(([k]) => sessionStorage.setItem(k!, JSON.stringify({ v: 99, id: k })), [TAB_PREFIX + id]);
    await page.goto("/missions");
    await expect(page.getByTestId("hub-unreadable")).toBeVisible();
    await page.getByTestId("hub-remove-unreadable").click();
    await expect(page.getByTestId("hub-unreadable")).toHaveCount(0);
    expect(await tabKeys(page)).toEqual([]);
  });
  test("a stored mission whose ids no longer join in the dataset shows NO facts (nothing from the mission is believed)", async ({ page }) => {
    const id = await begin(page);
    await page.evaluate(([k]) => { const raw = JSON.parse(sessionStorage.getItem(k!)!); raw.shop.offerId = "offer_00000000000000000000dead"; sessionStorage.setItem(k!, JSON.stringify(raw)); }, [TAB_PREFIX + id]);
    await page.reload();
    await expect(page.getByTestId("facts-mismatch")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("mission-price")).toHaveCount(0);
    await tab(page, "visit");
    await expect(page.getByTestId("readiness")).toHaveAttribute("data-ready", "0");
  });
  test("two missions never share state", async ({ page }) => {
    const a = await begin(page);
    await tab(page, "visit"); await page.getByTestId("done-confirm_model").click();
    const b = await begin(page, "&bmax=4500000");
    expect(a).not.toBe(b);
    await tab(page, "visit");
    await expect(page.getByTestId("check-confirm_model")).toHaveAttribute("data-state", "pending");
    await page.goto(`/missions/${a}?tab=visit`);
    await expect(page.getByTestId("check-confirm_model")).toHaveAttribute("data-state", "done");
  });
});

test.describe("races", () => {
  test("rapid, repeated and interleaved clicks compose in order: rev grows by one per accepted change, state is consistent after refresh", async ({ page }) => {
    await begin(page);
    await tab(page, "visit");
    const r0 = await rev(page);
    const b = page.getByTestId("done-confirm_model");
    await b.dblclick(); // two quick clicks: the second hits the «undo» button or nothing — never a double tick
    await page.getByTestId("skip-ask_stock_price").click({ clickCount: 3, delay: 5 });
    await page.getByTestId("mission-visit-input").fill("2026-10-25T10:00");
    await page.getByTestId("mission-visit-input").fill("2026-10-26T10:00");
    const r1 = await rev(page);
    expect(r1 - r0).toBeGreaterThanOrEqual(3); expect(r1 - r0).toBeLessThanOrEqual(8);
    await expect(page.getByTestId("location-line")).toContainText("نشانی ثبت‌شده در داده");
    const before = await page.getByTestId("checklist").innerText();
    await page.reload();
    await expect(page.getByTestId("tab-visit")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("location-line")).toContainText("نشانی ثبت‌شده در داده");
    expect(await page.getByTestId("checklist").innerText()).toBe(before);
    await expect(page.getByTestId("mission-visit-input")).toHaveValue("2026-10-26T10:00");
  });
  test("changing the seller while a recovery plan loads: the stale plan can never attach the wrong offer", async ({ page }) => {
    await begin(page);
    await tab(page, "recover");
    await page.getByTestId("quick-UNAVAILABLE").click(); await page.getByTestId("quick-submit").click();
    const alt = page.getByTestId("alt-seller").first();
    await expect(alt).toBeVisible({ timeout: 20_000 });
    const shop = await alt.getAttribute("data-shop-id");
    await alt.getByTestId("choose-alt").dblclick();
    await tab(page, "summary");
    const html = await page.getByTestId("mission-shop").innerText();
    expect(html.length).toBeGreaterThan(10);
    // exactly one selection in storage, for the chosen shop (double click did not add a second/foreign one)
    const raw = await page.evaluate((p) => { const k = Object.keys(sessionStorage).find((x) => x.startsWith(p))!; return JSON.parse(sessionStorage.getItem(k)!); }, TAB_PREFIX);
    expect(raw.shop.shopId).toBe(shop);
    expect(raw.recovery.history.filter((h: { resolution: string }) => h.resolution === "SWITCHED_SHOP")).toHaveLength(1);
  });
  test("two tabs editing one SAVED mission: the stale writer gets a conflict notice and the newer version (no lost update)", async ({ page, context }) => {
    const id = await begin(page); await saveToDevice(page);
    const p2 = await context.newPage();
    await p2.goto(`/missions/${id}?tab=visit`);
    await expect(p2.getByTestId("tab-visit")).toBeVisible({ timeout: 20_000 });
    await tab(page, "visit"); await page.getByTestId("done-confirm_model").click();
    await expect.poll(async () => ((await idbDump(page)) as Array<{ rev: number }>)[0]?.rev).toBeGreaterThan(1);
    await p2.getByTestId("done-ask_stock_price").click(); // stale rev
    await expect(p2.getByTestId("conflict-banner")).toBeVisible({ timeout: 10_000 });
    await expect(p2.getByTestId("check-confirm_model")).toHaveAttribute("data-state", "done"); // newer version loaded
    await expect(p2.getByTestId("check-ask_stock_price")).toHaveAttribute("data-state", "pending"); // the stale edit did not overwrite
    await wipe(context, p2);
  });
});
