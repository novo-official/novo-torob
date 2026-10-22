/**
 * MANUAL live check of the reviewed external-evidence registry (Phase 9). Never run by tests/CI/boot.
 *   HAMGHADAM_LIVE_EVIDENCE_CHECK=1 npx tsx scripts/evidence-live-check.ts [product_id]
 * Performs, per reviewed source: ONE robots.txt GET (cached) and ONE page GET (read-only, no login, no model, no key) and writes the
 * validated result (short quotes + citations, NO prices/availability) to docs/qa/external-evidence-live-check.json.
 */
import fs from "node:fs";
import path from "node:path";
import { openRealDb } from "../tests/helpers/real-db";
import { buildEvidenceCard } from "../src/server/agent/evidence/card";
import { getExternalEvidence } from "../src/server/agent/evidence/service";

const K20I = "product_b5360def23c574ad62d601e8";
async function main() {
  if (process.env.HAMGHADAM_LIVE_EVIDENCE_CHECK !== "1") { console.error("refusing to run: set HAMGHADAM_LIVE_EVIDENCE_CHECK=1 (this makes real, read-only HTTP requests to the reviewed public pages)"); process.exit(2); }
  const db = openRealDb();
  if (!db) { console.error("data/app.sqlite required"); process.exit(2); }
  const productId = process.argv[2] ?? K20I;
  const t0 = Date.now();
  const r = await getExternalEvidence(db, productId, { mode: "live", reproduce: process.env.AGENT_EVIDENCE_REPRODUCE === "1" });
  // (the manufacturer entry is registry-blocked; this script does not retry it — see docs/phase-9-quality.md)
  const card = buildEvidenceCard(productId, r, "live");
  const out = { checkedAt: new Date().toISOString(), productId, ms: Date.now() - t0, status: r.status, adapters: r.adapters, rejected: r.rejected, conflicts: r.conflicts, notes: r.notes, items: card.items };
  fs.mkdirSync("docs/qa", { recursive: true });
  fs.writeFileSync(path.resolve("docs/qa/external-evidence-live-check.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ status: out.status, ms: out.ms, adapters: out.adapters, items: out.items.map((i) => ({ id: i.id, kind: i.kind, host: i.sourceHost, url: i.url, match: i.matchText, quotes: i.quotes.length })) }, null, 1));
  process.exit(r.status === "NO_EVIDENCE" ? 1 : 0);
}
void main();
