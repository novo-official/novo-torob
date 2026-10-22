import { defineConfig } from "@playwright/test";

// Dedicated fixture for Assistant, Inquiry, Missions, Data and Product QA.
const port = Number(process.env.ASSISTANT_QA_PORT ?? 3116);
export default defineConfig({
  testDir: "./e2e",
  testMatch: "assistant-missions.spec.ts",
  timeout: 45_000,
  workers: 1,
  reporter: [["list"]],
  projects: [{ name: "assistant-fixture", metadata: { syntheticCatalog: true } }],
  use: { baseURL: `http://127.0.0.1:${port}`, channel: "chrome", locale: "fa-IR", timezoneId: "Asia/Tehran" },
  webServer: {
    command: `node --import tsx scripts/qa-sellers-fixture.ts && npm run start -- -p ${port} -H 127.0.0.1`,
    env: { DATABASE_PATH: ".cache/qa-sellers/catalog.sqlite", AGENT_PROVIDER: "mock" },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
