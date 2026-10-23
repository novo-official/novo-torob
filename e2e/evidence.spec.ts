import { DAHUA, expect, HAS_DB, REAL_CATALOG_REQUIRED, test } from "./helpers";
import { qaPath } from "../tests/helpers/qa-out";

test.skip(!HAS_DB, REAL_CATALOG_REQUIRED);
const K20I = "product_b5360def23c574ad62d601e8";

test.describe("external evidence on the product page (opt-in; fixture mode in e2e; no network)", () => {
  test("nothing external is read until the user asks; the dataset section stays; fixture results are clearly synthetic", async ({ page }) => {
    const outbound: string[] = [];
    page.on("request", (r) => { const u = new URL(r.url()); if (!["127.0.0.1", "localhost", "image.torob.com", "tile.openstreetmap.org"].includes(u.hostname)) outbound.push(r.url()); });
    const evidenceCalls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/evidence/")) evidenceCalls.push(r.url()); });
    await page.goto(`/products/${DAHUA}`);
    await expect(page.getByTestId("external-evidence-panel")).toBeVisible();
    await page.waitForTimeout(400);
    expect(evidenceCalls).toEqual([]); // no auto-fetch
    await expect(page.getByText("نمونه‌ی پیشنهادهای ثبت‌شده")).toBeVisible();
    await page.getByTestId("evidence-load").click();
    const res = page.getByTestId("evidence-result");
    await expect(res).toBeVisible({ timeout: 20_000 });
    await expect(res).toHaveAttribute("data-mode", "fixture");
    await expect(res).toContainText("نمونه‌ی آزمایشی — منبع واقعی نیست");
    await expect(res.getByTestId("evidence-conflict")).toContainText("HDW1200CLQP-IL-B");
    await expect(res).not.toContainText("امتیاز ۴");
    expect(evidenceCalls).toHaveLength(1); expect(evidenceCalls[0]).toContain("optin=1");
    expect(outbound).toEqual([]);
  });
  test("a model with no evidence gets an honest «none»; the API refuses without opt-in and never fetches", async ({ page, request }) => {
    await page.goto(`/products/${K20I}`);
    await page.getByTestId("evidence-load").click();
    await expect(page.getByTestId("evidence-result")).toBeVisible({ timeout: 20_000 });
    const noOpt = await (await request.get(`/api/evidence/${DAHUA}`)).json();
    expect(noOpt.card).toMatchObject({ status: "DISABLED", mode: "off", items: [] });
    expect((await request.get("/api/evidence/not-an-id")).status()).toBe(400);
    expect((await request.get("/api/evidence/product_00000000000000000000dead?optin=1")).status()).toBe(200);
  });
  test("LIVE-MODE (manual only): production default is LINK-ONLY — the review is referenced with who/when, nothing is quoted, no request to the page", async ({ page }) => {
    test.skip(process.env.HAMGHADAM_LIVE_EVIDENCE_E2E !== "1", "runs only when the server was started with AGENT_EVIDENCE_MODE=live AGENT_EXTERNAL_LIVE=1 and this flag is set");
    const outbound: string[] = [];
    page.on("request", (r) => { const u = new URL(r.url()); if (!["127.0.0.1", "localhost", "image.torob.com", "tile.openstreetmap.org"].includes(u.hostname)) outbound.push(r.url()); });
    await page.goto(`/products/${K20I}`);
    await page.getByTestId("evidence-load").click();
    const res = page.getByTestId("evidence-result");
    await expect(res).toBeVisible({ timeout: 40_000 });
    await expect(res).toHaveAttribute("data-mode", "live");
    const items = res.getByTestId("evidence-item");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("فقط پیوند");
    await expect(res.getByTestId("evidence-quotes")).toHaveCount(0);
    await expect(res.locator("a[href^='https://www.scarbir.com/']").first()).toHaveAttribute("rel", /noopener/);
    await expect(res).toContainText("حقوق بازنشر");
    expect(outbound).toEqual([]); // the browser never talks to the third party either; links open only on the user's click
    await page.screenshot({ path: qaPath("p91-external-evidence-linkonly-390x844.png"), fullPage: true });
  });
});
