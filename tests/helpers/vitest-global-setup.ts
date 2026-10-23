import { BLOCKED_BANNER, probeCatalog } from "./real-catalog";

/** Conspicuous gate: dataset-backed unit tests skip without the real catalog; a run with this banner is not a full pass. */
export default function setup() {
  const s = probeCatalog();
  if (s.real) console.log(`\nREAL CATALOG: ${s.path} (${s.products} products) — dataset-backed unit tests will run.\n`);
  else {
    console.warn(BLOCKED_BANNER(s));
    if (process.env.REQUIRE_REAL_CATALOG === "1") throw new Error(`REQUIRE_REAL_CATALOG=1 but the real catalog is unavailable: ${s.reason}`);
  }
}
