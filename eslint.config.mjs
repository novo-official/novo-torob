import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // SQLite and the server data layer must never reach client bundles.
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}", "src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "node:sqlite", message: "Server-only." }], patterns: [{ group: ["@/server", "@/server/*"], message: "Server-only code: import it from route handlers or scripts, not from client-reachable modules." }] }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**", "playwright-report/**", "test-results/**", "coverage/**"]),
]);
