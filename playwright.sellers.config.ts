import { defineConfig } from "@playwright/test";

// Dedicated synthetic catalog for Sellers, Shops, and Compare QA.
const port = Number(process.env.SELLERS_QA_PORT ?? 3115);
export default defineConfig({
  testDir: "./e2e",
  testMatch: "sellers-experience.spec.ts",
  timeout: 45_000,
  workers: 2,
  reporter: [["list"]],
  projects: [{ name: "sellers-fixture", metadata: { syntheticCatalog: true } }],
  use: { baseURL: `http://127.0.0.1:${port}`, channel: "chrome", locale: "fa-IR", timezoneId: "Asia/Tehran" },
  webServer: {
    command: `node --import tsx scripts/qa-sellers-fixture.ts && npm run start -- -p ${port} -H 127.0.0.1`,
    env: { DATABASE_PATH: ".cache/qa-sellers/catalog.sqlite", AGENT_PROVIDER: "mock" },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
