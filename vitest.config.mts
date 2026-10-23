import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    globalSetup: ["./tests/helpers/vitest-global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Real-catalog tests take ~4-5 s on an idle machine (measured), i.e. almost the 5 s default; under CPU contention they timed out (qa-artifacts/flake). Not a logic flake.
    testTimeout: 30_000,
    css: false,
  },
});
