import fs from "node:fs";
import { DAHUA, expect, HAS_DB, HP, test } from "./helpers";

/**
 * Browser-side load metrics (Chrome, local production build, desktop CPU, no network throttling, images/tiles stubbed):
 * TTFB, FCP, LCP, CLS, DOM-ready and load. This is NOT Lighthouse (not installed; no dependency added) and NOT a field measurement.
 */
const enc = encodeURIComponent;
const PAGES: Array<[string, string]> = [
  ["home", "/"], ["assistant", "/assistant"], ["discover-results", `/discover?cat=${enc(HP)}&a.use=sport&a.connection=wireless&bmin=1000000&bmax=4000000`],
  ["search", `/search?q=${enc("هدفون بی‌سیم")}`], ["product", `/products/${DAHUA}`], ["sellers", `/sellers?product=${DAHUA}&variant=${enc("unknown|HDW1200CLQP")}&r=3000`],
  ["compare", `/compare?product=${DAHUA}&variant=${enc("unknown|HDW1200CLQP")}&shops=shop_8670c71ca3baff62d68de422,shop_350520090b6a5a6163f919d3`],
  ["inquiry", `/missions/new?product=${DAHUA}&variant=${enc("unknown|HDW1200CLQP")}&shop=shop_8670c71ca3baff62d68de422&offer=offer_742932354aecd83d7fc7c266`], ["missions", "/missions"],
];
test("page-load metrics on the production build (390×844 and 1440×900)", async ({ browser }) => {
  test.skip(!HAS_DB, "needs data/app.sqlite");
  test.setTimeout(240_000);
  const out: Record<string, Record<string, { ttfb: number; fcp: number; lcp: number; cls: number; domReady: number; load: number }>> = {};
  for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, locale: "fa-IR", timezoneId: "Asia/Tehran" });
    await ctx.route("https://image.torob.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) }));
    await ctx.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) }));
    out[`${vp.w}`] = {};
    for (const [name, url] of PAGES) {
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        const w = window as unknown as { __m: { lcp: number; cls: number } }; w.__m = { lcp: 0, cls: 0 };
        new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__m.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) w.__m.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(url, { waitUntil: "load" });
      await page.waitForTimeout(1200);
      const m = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
        const w = window as unknown as { __m: { lcp: number; cls: number } };
        return { ttfb: nav.responseStart, fcp, lcp: w.__m.lcp, cls: Math.round(w.__m.cls * 1000) / 1000, domReady: nav.domContentLoadedEventEnd, load: nav.loadEventEnd };
      });
      out[`${vp.w}`]![name] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 10) / 10])) as never;
      expect(m.cls, `${name}@${vp.w} layout shift`).toBeLessThan(0.1);
      expect(m.lcp, `${name}@${vp.w} LCP`).toBeLessThan(2500);
      await page.close();
    }
    await ctx.close();
  }
  fs.writeFileSync("docs/qa/browser-perf.json", JSON.stringify({ at: new Date().toISOString(), note: "Chrome, local production build, no throttling, photos/tiles stubbed; not Lighthouse, not field data", metrics: out }, null, 2));
});
