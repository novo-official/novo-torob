import fs from "node:fs";
import path from "node:path";
import type { Page, Request } from "@playwright/test";
import { ALLOWED_REQUEST_RE, collectErrors, DAHUA, dbRow, expect, expectNoHorizontalOverflow, HAS_DB, REAL_CATALOG_REQUIRED, SELF_HOSTNAME, test } from "./helpers";
import { QA_OUT } from "../tests/helpers/qa-out";

test.skip(!HAS_DB, REAL_CATALOG_REQUIRED);
const enc = encodeURIComponent;
const OUT = QA_OUT;
const DV = "unknown|HDW1200CLQP";
const MID_A = "shop_8670c71ca3baff62d68de422";
const MID_B = "shop_350520090b6a5a6163f919d3";
const OFFER_A = "offer_742932354aecd83d7fc7c266";
const mission = (extra = "") => `/missions/new?product=${DAHUA}&variant=${enc(DV)}&shop=${MID_A}&offer=${OFFER_A}${extra}`;
const fa2n = (s: string) => Number(s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[^\d]/g, ""));
const faDigits = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

/** Records every request; the inquiry flow must NEVER reach a phone/SMS/WhatsApp endpoint or send anything (no non-GET). */
function watch(page: Page) {
  const reqs: Request[] = [];
  page.on("request", (r) => reqs.push(r));
  return {
    reqs,
    assertNoSend() {
      for (const r of reqs) {
        const u = r.url();
        expect(u, `forbidden scheme/host: ${u}`).not.toMatch(/^(tel|sms|mailto|whatsapp):|wa\.me|api\.whatsapp|whatsapp\.com|t\.me|telegram/i);
        expect(["GET", "HEAD", "OPTIONS"], `${r.method()} ${u} — the inquiry flow must not send anything`).toContain(r.method());
        // same origin, or read-only GET of stubbed map tiles / product photos loaded by the earlier pages of the journey
        expect(u).toMatch(ALLOWED_REQUEST_RE);
      }
    },
  };
}
/**
 * Dishonest anywhere here: «sent/delivered», an UNATTRIBUTED «available» (only «گزارش شما …/گفت …» attributions are allowed),
 * a plain «موجودی تأیید شد», fake stock/ratings.
 */
const FORBIDDEN_CLAIMS = /ارسال\s*شد|ارسال\s*شده|پیام شما فرستاده|تحویل داده شد|در انبار|بهترین کیفیت|پرفروش|امتیاز کاربران بالا|(?<!«)موجودی تأیید شد(?!»)|(?<!گزارش شما: |طبق گزارش شما |گفت |گفته‌اید |می‌گوید )موجود است(?!؟| \(تأییدنشده\))/;
/** Page text for claim checks: the user-facing QUESTIONS legitimately contain «…موجود است…؟», so they are excluded. */
const claimsText = (page: Page) => page.evaluate(() => {
  const main = document.querySelector("main") as HTMLElement;
  let t = main.innerText;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-testid=question-list],[data-testid=demo-transcript]"))) t = t.replace(el.innerText, "");
  return t;
});
/** phones show one step at a time (compose / follow / reply / outcome); on large screens every step is visible and the tabs are hidden */
const st = async (page: Page, s: "compose" | "follow" | "reply" | "outcome") => { const t = page.getByTestId(`istep-${s}`); if (await t.isVisible()) await t.click(); };
const ctxPrice = async (page: Page) => fa2n(await page.getByTestId("ctx-price").innerText());

test.describe("A · manual flow with a reported price change (real data, 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("sellers → compare → inquiry → draft → copy → user enters a higher price → reasons + revisit options; no network send", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors = collectErrors(page);
    const w = watch(page);
    await page.goto(`/sellers?product=${DAHUA}&variant=${enc(DV)}&r=3000`);
    await expect(page.getByTestId("card-inquiry").first()).toBeVisible(); // direct entry from the seller card exists too
    const boxes = page.getByTestId("compare-checkbox");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByTestId("compare-go").click();
    await expect(page.getByTestId("compare-col")).toHaveCount(2);
    await page.getByTestId("prepare-inquiry").first().click();

    // context from the server
    await expect(page).toHaveURL(/\/missions\/new\?.*product=.*variant=.*shop=shop_.*offer=offer_/);
    await expect(page.getByTestId("inquiry-context")).toBeVisible();
    await expect(page.getByTestId("ctx-offer-title")).toContainText("1200CLQP");
    const recorded = await ctxPrice(page);
    expect(recorded).toBeGreaterThan(1_000_000);
    await expect(page.getByTestId("status-badge")).toHaveText("پیش‌نویس");

    // the draft quotes the recorded price and date; no phone/URL; copy ≠ sent
    const draft = page.getByTestId("draft");
    await expect(draft).toHaveValue(new RegExp(faDigits(recorded).replace(/٬/g, "٬")));
    expect(await draft.inputValue()).not.toMatch(/\b09\d{9}\b|https?:|ارسال شد/);
    const t0 = Date.now();
    await page.getByTestId("copy").click();
    await expect(page.getByTestId("live-msg")).toContainText("متن کپی شد");
    console.log(`PERF copy→status ${Date.now() - t0}ms`);
    await expect(page.getByTestId("status-badge")).toContainText("ارسال نشده");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await draft.inputValue());
    await page.getByTestId("mark-contacted").click();
    await expect(page.getByTestId("status-badge")).toContainText("می‌گویید پرسیده‌اید");

    // the USER enters what the seller told them: +12 %, in toman
    const reported = Math.round((recorded * 1.12) / 1000) * 1000;
    await page.getByLabel(/قیمت امروزی/).fill(`${faDigits(reported)} تومان`);
    await expect(page.getByTestId("amount-status")).toContainText("خوانده شد");
    await page.getByTestId("stock-yes").click();
    await page.getByTestId("model-same").click();
    await page.getByTestId("reply-submit").click();

    const panel = page.getByTestId("decision-panel");
    await expect(panel.getByTestId("price-compare")).toContainText("گزارش شما از فروشنده");
    await expect(panel.getByTestId("price-delta")).toContainText("بیشتر");
    await expect(panel.getByTestId("outcome-claim")).toContainText("ادعای فروشنده");
    await expect(panel.getByTestId("outcome-claim")).toContainText("بالاتر");
    await expect(panel.getByTestId("next-COMPARE_AGAIN")).toBeVisible();
    await expect(panel.getByTestId("next-RECONFIRM_BEFORE_VISIT")).toBeVisible();
    await expect(page.getByTestId("reply-item")).toHaveAttribute("data-provenance", "USER_REPORTED");
    await expect(page.getByTestId("reply-item")).toContainText("ثبت‌شده توسط شما؛ هنوز مستقلاً تأیید نشده");
    expect(await ctxPrice(page)).toBe(recorded); // the dataset price is never overwritten
    expect(await claimsText(page)).not.toMatch(FORBIDDEN_CLAIMS);
    await expectNoHorizontalOverflow(page);

    // revisit: back to the comparison keeps the sellers; the reported price is NOT in the ranking
    await panel.getByTestId("next-COMPARE_AGAIN").click();
    await expect(page.getByTestId("compare-col").first()).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain(faDigits(reported));
    w.assertNoSend();
    expect(errors).toEqual([]);
  });

  test("refresh keeps this tab's manual inquiry, a new tab/storage clear does not; reset empties it", async ({ page }) => {
    await page.goto(mission());
    await st(page, "reply");
    await page.getByTestId("stock-no").click();
    await page.getByTestId("reply-submit").click();
    await st(page, "reply");
    await expect(page.getByTestId("reply-item")).toBeVisible();
    await page.reload();
    await st(page, "reply");
    await expect(page.getByTestId("reply-item")).toBeVisible();
    await expect(page.getByTestId("status-badge")).toContainText("موجود نیست");
    await page.goto("/sellers");
    await page.goBack();
    await expect(page.getByTestId("status-badge")).toContainText("موجود نیست"); // hydrated (state restored) before we click a tab
    await st(page, "reply");
    await expect(page.getByTestId("reply-item")).toBeVisible();
    await st(page, "outcome");
    await page.getByTestId("reset").click();
    await expect(page.getByTestId("reply-item")).toHaveCount(0);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.getByTestId("status-badge")).toHaveText("پیش‌نویس");
  });
});

test.describe("B · simulated unavailability keeps the product/variant and leaves nothing behind", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("opt-in → banner → deterministic demo reply with a tag → find another seller (product + variant kept) → demo is gone", async ({ page }) => {
    const w = watch(page);
    await page.goto(mission());
    await st(page, "follow");
    await expect(page.getByTestId("mode-demo")).toBeDisabled();
    await page.getByTestId("demo-consent").check();
    await page.getByTestId("mode-demo").click();
    await expect(page.getByTestId("demo-banner")).toContainText("حالت شبیه‌سازی — فقط دمو");
    await st(page, "reply");
    await page.getByTestId("scenario-NOT_AVAILABLE").click();
    const t0 = Date.now();
    await page.getByTestId("demo-run").click();
    await expect(page.getByTestId("demo-message")).toHaveCount(2);
    console.log(`PERF demo-run→transcript ${Date.now() - t0}ms`);
    for (const m of await page.getByTestId("demo-message").all()) {
      await expect(m).toHaveAttribute("data-provenance", "DEMO_SIMULATED");
      await expect(m.getByTestId("demo-tag")).toContainText("واقعی نیست");
    }
    const first = await page.getByTestId("demo-message").nth(1).innerText();
    await page.getByTestId("demo-clear").click();
    await page.getByTestId("demo-run").click(); // determinism: same scenario + same offer → identical reply
    expect(await page.getByTestId("demo-message").nth(1).innerText()).toBe(first);
    await st(page, "outcome");
    await expect(page.getByTestId("outcome-headline")).toContainText("فقط دمو");
    await expect(page.getByTestId("decision-panel")).toHaveAttribute("data-mode", "DEMO");
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toMatch(/DEMO|NOT_AVAILABLE|demo/i);
    expect(await claimsText(page)).not.toMatch(FORBIDDEN_CLAIMS);

    await page.getByTestId("next-FIND_OTHER_SELLER").click();
    await expect(page).toHaveURL(new RegExp(`/sellers\\?product=${DAHUA}&variant=${enc(DV).replace(/%7C/gi, "%7C")}`));
    await expect(page.getByTestId("seller-card").first()).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("demo-banner")).toHaveCount(0); // a false confirmation never survives navigation
    await expect(page.getByTestId("reply-item")).toHaveCount(0);
    await expect(page.getByTestId("status-badge")).toHaveText("پیش‌نویس");
    w.assertNoSend();
  });
  test("exiting demo clears it; a copied URL never opens in demo", async ({ page }) => {
    await page.goto(mission("&demo=1&mode=demo"));
    await expect(page.getByTestId("demo-banner")).toHaveCount(0);
    await st(page, "follow");
    await page.getByTestId("demo-consent").check();
    await page.getByTestId("mode-demo").click();
    await st(page, "reply");
    await page.getByTestId("demo-run").click();
    await page.getByTestId("demo-exit").click();
    await expect(page.getByTestId("demo-message")).toHaveCount(0);
    await expect(page.getByTestId("live-msg")).toContainText("پاک شد");
  });
  test("price-changed demo shows a labelled sample price, never as the seller's real quote", async ({ page }) => {
    await page.goto(mission());
    await st(page, "follow");
    await page.getByTestId("demo-consent").check();
    await page.getByTestId("mode-demo").click();
    await st(page, "reply");
    await page.getByTestId("scenario-PRICE_CHANGED").click();
    await page.getByTestId("demo-run").click();
    await st(page, "outcome");
    await expect(page.getByTestId("price-compare")).toContainText("قیمت نمونه (شبیه‌سازی)");
    await expect(page.getByTestId("price-compare")).not.toContainText("گزارش شما از فروشنده");
    await expect(page.getByTestId("ctx-price")).not.toHaveText("");
  });
});

test.describe("C · simulated variant mismatch is blocked", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("a demo reply naming another model blocks 'same item', asks for model confirmation and offers another seller", async ({ page }) => {
    await page.goto(mission());
    await st(page, "follow");
    await page.getByTestId("demo-consent").check();
    await page.getByTestId("mode-demo").click();
    await st(page, "reply");
    await page.getByTestId("scenario-VARIANT_DIFFERENT").click();
    await page.getByTestId("demo-run").click();
    await expect(page.getByTestId("demo-message").nth(1)).toContainText("HDW1200CLQP-B");
    await st(page, "outcome");
    await expect(page.getByTestId("blocked")).toContainText("مسدود");
    await expect(page.getByTestId("next-RECONFIRM_BEFORE_VISIT")).toHaveCount(0);
    await expect(page.getByTestId("next-FIND_OTHER_SELLER")).toBeVisible();
    await page.getByTestId("next-CLARIFY_VARIANT").click();
    await expect(page.getByTestId("live-msg")).toContainText("مدل/نسخه‌ی دقیق");
    await expect(page.getByTestId("draft")).toHaveValue(/آیا دقیقاً همین مدل/);
  });
  test("manual: the user reports a different model → same block, nothing is auto-confirmed", async ({ page }) => {
    await page.goto(mission());
    await st(page, "reply");
    await page.getByTestId("model-different").click();
    await page.getByTestId("stock-yes").click();
    await page.getByTestId("reply-submit").click();
    await expect(page.getByTestId("blocked")).toBeVisible();
    await expect(page.getByTestId("outcome-headline")).toContainText("مدل دیگری");
  });
});

test.describe("D · no response and no contact channel are reported truthfully", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("a shop without any public link: truthful notice, copy still works, no-response → follow-up and other sellers", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const row = dbRow<{ shop_id: string; product_id: string; offer_id: string }>("SELECT o.shop_id, o.product_id, o.offer_id FROM offers o JOIN shops s USING(shop_id) WHERE s.website_url IS NULL AND s.instagram_url IS NULL AND o.price_toman IS NOT NULL AND o.product_id = ? LIMIT 1", DAHUA);
    await page.goto(`/missions/new?product=${row.product_id}&shop=${row.shop_id}&offer=${row.offer_id}`);
    await st(page, "follow");
    await expect(page.getByTestId("no-channel")).toContainText("معتبری");
    await expect(page.getByText("راه ارتباطی تأییدشده‌ای وجود ندارد")).toBeVisible();
    await expect(page.locator('a[href^="tel:"], a[href^="sms:"], a[href*="wa.me"]')).toHaveCount(0);
    await st(page, "compose");
    await page.getByTestId("copy").click();
    await expect(page.getByTestId("status-badge")).toContainText("ارسال نشده");
    await st(page, "follow");
    await page.getByTestId("no-response").click();
    await st(page, "outcome");
    await expect(page.getByTestId("outcome-headline")).toHaveText("پاسخی نیامده");
    await expect(page.getByTestId("outcome-claim")).toContainText("بدون پاسخ");
    await expect(page.getByTestId("next-FIND_OTHER_SELLER")).toBeVisible();
    await page.getByTestId("next-FOLLOW_UP").click();
    await expect(page.getByTestId("draft")).toHaveValue(/دوباره مزاحم/);
    await st(page, "outcome");
    await expect(page.getByTestId("next-FIND_OTHER_SELLER")).toBeVisible(); // still offered after choosing the follow-up
  });
  test("clipboard denied → honest fallback, status stays a draft", async ({ page, context }) => {
    await context.clearPermissions();
    await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true }); });
    await page.goto(mission());
    await page.getByTestId("copy").click();
    await expect(page.getByTestId("live-msg")).toContainText("کپی خودکار انجام نشد");
    await expect(page.getByTestId("status-badge")).toHaveText("پیش‌نویس");
    await page.getByTestId("manual-copy-done").click();
    await expect(page.getByTestId("status-badge")).toContainText("ارسال نشده");
  });
  test("clipboard API missing entirely → same fallback", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); });
    await page.goto(mission());
    await page.getByTestId("copy").click();
    await expect(page.getByTestId("live-msg")).toContainText("کپی خودکار انجام نشد");
  });
});

test.describe("E · forged / invalid selections never produce a plausible inquiry", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const forged = (qs: string) => `/missions/new?${qs}`;
  for (const [name, qs, code] of [
    ["offer of another shop", `product=${DAHUA}&variant=${enc(DV)}&shop=${MID_B}&offer=${OFFER_A}`, "OFFER_MISMATCH"],
    ["unknown shop", `product=${DAHUA}&shop=shop_00000000000000000000dead`, "SHOP_NOT_FOUND"],
    ["unknown offer", `product=${DAHUA}&shop=${MID_A}&offer=offer_00000000000000000000dead`, "OFFER_NOT_FOUND"],
    ["unknown variant", `product=${DAHUA}&variant=${enc("unknown|NOPE")}&shop=${MID_A}&offer=${OFFER_A}`, "VARIANT_UNKNOWN"],
    ["malformed ids", `product=nope&shop=x&offer=y`, "INVALID_ID"],
    ["script in ids", `product=${enc("<script>alert(1)</script>")}&shop=${MID_A}`, "INVALID_ID"],
  ] as const) {
    test(`${name} → ${code}, with recovery links and no seller reply`, async ({ page }) => {
      await page.goto(forged(qs));
      await expect(page.getByTestId("inquiry-error")).toHaveAttribute("data-error", code);
      await expect(page.getByTestId("inquiry-workspace")).toHaveCount(0);
      await expect(page.getByTestId("draft")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "فروشگاه‌های اطراف" })).toBeVisible();
      await expect(page.getByRole("link", { name: "مقایسه‌ی فروشنده‌ها" })).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain("1200CLQP-IL-A"); // the other shop's offer title is NOT shown for this pair
    });
  }
  test("a shop with several offers asks which one (no silent pick)", async ({ page }) => {
    const multi = dbRow<{ p: string; s: string }>("SELECT product_id p, shop_id s FROM offers GROUP BY product_id, shop_id HAVING count(*) >= 3 LIMIT 1");
    await page.goto(`/missions/new?product=${multi.p}&shop=${multi.s}`);
    await expect(page.getByTestId("inquiry-error")).toHaveAttribute("data-error", "OFFER_REQUIRED");
    await page.getByTestId("offer-choices").getByRole("link").first().click();
    await expect(page.getByTestId("inquiry-workspace")).toBeVisible();
  });
  test("the generic Q&A without ids still works (Phase 1 behaviour)", async ({ page }) => {
    await page.goto("/missions/new");
    await expect(page.getByLabel("نام یا مدل کالا")).toBeVisible();
  });
});

test.describe("external public links and keyboard", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("a public https profile opens only on the user's click, in a new tab with noopener; nothing opens on load", async ({ page, context }) => {
    const row = dbRow<{ shop_id: string; product_id: string; offer_id: string; website_url: string }>("SELECT o.shop_id, o.product_id, o.offer_id, s.website_url FROM offers o JOIN shops s USING(shop_id) WHERE s.website_url LIKE 'https://%' LIMIT 1");
    const popups: string[] = [];
    context.on("page", (p) => popups.push(p.url()));
    await context.route((u) => /^https?:/.test(u.href) && u.hostname !== SELF_HOSTNAME, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>ext</title>" }));
    await page.goto(`/missions/new?product=${row.product_id}&shop=${row.shop_id}&offer=${row.offer_id}`);
    await page.waitForTimeout(400);
    expect(popups).toEqual([]);
    await st(page, "follow");
    const link = page.getByTestId("public-links").getByRole("link").first();
    await expect(link).toHaveAttribute("target", "_blank");
    expect(await link.getAttribute("rel")).toMatch(/noopener/);
    expect(await link.getAttribute("href")).toMatch(/^https:\/\//);
    const [pop] = await Promise.all([context.waitForEvent("page"), link.click()]);
    expect(pop.url()).toMatch(/^https:\/\//);
    await expect(page.getByTestId("public-links")).toContainText("تأییدشده");
  });
  test("keyboard only: tab to the copy button and press Enter; focus and live feedback are announced", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(mission());
    await page.getByTestId("draft").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("copy")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-msg")).toContainText("متن کپی شد");
    await expect(page.getByTestId("live-msg")).toHaveAttribute("aria-live", "polite");
    // reorder via keyboard-reachable buttons
    await st(page, "compose");
    if (await page.getByTestId("q-toggle").isVisible()) await page.getByTestId("q-toggle").click(); // question editor is one tap away on phones
    await page.getByRole("button", { name: "پایین بردن پرسش ۱" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("status-badge")).toHaveText("پیش‌نویس"); // editing the questions after a copy makes the copy outdated
  });
  test("reduced motion + 44px targets", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(mission());
    const where: Record<string, "compose" | "follow" | "reply"> = { copy: "compose", "mark-contacted": "follow", "no-response": "follow", "reply-submit": "reply", "mode-manual": "follow" };
    for (const id of ["copy", "mark-contacted", "no-response", "reply-submit", "mode-manual"]) {
      await st(page, where[id]!);
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.height, id).toBeGreaterThanOrEqual(43.5);
    }
  });
});

for (const vp of [{ w: 360, h: 800 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }]) {
  test.describe(`layout @ ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });
    const shot = async (page: Page, name: string) => {
      fs.mkdirSync(OUT, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: path.join(OUT, `inquiry-${name}-${vp.w}x${vp.h}.png`), fullPage: true });
    };
    test("workspace", async ({ page }) => { const e = collectErrors(page); await page.goto(mission()); await expect(page.getByTestId("draft")).toBeVisible(); await shot(page, "workspace"); expect(e).toEqual([]); });
    test("manual reply + decision", async ({ page }) => {
      await page.goto(mission());
      await st(page, "reply");
      await page.getByLabel(/قیمت امروزی/).fill("۴٬۶۰۰٬۰۰۰ تومان");
      await page.getByTestId("stock-yes").click();
      await page.getByTestId("model-same").click();
      await page.getByTestId("reply-submit").click();
      await expect(page.getByTestId("price-compare")).toBeVisible();
      await shot(page, "manual-decision");
    });
    test("demo", async ({ page }) => {
      await page.goto(mission());
      await st(page, "follow");
      await page.getByTestId("demo-consent").check();
      await page.getByTestId("mode-demo").click();
      await st(page, "reply");
      await page.getByTestId("scenario-PRICE_CHANGED").click();
      await page.getByTestId("demo-run").click();
      await expect(page.getByTestId("demo-message")).toHaveCount(2);
      await shot(page, "demo");
    });
    test("invalid selection", async ({ page }) => { await page.goto(`/missions/new?product=${DAHUA}&shop=${MID_B}&offer=${OFFER_A}`); await expect(page.getByTestId("inquiry-error")).toBeVisible(); await shot(page, "invalid"); });
  });
}
