import { defineConfig } from "@playwright/test";

// Dedicated synthetic catalog: no dependency on the real dataset, no writes to data/app.sqlite.
const port = Number(process.env.SEARCH_QA_PORT ?? 3114);
export default defineConfig({
  testDir: "./e2e",
  testMatch: "search-experience.spec.ts",
  timeout: 45_000,
  workers: 2,
  reporter: [["list"]],
  projects: [{ name: "search-fixture", metadata: { syntheticCatalog: true } }],
  use: { baseURL: `http://127.0.0.1:${port}`, channel: "chrome", locale: "fa-IR", timezoneId: "Asia/Tehran" },
  webServer: {
    command: `node --import tsx scripts/qa-search-fixture.ts && npm run start -- -p ${port} -H 127.0.0.1`,
    env: { DATABASE_PATH: ".cache/qa-search/catalog.sqlite", AGENT_PROVIDER: "mock" },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
