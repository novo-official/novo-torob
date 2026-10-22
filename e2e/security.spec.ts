import { DAHUA, expect, HAS_DB, test } from "./helpers";
import type { Page } from "@playwright/test";

const enc = encodeURIComponent;
const DV = "unknown|HDW1200CLQP", SHOP = "shop_8670c71ca3baff62d68de422", OFFER = "offer_742932354aecd83d7fc7c266";

test.describe("security headers and CSP", () => {
  for (const path of ["/", "/assistant", "/missions", "/no-such-page", "/api/health", "/api/agent/status"]) {
    test(`${path} carries the hardening headers`, async ({ request }) => {
      const r = await request.get(path);
      const h = r.headers();
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"]).toMatch(/geolocation=\(self\)/); expect(h["permissions-policy"]).toMatch(/camera=\(\)/);
      const csp = h["content-security-policy"]!;
      for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'"]) expect(csp, d).toContain(d);
      expect(csp).not.toMatch(/unsafe-eval|\*\s*;|default-src \*/);
      expect(csp, "scripts need the per-request nonce").toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{16,}' 'strict-dynamic'/);
      expect(csp.match(/script-src[^;]*/)![0]).not.toContain("unsafe-inline");
      // styles: default keeps unsafe-inline; CSP_STRICT_STYLES=1 (opt-in) requires the nonce for <style> and leaves only style ATTRIBUTES inline
      if (process.env.CSP_STRICT_STYLES === "1") { expect(csp).toMatch(/style-src 'self' 'nonce-[^']+';/); expect(csp).toContain("style-src-attr 'unsafe-inline'"); expect(csp.match(/style-src [^;]*/)![0]).not.toContain("unsafe-inline"); }
      else expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(h["x-powered-by"]).toBeUndefined();
    });
  }
  test("the nonce is fresh per request and Next stamps every inline script with it", async ({ request }) => {
    const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)![1]!;
    const a = await request.get("/"), b = await request.get("/");
    const na = nonceOf(a.headers()["content-security-policy"]!), nb = nonceOf(b.headers()["content-security-policy"]!);
    expect(na).not.toBe(nb);
    const html = await a.text();
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].map((m) => m[1]!);
    expect(inline.length).toBeGreaterThan(0);
    for (const attrs of inline) expect(attrs, "inline script without nonce").toContain(`nonce="${na}"`);
  });
  test("no CSP violation on the main routes and journeys (map tiles/photos are stubbed hosts that the policy allows)", async ({ page }) => {
    test.skip(!HAS_DB, "needs data/app.sqlite");
    await page.addInitScript(() => { (window as unknown as { __csp: string[] }).__csp = []; document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    const seen: string[] = [];
    for (const u of ["/", "/assistant", "/discover", "/search?q=هدفون", `/products/${DAHUA}`, `/sellers?product=${DAHUA}&variant=${enc(DV)}`, `/compare?product=${DAHUA}&variant=${enc(DV)}&shops=${SHOP}`, `/missions/new?product=${DAHUA}&variant=${enc(DV)}&shop=${SHOP}&offer=${OFFER}`, "/missions", "/data", `/missions/start?product=${DAHUA}&variant=${enc(DV)}&shop=${SHOP}&offer=${OFFER}`]) {
      await page.goto(u);
      await page.waitForTimeout(700);
      if (u.startsWith("/missions/start")) { await expect(page.getByTestId("mission-price")).toBeVisible({ timeout: 20_000 }); for (const t of ["visit", "inquiry", "recover", "device"]) { await page.getByTestId(`tab-${t}-btn`).click(); await page.waitForTimeout(400); } }
      seen.push(...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).map((v) => `${u}: ${v}`));
    }
    expect(seen).toEqual([]);
  });
});

const noDialog = (page: Page) => { const d: string[] = []; page.on("dialog", (x) => { d.push(x.message()); void x.dismiss(); }); return d; };
test.describe("DOM XSS and open redirect", () => {
  const PAYLOADS = [`<img src=x onerror=alert(1)>`, `"><script>alert(2)</script>`, `javascript:alert(3)`, `</title><svg onload=alert(4)>`];
  test("hostile text in query strings and the assistant input is rendered as inert text", async ({ page }) => {
    const dialogs = noDialog(page);
    for (const p of PAYLOADS) {
      for (const u of [`/search?q=${enc(p)}`, `/discover?text=${enc(p)}`, `/missions/new?product=${enc(p)}&shop=${enc(p)}`, `/sellers?product=${enc(p)}`, `/compare?product=${enc(p)}`, `/products/${enc(p)}`]) {
        await page.goto(u);
        // the hostile text may appear inside Next's inert JSON payload script, but never as a live element or handler
        expect(await page.locator("img[src='x'], svg[onload], [onerror], [onload]").count(), u).toBe(0);
        expect(await page.locator("script:not([src])").evaluateAll((els) => els.filter((e) => /alert\(/.test(e.textContent ?? "") && !/__next_f|self\.__next/.test(e.textContent ?? "")).length), u).toBe(0);
      }
    }
    await page.goto("/assistant"); await page.evaluate(() => sessionStorage.clear()); await page.reload();
    await page.getByTestId("agent-input").fill(PAYLOADS[0]!); await page.getByTestId("agent-send").click();
    await expect(page.getByTestId("agent-assistant-msg")).toHaveCount(1, { timeout: 30_000 });
    expect(await page.locator("img[src='x']").count()).toBe(0);
    expect(dialogs).toEqual([]);
  });
  test("back / redirect parameters can never point off-site", async ({ page }) => {
    test.skip(!HAS_DB, "needs data/app.sqlite");
    for (const bad of ["//evil.example/x", "https://evil.example/", "javascript:alert(1)", "/\\evil.example", "/compare@evil.example", "///evil.example"]) {
      await page.goto(`/missions/new?product=${DAHUA}&variant=${enc(DV)}&shop=${SHOP}&offer=${OFFER}&back=${enc(bad)}`);
      const hrefs = await page.locator("a[href]").evaluateAll((a) => a.map((x) => (x as HTMLAnchorElement).getAttribute("href") ?? ""));
      for (const h of hrefs) expect(h, bad).not.toMatch(/evil\.example|^javascript:|^\/\/|^\/\\/i);
      await page.goto(`/compare?product=${DAHUA}&variant=${enc(DV)}&shops=${SHOP}&back=${enc(bad)}`);
      for (const h of await page.locator("a[href]").evaluateAll((a) => a.map((x) => (x as HTMLAnchorElement).getAttribute("href") ?? ""))) expect(h, bad).not.toMatch(/evil\.example|^javascript:|^\/\/|^\/\\/i);
    }
  });
});
