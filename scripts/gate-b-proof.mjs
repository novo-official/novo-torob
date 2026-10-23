// Gate B proof (zero-cost): runs the BUILT standalone server under several provider environments with FAKE secrets and a local TCP sink
// standing in for an "LLM host". Proves: live-looking / malformed / expired / forged handshakes never open a connection, labels are honest,
// cache/CSP/CSRF headers behave, and the fake key never appears in responses, logs or the client bundle.
// Usage: node scripts/gate-b-proof.mjs   (needs `npm run build` first). Writes qa-artifacts/gate-b-proof.json (git-ignored). No paid/network calls.
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB = process.env.DATABASE_PATH || path.join(ROOT, "data/app.sqlite");
const FAKE_KEY = "sk-FAKE-gate-b-0000000000000000";
const out = { at: new Date().toISOString(), note: "FAKE secrets, local sink only; no outbound LLM request is possible", variants: [], headers: {}, csrf: {}, bundle: {} };
let sinkHits = 0;
const sink = net.createServer((s) => { sinkHits++; s.destroy(); });
await new Promise((r) => sink.listen(9099, "127.0.0.1", r));

async function withServer(env, port, fn) {
  const logs = [];
  const child = spawn("node", ["server.js"], { cwd: path.join(ROOT, ".next/standalone"), env: { PATH: process.env.PATH, PORT: String(port), HOSTNAME: "127.0.0.1", DATABASE_PATH: DB, NODE_ENV: "production", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => logs.push(String(d))); child.stderr.on("data", (d) => logs.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  try { return await fn(base, logs); } finally { child.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 300)); }
}
const turn = (base, headers = {}) => fetch(base + "/api/agent/turn", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ message: "سلام", state: null }) });
const future = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const live = { AGENT_PROVIDER: "openai-compatible", AGENT_BASE_URL: "https://127.0.0.1:9099/v1", AGENT_API_KEY: FAKE_KEY, AGENT_MODEL: "fake-model", AGENT_LIVE_APPROVAL: "APPROVED-ABCDEFGH12", AGENT_LIVE_MAX_REQUESTS: "5", AGENT_LIVE_MAX_USD: "0.2", AGENT_LIVE_MAX_TOKENS: "300", AGENT_LIVE_MAX_INPUT_TOKENS: "4000", AGENT_LIVE_APPROVAL_EXPIRES: future(2), AGENT_LIVE_ALLOW_BASE_URL: "https://127.0.0.1:9099/v1", AGENT_LIVE_ALLOW_MODEL: "fake-model", AGENT_LIVE_PRICE_IN_PER_M: "1", AGENT_LIVE_PRICE_OUT_PER_M: "2" };
const variants = {
  "live-looking-complete (all conditions but the code lock)": live,
  "malformed approval id": { ...live, AGENT_LIVE_APPROVAL: "APPROVED-x" },
  "forged shape (lowercase)": { ...live, AGENT_LIVE_APPROVAL: "approved-abcdefgh12" },
  "expired approval": { ...live, AGENT_LIVE_APPROVAL_EXPIRES: future(-1) },
  "approval valid for > 72 h": { ...live, AGENT_LIVE_APPROVAL_EXPIRES: future(24 * 30) },
  "kill switch engaged": { ...live, AGENT_LIVE_KILL: "1" },
  "model not allowlisted": { ...live, AGENT_LIVE_ALLOW_MODEL: "other" },
  "key only (no approval at all)": { AGENT_PROVIDER: "openai-compatible", AGENT_BASE_URL: live.AGENT_BASE_URL, AGENT_API_KEY: FAKE_KEY, AGENT_MODEL: "fake-model" },
};
let port = 3200;
const allLogs = [];
for (const [name, env] of Object.entries(variants)) {
  const before = sinkHits;
  const r = await withServer(env, port++, async (base, logs) => {
    const codes = [];
    for (let i = 0; i < 3; i++) { const res = await turn(base); const j = await res.json(); codes.push([res.status, j.error]); if (JSON.stringify(j).includes(FAKE_KEY)) throw new Error("key leaked"); }
    const st = await (await fetch(base + "/api/agent/status")).json();
    const html = await (await fetch(base + "/assistant")).text();
    allLogs.push(...logs);
    return { turn: codes, statusEnabled: st.enabled, providerId: st.provider.id, isLanguageModel: st.provider.isLanguageModel, uiLocked: /data-testid="agent-disabled"/.test(html), uiNoMockFallback: !/data-provider="mock"/.test(html) };
  });
  out.variants.push({ name, ...r, sinkConnections: sinkHits - before });
}
// honest labels for the two non-live modes
for (const [name, env] of [["mock (explicit)", { AGENT_PROVIDER: "mock" }], ["disabled", { AGENT_PROVIDER: "disabled" }]]) {
  const r = await withServer(env, port++, async (base, logs) => {
    const st = await (await fetch(base + "/api/agent/status")).json();
    const html = await (await fetch(base + "/assistant")).text();
    const t = await turn(base);
    allLogs.push(...logs);
    return { statusEnabled: st.enabled, providerId: st.provider.id, labelFa: st.provider.labelFa, isLanguageModel: st.provider.isLanguageModel, turnStatus: t.status, uiBannerProvider: (html.match(/data-testid="agent-provider" data-provider="([^"]+)"/) ?? [])[1] ?? null, uiDisabledCard: /data-testid="agent-disabled"/.test(html) };
  });
  out.variants.push({ name, ...r, sinkConnections: 0 });
}
// headers / CSP / CSRF on the default (mock) build
await withServer({ AGENT_PROVIDER: "mock", AGENT_RATE_PER_MIN: "600" }, port++, async (base) => {
  const db = (await import("node:sqlite")).DatabaseSync; const d = new db(DB, { readOnly: true });
  const p = d.prepare("SELECT product_id p, count(*) c FROM offers GROUP BY product_id ORDER BY c DESC LIMIT 1").get().p;
  const s = d.prepare("SELECT shop_id s FROM offers WHERE product_id=? LIMIT 1").get(p).s; d.close();
  const paths = ["/", "/assistant", "/missions", "/missions/new", "/sellers", "/compare", "/data", `/products/${p}`, `/shops/${s}`, "/api/health", "/api/ready", "/api/agent/status", `/api/sellers?product=${p}`, `/api/products/${p}`, "/api/search?q=%D8%AF%D9%88%D8%B1%D8%A8%DB%8C%D9%86", "/api/areas"];
  for (const u of paths) { const r = await fetch(base + u); await r.arrayBuffer(); out.headers[u.replace(p, ":product").replace(s, ":shop")] = { status: r.status, cache: r.headers.get("cache-control"), csp: !!r.headers.get("content-security-policy"), xcto: r.headers.get("x-content-type-options"), xfo: r.headers.get("x-frame-options") }; }
  const n1 = (await fetch(base + "/")).headers.get("content-security-policy").match(/nonce-([^']+)/)?.[1]; const n2 = (await fetch(base + "/")).headers.get("content-security-policy").match(/nonce-([^']+)/)?.[1];
  out.csp = { nonceDiffersPerRequest: !!n1 && n1 !== n2, scriptSrc: (await fetch(base + "/")).headers.get("content-security-policy").match(/script-src[^;]*/)[0].replace(/nonce-[^']+/, "nonce-<n>"), styleUnsafeInline: /style-src[^;]*'unsafe-inline'/.test((await fetch(base + "/")).headers.get("content-security-policy")) };
  const body = JSON.stringify({ gps: { lat: 35.68, lon: 51.4 }, product: p });
  const post = async (path_, headers, b = body) => (await fetch(base + path_, { method: "POST", headers, body: b })).status;
  for (const route of ["/api/sellers", "/api/compare/sellers", "/api/agent/turn"]) {
    out.csrf[route] = {
      crossSiteFetchMetadata: await post(route, { "content-type": "application/json", "sec-fetch-site": "cross-site" }),
      foreignOrigin: await post(route, { "content-type": "application/json", origin: "https://evil.example" }),
      textPlainSimpleForm: await post(route, { "content-type": "text/plain" }),
      noOriginNoFetchMetadata_sameShape: await post(route, { "content-type": "application/json" }, "{}"),
      oversize: await post(route, { "content-type": "application/json" }, JSON.stringify({ pad: "x".repeat(30000) })),
    };
  }
});
// secrets never in logs or the client bundle
const staticDir = path.join(ROOT, ".next/static"); let hits = 0; let files = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(js|css|map|txt|json|html)$/.test(e.name)) { files++; const t = fs.readFileSync(f, "utf8"); if (/AGENT_API_KEY|LIVE_MODEL_CALLS_ENABLED_IN_CODE|openai-compatible|sk-FAKE|api\.openai|boxapi/i.test(t)) { hits++; out.bundle.offenders = [...(out.bundle.offenders ?? []), path.relative(ROOT, f)]; } } } };
walk(staticDir);
out.bundle = { ...out.bundle, filesScanned: files, filesWithModelOrSecretStrings: hits };
out.logs = { lines: allLogs.join("").split("\n").filter(Boolean).length, containsFakeKey: allLogs.join("").includes(FAKE_KEY) };
out.sinkTotalConnections = sinkHits;
sink.close();
const QA_OUT = path.resolve(process.env.QA_OUTPUT_DIR || path.join(ROOT, "qa-artifacts"));
fs.mkdirSync(QA_OUT, { recursive: true });
fs.writeFileSync(path.join(QA_OUT, "gate-b-proof.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ variants: out.variants.map((v) => ({ n: v.name.slice(0, 40), turn: v.turn?.map((t) => t[0]).join(), en: v.statusEnabled, id: v.providerId, sink: v.sinkConnections, ui: v.uiBannerProvider ?? v.uiLocked })), sinkTotal: sinkHits, logsLeak: out.logs.containsFakeKey, bundle: out.bundle, csp: out.csp, csrf: out.csrf }, null, 1));
