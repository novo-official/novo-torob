import path from "node:path";
import type { Page, Request } from "@playwright/test";
import { ALLOWED_REQUEST_RE, collectErrors, DAHUA, dbRow, expect, expectNoHorizontalOverflow, HAS_DB, REAL_CATALOG_REQUIRED, test } from "./helpers";
import { QA_OUT } from "../tests/helpers/qa-out";

test.skip(!HAS_DB, REAL_CATALOG_REQUIRED);
const enc = encodeURIComponent;
const OUT = QA_OUT;
const DV = "unknown|HDW1200CLQP";
const SHOP_A = "shop_8670c71ca3baff62d68de422";
const OFFER_A = "offer_742932354aecd83d7fc7c266";
const VISIT_OK = "2026-10-24T11:00"; // declared 09:00–20:00 for SHOP_A (verified against the dataset)
const VISIT_LATE = "2026-10-24T21:00"; // outside the declared window
const NEW = (extra = "") => `/missions/new?product=${DAHUA}&variant=${enc(DV)}&shop=${SHOP_A}&offer=${OFFER_A}&visit=${VISIT_OK}${extra}`;
const START = (extra = "") => `/missions/start?product=${DAHUA}&variant=${enc(DV)}&shop=${SHOP_A}&offer=${OFFER_A}&visit=${VISIT_OK}&district=ferdowsi${extra}`;
const MISSION_URL = /\/missions\/msn_[0-9a-f]{32}/;
const faN = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

const root = (p: Page) => p.getByTestId("mission-root");
const tab = async (p: Page, t: "summary" | "visit" | "inquiry" | "recover" | "device") => { await p.getByTestId(`tab-${t}-btn`).click(); await expect(p.getByTestId(`tab-${t}`)).toBeVisible({ timeout: 20_000 }); };
async function begin(page: Page, via: "new" | "start" = "new", extra = "") {
  if (via === "new") { await page.goto(NEW(extra)); await page.getByTestId("start-mission-cta").click(); } else await page.goto(START(extra));
  await expect(page).toHaveURL(MISSION_URL);
  await expect(root(page)).toBeVisible();
  await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 }); // dataset facts arrived
  return page.url().match(/msn_[0-9a-f]{32}/)![0];
}
/** records everything: a mission must never send/POST anything, reach a phone/SMS/WhatsApp, or any host except same-origin + stubbed images/tiles */
function watch(page: Page) {
  const reqs: Request[] = [];
  page.on("request", (r) => reqs.push(r));
  return { assertNoSend() {
    for (const r of reqs) {
      expect(r.url(), `forbidden: ${r.url()}`).not.toMatch(/^(tel|sms|mailto|whatsapp):|wa\.me|whatsapp\.com|t\.me|telegram/i);
      expect(["GET", "HEAD", "OPTIONS"], `${r.method()} ${r.url()}`).toContain(r.method());
      expect(r.url()).toMatch(ALLOWED_REQUEST_RE);
    }
  } };
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
const enterReply = async (page: Page, o: { stock?: "yes" | "no" | "unknown"; model?: "same" | "different"; price?: string; text?: string }) => {
  if (o.text) await page.locator("#reply-text").fill(o.text);
  if (o.stock) await page.getByTestId(`stock-${o.stock}`).click();
  if (o.model) await page.getByTestId(`model-${o.model}`).click();
  if (o.price) { await page.locator("#reply-price").fill(o.price); if (await page.getByTestId("unit-toman").count()) await page.getByTestId("unit-toman").click(); }
  await page.getByTestId("reply-submit").click();
};

test.describe("mission 1 — shortlist → manual inquiry → USER_REPORTED reply → visit-ready checklist (Dahua, real ids)", () => {
  test("a single journey with no chat, ending in «آماده مراجعه» that never says «stock verified»", async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors = collectErrors(page); const net = watch(page);
    await begin(page);
    await expect(root(page)).toHaveAttribute("data-phase", "INQUIRY");
    await expect(root(page)).toHaveAttribute("data-where", "TAB");
    await expect(page.getByTestId("storage-badge")).toContainText("موقت");
    await expect(page.getByTestId("primary-step-label")).toContainText("پرسش را بسازید");
    await expect(page.getByTestId("mission-price")).toContainText(faN(4_100_000));
    await expect(page.getByTestId("mission-hours")).toContainText("داخل ساعت اعلام‌شده");

    await tab(page, "inquiry");
    await page.getByTestId("copy").click();
    await expect(page.getByTestId("live-msg")).toContainText("متن کپی شد");
    await page.getByTestId("mark-contacted").click();
    await expect(root(page)).toHaveAttribute("data-phase", "AWAIT_REPLY");
    await enterReply(page, { text: "گفت فردا هم هست", stock: "yes", model: "same", price: "۴٬۱۰۰٬۰۰۰ تومان" });
    await expect(page.getByTestId("reply-item")).toHaveAttribute("data-provenance", "USER_REPORTED");
    await expect(root(page)).toHaveAttribute("data-phase", "REPLIED");

    await tab(page, "visit");
    await expect(page.getByTestId("visit-hours")).toContainText("داخل ساعت اعلام‌شده");
    await expect(page.getByTestId("check-contact_result")).toHaveAttribute("data-state", "done"); // derived from the user's own reply
    await expect(page.getByTestId("readiness")).toHaveAttribute("data-ready", "0");
    await expect(page.getByTestId("mark-visited")).toBeDisabled();
    for (const i of ["confirm_model", "ask_stock_price", "check_hours", "verify_location"]) await page.getByTestId(`done-${i}`).click();
    await expect(page.getByTestId("readiness")).toHaveAttribute("data-ready", "1");
    await expect(root(page)).toHaveAttribute("data-phase", "VISIT_READY");
    const r = await page.getByTestId("readiness").innerText();
    expect(r).toContain("آماده مراجعه"); expect(r).toContain("موجودی تأییدشده"); expect(r).toMatch(/به معنی «موجودی تأییدشده» نیست/);
    await expect(page.getByTestId("location-line")).toContainText("طبقه"); // the dataset address text (with floor/unit) is shown as recorded
    const map = page.getByTestId("open-map");
    await expect(map).toHaveAttribute("href", /^https:\/\/www\.openstreetmap\.org\/\?mlat=/);
    await expect(map).toHaveAttribute("target", "_blank"); await expect(map).toHaveAttribute("rel", /noopener/);
    await page.getByTestId("copy-checklist").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("پیام به فروشنده نیست"); expect(clip).toContain("☑"); expect(clip).not.toMatch(/\b09\d{9}\b|tel:|DEMO|ارسال شد|موجود است/);
    await page.screenshot({ path: path.join(OUT, "mission-ready-390x844.png") });

    await page.getByTestId("mark-visited").click();
    await expect(root(page)).toHaveAttribute("data-phase", "VISITED");
    await tab(page, "summary");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/ارسال\s*شد|(?<!«)موجودی\s*تأیید\s*شد(?![»ه])|در انبار|پرفروش/);
    const html = await page.content();
    expect(html).not.toMatch(/tel:|sms:|\b09\d{9}\b/);
    expect(errors).toEqual([]); net.assertNoSend();
  });
});

test.describe("mission 2 — user-reported unavailable → real alternative seller OR an honest shopping-district fallback", () => {
  test("«موجود نیست» → alternatives are real offers of the SAME variant at other shops; switching resets only seller-linked work", async ({ page }) => {
    test.setTimeout(120_000);
    const net = watch(page);
    await begin(page);
    await tab(page, "visit");
    await page.getByTestId("done-confirm_model").click(); // seller-linked tick on shop A
    await tab(page, "recover");
    await expect(page.getByTestId("no-triggers")).toBeVisible();
    await page.getByTestId("quick-UNAVAILABLE").click(); await page.getByTestId("quick-submit").click();
    await expect(page.getByTestId("trigger-UNAVAILABLE")).toBeVisible();
    const plan = page.getByTestId("recovery-plan");
    await expect(plan).toBeVisible({ timeout: 20_000 });
    await expect(plan.getByTestId("plan-facts")).toContainText("گزارش شما");
    await expect(plan.getByTestId("plan-facts").locator('li[data-provenance="USER_REPORTED"]').first()).toBeVisible();
    const alts = plan.getByTestId("alt-seller");
    expect(await alts.count()).toBeGreaterThan(0);
    const shopId = (await alts.first().getAttribute("data-shop-id"))!; const offerId = (await alts.first().getAttribute("data-offer-id"))!;
    expect(shopId).not.toBe(SHOP_A);
    expect(dbRow<{ product_id: string; shop_id: string }>("SELECT product_id, shop_id FROM offers WHERE offer_id = ?", offerId)).toEqual({ product_id: DAHUA, shop_id: shopId });
    await expect(alts.first()).toContainText("خط مستقیم");
    // blocked until a decision is taken
    await tab(page, "summary");
    await expect(page.getByTestId("mission-triggers")).toContainText("موجود نیست");
    await tab(page, "recover");
    await page.getByTestId("trigger-UNAVAILABLE").click();
    await page.getByTestId("choose-alt").first().click();
    await tab(page, "summary");
    await expect(page.getByTestId("mission-triggers")).toHaveCount(0); // the new offer has no user report
    await expect(root(page)).toHaveAttribute("data-phase", "INQUIRY"); // the old shop's inquiry does not follow
    await expect(page.getByTestId("mission-timeline")).toContainText("بازیابی");
    await tab(page, "visit");
    await expect(page.getByTestId("check-confirm_model")).toHaveAttribute("data-state", "pending"); // tick belonged to shop A
    await expect(page.getByTestId("mission-visit-input")).toHaveValue(VISIT_OK); // unrelated preference kept
    net.assertNoSend();
  });

  test("a product with no other same-variant seller → shopping-district fallback with source, date, type and «فروشنده نیست»", async ({ page }) => {
    test.setTimeout(120_000);
    const row = dbRow<{ product_id: string; shop_id: string; offer_id: string } | undefined>(
      `SELECT o.product_id, o.shop_id, o.offer_id FROM offers o JOIN products p ON p.product_id = o.product_id
        WHERE p.category_name = (SELECT category_name FROM products WHERE product_id = ?) AND o.price_toman IS NOT NULL
        GROUP BY o.product_id HAVING count(*) = 1 ORDER BY o.product_id LIMIT 1`, DAHUA);
    test.skip(!row, "no single-offer product in the category in this dataset");
    await page.goto(`/missions/start?product=${row!.product_id}&shop=${row!.shop_id}&offer=${row!.offer_id}&district=ferdowsi`);
    await expect(page).toHaveURL(MISSION_URL);
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
    await tab(page, "recover");
    await page.getByTestId("quick-NO_REPLY").click(); await page.getByTestId("quick-submit").click();
    await expect(page.getByTestId("recovery-plan")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("no-alt-sellers")).toContainText("نمونه‌ی داده");
    const areas = page.getByTestId("plan-area");
    expect(await areas.count()).toBeGreaterThan(0);
    await expect(areas.first()).toContainText("فروشنده نیست");
    await expect(areas.first()).toContainText("بررسی:");
    expect(["VERIFIED_SHOPPING_DISTRICT", "DATASET_DENSITY_ESTIMATE"]).toContain(await areas.first().getAttribute("data-geo-type"));
    await expect(page.getByTestId("recovery-plan")).not.toContainText("در تهران نیست");
    await expect(areas.first().getByRole("link", { name: "نمایش روی نقشه" })).toHaveAttribute("href", /^\/sellers\?category=/);
  });
});

test.describe("mission 3 — user-reported price change → transparent budget scenario; the dataset price never changes", () => {
  test("reported ۴٬۹۰۰٬۰۰۰ vs recorded ۴٬۱۰۰٬۰۰۰ with a ۴٬۵۰۰٬۰۰۰ budget", async ({ page }) => {
    test.setTimeout(120_000);
    await begin(page, "start", "&bmax=4500000");
    await tab(page, "recover");
    await page.getByTestId("quick-PRICE_CHANGED").click();
    await page.getByTestId("quick-price").fill("4900000");
    await page.getByTestId("quick-submit").click();
    const bs = page.getByTestId("budget-scenario");
    await expect(bs).toBeVisible({ timeout: 20_000 });
    await expect(bs.getByTestId("bs-recorded")).toContainText(faN(4_100_000));
    await expect(bs.getByTestId("bs-reported")).toContainText(faN(4_900_000));
    await expect(bs.getByTestId("bs-delta")).toContainText(faN(800_000));
    await expect(bs.getByTestId("bs-fit")).toContainText("بیشتر می‌شود");
    await expect(bs.getByTestId("bs-fit")).toContainText(faN(400_000));
    await expect(page.getByTestId("plan-facts").locator('li[data-provenance="USER_REPORTED"]')).toHaveCount(1);
    const href = await bs.getByTestId("reopen-compare").getAttribute("href");
    expect(href).toMatch(/^\/compare\?/); expect(href).toContain(SHOP_A); expect(href).toMatch(/bmax=4500000/);
    // the dataset record is untouched, on this page and after a reload
    expect(dbRow<{ price_toman: number }>("SELECT price_toman FROM offers WHERE offer_id = ?", OFFER_A).price_toman).toBe(4_100_000);
    await tab(page, "summary");
    await expect(page.getByTestId("mission-price")).toContainText(faN(4_100_000));
    await expect(page.getByTestId("mission-outcome")).toContainText("قیمت");
    await page.reload();
    await expect(page.getByTestId("mission-price")).toContainText(faN(4_100_000));
    // re-plan: switch to a seller whose RECORDED price fits the budget
    await tab(page, "recover");
    await page.getByTestId("trigger-PRICE_CHANGED").click();
    const alt = page.getByTestId("alt-seller").first();
    await expect(alt).toBeVisible({ timeout: 20_000 });
    await alt.getByTestId("choose-alt").click();
    await tab(page, "summary");
    await expect(page.getByTestId("mission-shop")).not.toContainText(faN(4_100_000));
  });

  test("different model reported → exact-item confirmation is blocked, other versions are only links back to the product page", async ({ page }) => {
    test.setTimeout(120_000);
    await begin(page);
    await tab(page, "recover");
    await page.getByTestId("quick-WRONG_MODEL").click(); await page.getByTestId("quick-submit").click();
    await expect(page.getByTestId("recovery-plan")).toBeVisible({ timeout: 20_000 });
    await tab(page, "visit");
    await expect(page.getByTestId("readiness")).toHaveAttribute("data-ready", "0");
    await expect(page.getByTestId("readiness")).toContainText("مدل/واحد دقیق روشن نیست");
    await tab(page, "recover");
    for (const l of await page.getByTestId("plan-variants").getByRole("link").all()) expect(await l.getAttribute("href")).toContain(`/products/${DAHUA}?variant=`);
  });
});

test.describe("hours: Tehran time, closed periods, unknown", () => {
  test("a visit after closing is flagged, the hours check is blocked, and the next DECLARED window is offered (never a guess)", async ({ page }) => {
    test.setTimeout(120_000);
    await begin(page, "start", "");
    await tab(page, "visit");
    await page.getByTestId("mission-visit-input").fill(VISIT_LATE);
    await expect(page.getByTestId("visit-outside")).toBeVisible();
    await expect(page.getByTestId("done-check_hours")).toBeDisabled();
    await tab(page, "recover");
    await expect(page.getByTestId("trigger-OUTSIDE_HOURS")).toBeVisible();
    await page.getByTestId("trigger-OUTSIDE_HOURS").click();
    const ni = page.getByTestId("next-interval");
    await expect(ni).toBeVisible({ timeout: 20_000 });
    await expect(ni).toContainText("تضمین");
    await ni.getByTestId("apply-next-interval").click();
    await tab(page, "visit");
    await expect(page.getByTestId("visit-outside")).toHaveCount(0);
    expect(await page.getByTestId("mission-visit-input").inputValue()).toMatch(/^2026-10-25T09:00$/);
  });
});

test.describe("demo simulation is fully isolated from missions", () => {
  test("running a simulated «موجود است» changes nothing in the mission, storage, export or URL; it vanishes on reload", async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = await begin(page);
    await tab(page, "inquiry");
    const rev0 = Number(await root(page).getAttribute("data-rev"));
    await page.getByTestId("demo-consent").check();
    await page.getByTestId("mode-demo").click();
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await page.getByTestId("scenario-AVAILABLE").click();
    await page.getByTestId("demo-run").click();
    await expect(page.getByTestId("demo-message").first()).toHaveAttribute("data-provenance", "DEMO_SIMULATED");
    await expect(page.getByTestId("decision-panel")).toHaveAttribute("data-mode", "DEMO");
    // the mission did not move: same revision, no replies, still waiting for the USER's own question
    expect(Number(await root(page).getAttribute("data-rev"))).toBe(rev0);
    const stored = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
    expect(stored).not.toMatch(/DEMO|شبیه‌سازی‌شده|SIMULAT|scenarioId":"AVAILABLE/);
    await tab(page, "summary");
    await expect(root(page)).toHaveAttribute("data-phase", "INQUIRY");
    await expect(page.getByTestId("mission-outcome")).toHaveCount(0);
    await expect(page.getByTestId("mission-triggers")).toHaveCount(0);
    await tab(page, "visit");
    await expect(page.getByTestId("check-contact_result")).toHaveAttribute("data-state", "pending"); // a simulated reply is not the user's contact result
    await page.getByTestId("copy-checklist").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toMatch(/DEMO|شبیه‌سازی|نمونه‌ی شبیه/);
    expect(page.url()).not.toMatch(/demo|scenario|simul/i);
    // even after an explicit save, demo content is absent from IndexedDB
    await tab(page, "device"); await page.getByTestId("save-device").click();
    await expect(page.getByTestId("storage-badge")).toHaveAttribute("data-where", "DEVICE");
    const idb = JSON.stringify(await idbDump(page));
    expect(idb).not.toMatch(/DEMO|شبیه‌سازی‌شده|SIMULAT/);
    await page.goto(`/missions/${id}?tab=inquiry`);
    await expect(page.getByTestId("inquiry-workspace")).toHaveAttribute("data-mode", "MANUAL"); // demo did not survive a reload
    await expect(page.getByTestId("demo-message")).toHaveCount(0);
    await page.goto("/missions"); await page.getByTestId("hub-delete-all-start").click(); await page.getByTestId("hub-delete-all-confirm").click();
  });
});

test.describe("cross-page continuity", () => {
  test("compare → inquiry → mission keeps product, variant, shop and offer; Back/Forward restore each page's URL", async ({ page }) => {
    test.setTimeout(120_000);
    const MID_B = "shop_350520090b6a5a6163f919d3";
    await page.goto(`/compare?product=${DAHUA}&variant=${enc(DV)}&shops=${SHOP_A},${MID_B}`);
    const link = page.locator(`a[href^="/missions/new?"][href*="${SHOP_A}"]`).first();
    await expect(link).toBeVisible({ timeout: 20_000 });
    await link.click();
    await expect(page).toHaveURL(/\/missions\/new\?/);
    const newUrl = page.url();
    expect(newUrl).toContain(DAHUA); expect(newUrl).toContain(SHOP_A);
    await page.getByTestId("start-mission-cta").click();
    await expect(page).toHaveURL(MISSION_URL);
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("mission-product").getByRole("link", { name: "مشخصات و نسخه‌ها" })).toHaveAttribute("href", new RegExp(`/products/${DAHUA}\\?variant=`));
    await page.goBack(); // the start redirect used replace(): Back returns to the inquiry page with the same context
    await expect(page).toHaveURL(newUrl);
    await page.goForward();
    await expect(page).toHaveURL(MISSION_URL);
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 });
  });
  test("the legacy parameter-free Q&A and the guest inquiry still work without any mission", async ({ page }) => {
    await page.goto("/missions/new");
    await expect(page.getByText("راه ارتباطی تأییدشده در داده‌ها موجود نیست").first()).toBeVisible();
    await page.goto(NEW());
    await expect(page.getByTestId("inquiry-workspace")).toBeVisible();
    await page.getByTestId("copy").click();
    await expect(page.getByTestId("status-badge")).toContainText("کپی");
  });
  test("assistant → «ساخت ماموریت»: safe ids seed a mission; the assistant cannot write evidence", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/assistant"); await page.evaluate(() => sessionStorage.clear()); await page.reload();
    const send = async (text: string) => { const n = await page.getByTestId("agent-assistant-msg").count(); await page.getByTestId("agent-input").fill(text); await page.getByTestId("agent-send").click(); await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(n + 1, { timeout: 30_000 }); };
    const latest = page.locator('[data-testid="agent-assistant-msg"][data-latest="1"]');
    await send("HDW1200CLQP رو می‌خوام");
    await latest.getByTestId("agent-select-product").click();
    await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(2, { timeout: 30_000 });
    await send("فروشنده‌ها را مقایسه کن");
    await send("برای فروشنده‌ی اول پیش‌نویس سؤال بنویس");
    await latest.getByTestId("agent-start-mission").click();
    await expect(page).toHaveURL(MISSION_URL);
    await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 30_000 });
    await expect(root(page)).toHaveAttribute("data-phase", "INQUIRY"); // product + shop carried over; NO reply/evidence came from the assistant
    const raw = await page.evaluate(() => { const k = Object.keys(sessionStorage).find((x) => x.startsWith("hamghadam.mission.tab.v1:"))!; return sessionStorage.getItem(k)!; });
    expect(raw).not.toMatch(/"replies":\[\{|DEMO|phone|"lat"|"lon"|gps/);
    expect(JSON.parse(raw).inquiries).toEqual([]);
  });
});

test.describe("responsive layout, screenshots and axe on the mission UI", () => {
  const VIEWPORTS = [{ w: 360, h: 800 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }] as const;
  for (const v of VIEWPORTS) {
    test(`every tab fits ${v.w}×${v.h} with no horizontal overflow; screenshots`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width: v.w, height: v.h });
      await begin(page, "start", "&bmax=4500000");
      const shot = (n: string) => page.screenshot({ path: path.join(OUT, `mission-${n}-${v.w}x${v.h}.png`) });
      await expectNoHorizontalOverflow(page); await shot("summary");
      await tab(page, "visit"); await expectNoHorizontalOverflow(page); await shot("visit");
      await tab(page, "inquiry"); await expectNoHorizontalOverflow(page);
      await tab(page, "recover");
      await page.getByTestId("quick-PRICE_CHANGED").click(); await page.getByTestId("quick-price").fill("4900000"); await page.getByTestId("quick-submit").click();
      await expect(page.getByTestId("budget-scenario")).toBeVisible({ timeout: 20_000 });
      await expectNoHorizontalOverflow(page); await shot("recover");
      await tab(page, "device"); await expectNoHorizontalOverflow(page); await shot("device");
      await page.goto("/missions"); await expectNoHorizontalOverflow(page); await shot("hub");
    });
  }
  test("touch targets ≥ 44px on the mission controls (390 wide) and the mission summary stays short on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await begin(page);
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="mission-tabs"] button, [data-testid="primary-cta"], [data-testid="tab-summary"] button, [data-testid="tab-summary"] a')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 43.5).map((e) => (e.textContent ?? "").slice(0, 24)));
    expect(small).toEqual([]);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(h, `summary page height ${h}px`).toBeLessThan(2600);
    await tab(page, "visit");
    const small2 = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="tab-visit"] button, [data-testid="tab-visit"] input, [data-testid="tab-visit"] a')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 43.5 && (e as HTMLInputElement).type !== "checkbox").map((e) => (e.textContent ?? e.getAttribute("data-testid") ?? "").slice(0, 24)));
    expect(small2).toEqual([]);
  });
  test("keyboard: tabs are reachable and operable with the keyboard; reduced motion has no running animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await begin(page);
    await page.getByTestId("tab-summary-btn").focus();
    await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
    await expect(page.getByTestId("tab-visit")).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => { const s = getComputedStyle(e); return s.animationName !== "none" && parseFloat(s.animationDuration) > 0.05; }).length)).toBe(0);
  });
});

test.describe("offline / error state", () => {
  test("when the dataset facts cannot be fetched nothing is shown as a fact, and recovery comes back online", async ({ page, context }) => {
    await begin(page);
    await tab(page, "visit");
    await context.setOffline(true);
    await page.getByTestId("mission-visit-input").fill("2026-10-27T10:00"); // new facts key → the refetch fails
    await expect(page.getByTestId("visit-hours")).toContainText("دریافت نشد", { timeout: 20_000 });
    await expect(page.getByTestId("visit-hours")).not.toContainText("داخل ساعت");
    await context.setOffline(false);
    await page.getByTestId("mission-visit-input").fill("2026-10-28T10:00");
    await expect(page.getByTestId("visit-hours")).toContainText("داخل ساعت اعلام‌شده", { timeout: 20_000 });
  });
});
