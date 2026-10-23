import { BLOCKED_BANNER, probeCatalog } from "../tests/helpers/real-catalog";

/** Makes a missing real catalog impossible to miss. REQUIRE_REAL_CATALOG=1 (used by scripts/release-gate.sh) turns it into a hard failure. */
export default function globalSetup() {
  if (process.env.SMOKE_BASE_URL) return; // remote smoke: no local catalog involved
  const s = probeCatalog();
  if (s.real) {
    console.log(`\nREAL CATALOG: ${s.path} (${s.products} products) — dataset-backed specs will run.\n`);
    return;
  }
  console.warn(BLOCKED_BANNER(s));
  if (process.env.REQUIRE_REAL_CATALOG === "1") throw new Error(`REQUIRE_REAL_CATALOG=1 but the real catalog is unavailable: ${s.reason}`);
}
