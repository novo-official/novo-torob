/**
 * Phase 9 performance profile against a RUNNING production server (default http://127.0.0.1:3100, started with `npm run build && npx next start -p 3100`).
 *   BASE=http://127.0.0.1:3100 npx tsx scripts/perf-profile.ts      → docs/qa/perf-profile.json
 * «cold» = the first request after the server process started (DB open, prepared statements, module init); «warm» = 40 sequential requests.
 * The agent endpoint is measured with the MOCK planner only (no model, no network).
 */
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const P = "product_7308febc43c2f793fd0e1cf9", V = encodeURIComponent("unknown|HDW1200CLQP"), S1 = "shop_8670c71ca3baff62d68de422", S2 = "shop_350520090b6a5a6163f919d3";
const STATE = { v: 1, stage: 1, text: "", category: null, answers: {}, skipped: [], budget: { min: null, max: null }, constraints: { hard: [], soft: [] }, model: null, selection: null, origin: null, radius: 1000, priority: "price", visit: null, seen: { products: [], shops: [] }, selectedShopIds: [], selectedOffer: null, externalEvidence: false };
const CASES: Array<{ name: string; req: () => Promise<Response> }> = [
  { name: "search (FTS5)", req: () => fetch(`${BASE}/api/search?q=${encodeURIComponent("هدفون بی‌سیم ورزشی")}`) },
  { name: "search exact model", req: () => fetch(`${BASE}/api/search?q=hdw1200clqp`) },
  { name: "advisor (headphones, budget)", req: () => fetch(`${BASE}/api/advisor?category=${encodeURIComponent("هدفون، هدست و هندزفری")}&a.use=sport&a.connection=wireless&bmax=4000000&show=1`) },
  { name: "sellers (R-Tree, 3 km)", req: () => fetch(`${BASE}/api/sellers?product=${P}&variant=${V}&o=ferdowsi&r=3000`) },
  { name: "compare sellers (3)", req: () => fetch(`${BASE}/api/compare/sellers?product=${P}&variant=${V}&shops=${S1},${S2}&o=ferdowsi`) },
  { name: "mission facts", req: () => fetch(`${BASE}/api/missions/facts?product=${P}&variant=${V}&shop=${S1}&offer=offer_742932354aecd83d7fc7c266&visit=2026-10-24T11:00`) },
  { name: "mission recovery plan", req: () => fetch(`${BASE}/api/missions/recovery?trigger=UNAVAILABLE&product=${P}&variant=${V}&shop=${S1}&offer=offer_742932354aecd83d7fc7c266&district=ferdowsi&radius=1000`) },
  { name: "agent turn (mock): exact model", req: () => fetch(`${BASE}/api/agent/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "دوربین HDW1200CLQP", state: STATE }) }) },
];
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! * 10) / 10; };

async function main() {
  const out: Record<string, { status: number; coldMs: number; warm: { n: number; p50: number; p95: number; max: number } }> = {};
  for (const c of CASES) {
    const t0 = performance.now(); const r0 = await c.req(); await r0.arrayBuffer(); const cold = performance.now() - t0;
    const ms: number[] = [];
    for (let i = 0; i < 40; i++) { const t = performance.now(); const r = await c.req(); await r.arrayBuffer(); ms.push(performance.now() - t); }
    out[c.name] = { status: r0.status, coldMs: Math.round(cold * 10) / 10, warm: { n: ms.length, p50: pct(ms, 50), p95: pct(ms, 95), max: Math.round(Math.max(...ms) * 10) / 10 } };
    console.log(c.name.padEnd(34), r0.status, `cold ${out[c.name]!.coldMs}ms`, `warm p50 ${out[c.name]!.warm.p50} p95 ${out[c.name]!.warm.p95}`);
  }
  fs.mkdirSync("docs/qa", { recursive: true });
  fs.writeFileSync("docs/qa/perf-profile.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, note: "cold = first request of the freshly started server (cases run in the listed order, so later cold numbers include only their own first-call costs)", results: out }, null, 2));
}
void main();
