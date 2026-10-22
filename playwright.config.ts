import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
// Post-deployment smoke (read-only specs only, see docs/deployment-packet.md §9): SMOKE_BASE_URL=https://… runs against an already-deployed instance and starts no local server.
const REMOTE = process.env.SMOKE_BASE_URL;

// Uses the system Google Chrome (channel "chrome"); no browser download is performed.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: REMOTE ?? `http://127.0.0.1:${PORT}`,
    channel: "chrome",
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
  },
  webServer: REMOTE ? undefined : {
    command: `npm run build && npm run start -- -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Phase 7: deterministic mock planner, explicitly-labelled evidence FIXTURES, no paid API; high rate limit so journeys are not throttled
    env: { AGENT_PROVIDER: "mock", AGENT_EVIDENCE_MODE: "fixture", AGENT_RATE_PER_MIN: "600" },
    timeout: 240_000,
  },
});
