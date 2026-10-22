/**
 * Runs the Phase 7 evaluation corpus on the deterministic MOCK planner against data/app.sqlite and writes
 * docs/qa/agent-eval-mock.json. No network, no paid API. Live-model metrics are NOT produced (NOT LIVE VERIFIED).
 *   npm run agent:eval            (all)       npm run agent:eval -- S05 S07   (subset)
 */
import fs from "node:fs";
import path from "node:path";
import { openRealDb } from "../tests/helpers/real-db";
import { runEval } from "../src/server/agent/eval/run";

async function main() {
  const db = openRealDb();
  if (!db) { console.error("data/app.sqlite (full dataset) is required: npm run db:import"); process.exit(2); }
  const only = process.argv.slice(2).filter((a) => /^S\d+$/.test(a));
  const r = await runEval(db, only.length ? only : undefined);
  for (const x of r.results) console.log(`${x.passed ? "PASS" : "FAIL"} ${x.id} [cat ${x.cat}/${x.stage}] ${x.titleFa}${x.passed ? "" : "\n     " + (x.error ?? x.checks.filter((c) => !c.ok).map((c) => `${c.metric}: ${c.note}`).join("; "))}`);
  const summary = { ...r, results: undefined };
  console.log("\n" + JSON.stringify(summary, null, 2));
  if (!only.length) {
    const out = path.resolve("docs/qa/agent-eval-mock.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), ...r }, null, 2));
    console.log(`\nwrote ${path.relative(process.cwd(), out)}`);
  }
  process.exit(r.scenariosPassed === r.scenarios ? 0 : 1);
}
void main();
