import fs from "node:fs";
import path from "node:path";
import { collectErrors, DAHUA, expectNoHorizontalOverflow, HAS_DB, HP, test } from "./helpers";

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
];
const enc = encodeURIComponent;
const PAGES: Array<[string, string, boolean]> = [
  ["home", "/", false],
  ["discover-need", "/discover", true],
  ["discover-question", `/discover?cat=${enc(HP)}`, true],
  ["discover-budget", `/discover?cat=${enc(HP)}&a.use=sport&a.connection=wireless`, true],
  ["discover-results", `/discover?cat=${enc(HP)}&a.use=sport&a.connection=wireless&bmin=1000000&bmax=4000000`, true],
  ["discover-clarify", `/discover?text=${enc("دوربین برای مغازه")}`, true],
  ["discover-recovery", `/discover?cat=${enc("دوربین مدار بسته")}&a.environment=outdoor&a.night=yes&bmax=50000&show=1`, true],
  ["search-results", `/search?q=${enc("هدفن بیسیم")}`, true],
  ["search-model", "/search?q=hdw1200clqp", true],
  ["search-invalid", `/search?q=${enc("و با")}`, true],
  ["product", `/products/${DAHUA}`, true],
  ["compare-handoff", `/compare?product=${DAHUA}`, true],
  ["mission", "/missions/new", false],
  ["data", "/data", false],
  // Phase 9: whole-product sweep (assistant, missions, sellers, seller comparison, inquiry with context)
  ["assistant", "/assistant", true],
  ["missions-hub", "/missions", false],
  ["sellers-list", `/sellers?product=${DAHUA}&variant=${enc("unknown|HDW1200CLQP")}&r=3000`, true],
  ["compare-sellers", `/compare?product=${DAHUA}&variant=${enc("unknown|HDW1200CLQP")}&shops=shop_8670c71ca3baff62d68de422,shop_350520090b6a5a6163f919d3`, true],
  ["inquiry-context", `/missions/new?product=${DAHUA}&variant=${enc("unknown|HDW1200CLQP")}&shop=shop_8670c71ca3baff62d68de422&offer=offer_742932354aecd83d7fc7c266&visit=2026-10-24T11:00`, true],
  ["mission-start", `/missions/start?product=${DAHUA}&variant=${enc("unknown|HDW1200CLQP")}&shop=shop_8670c71ca3baff62d68de422&offer=offer_742932354aecd83d7fc7c266&visit=2026-10-24T11:00`, true],
];
const OUT = path.resolve(process.cwd(), "docs/qa");

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const [name, url, needsDb] of PAGES) {
      test(`${name} @ ${vp.name}`, async ({ page }) => {
        test.skip(needsDb && !HAS_DB, "needs data/app.sqlite");
        fs.mkdirSync(OUT, { recursive: true });
        const errors = collectErrors(page);
        await page.goto(url);
        await page.evaluate(() => document.fonts.ready);
        if (name === "mission-start") await page.getByTestId("mission-price").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(700);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: path.join(OUT, `${name}-${vp.name}.png`), fullPage: true });
        if (errors.length) throw new Error(errors.join("\n"));
      });
    }
  });
}
