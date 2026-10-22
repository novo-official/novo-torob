import fs from "node:fs";
import path from "node:path";
import { resolveDbPath } from "@/server/db/connect";
import { abortCleanup, runImport } from "@/server/import/run";
import type { SourceSpec } from "@/server/import/sources";

/**
 * Usage:
 *   npm run db:import                         # .data/torob-dataset.zip  →  data/app.sqlite
 *   npm run db:import -- --zip <file.zip>
 *   npm run db:import -- --dir <dir with products/offers/shops.csv>
 *   npm run db:import -- --fixture            # tests/fixtures/csv (synthetic, safe for CI)
 *   npm run db:import -- --out <db path>      # default: $DATABASE_PATH or data/app.sqlite
 */
const args = process.argv.slice(2);
const val = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

let source: SourceSpec;
if (args.includes("--fixture")) source = { kind: "fixture", path: path.resolve("tests/fixtures/csv") };
else if (val("--dir")) source = { kind: "dir", path: path.resolve(val("--dir")!) };
else source = { kind: "zip", path: path.resolve(val("--zip") ?? ".data/torob-dataset.zip") };

const outPath = val("--out") ? path.resolve(val("--out")!) : resolveDbPath();
if (source.kind !== "fixture" && !fs.existsSync(source.path)) {
  console.error(`Source not found: ${source.path}`);
  process.exit(2);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    abortCleanup();
    console.error(`\n${sig}: import aborted, staging file removed, previous database untouched.`);
    process.exit(130);
  });
}

console.log(`Importing ${source.kind}: ${source.path}\n   → ${outPath}`);
runImport({ source, outPath, log: (m) => console.log(m), allowOrphans: args.includes("--allow-orphans") })
  .then((r) => {
    console.log(`\nDONE in ${(r.durationMs / 1000).toFixed(1)} s · DB ${(r.dbBytes / 1024 ** 2).toFixed(1)} MiB · SQLite ${r.sqliteVersion}`);
    console.log("rows stored:", r.rowsStored, "orphans:", r.orphans);
    console.log("flags:", r.flagCounts);
    console.log("price evidence:", r.priceEvidence);
  })
  .catch((e) => {
    console.error(`\nIMPORT FAILED: ${e instanceof Error ? e.message : e}\nThe previous database (if any) was left untouched.`);
    process.exit(1);
  });
