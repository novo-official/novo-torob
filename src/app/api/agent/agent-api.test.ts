// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAgentState } from "@/domain/agent";
import { readAgentConfig } from "@/server/agent/config";
import { createScriptedProvider } from "@/server/agent/providers/mock";
import { buildRuntime, setRuntimeForTests } from "@/server/agent/runtime";
import { openRealDb } from "../../../../tests/helpers/real-db";
import { GET as statusGet } from "./status/route";
import { POST as turn } from "./turn/route";

const hasDb = !!openRealDb();
const status = () => statusGet(new Request("http://localhost:3100/api/agent/status"));
const URL_ = "http://localhost:3100/api/agent/turn";
const req = (body: unknown, headers: Record<string, string> = {}, raw?: string) => new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) });
const use = (env: Record<string, string> = {}) => setRuntimeForTests(buildRuntime(readAgentConfig({ AGENT_EVIDENCE_MODE: "fixture", AGENT_RATE_PER_MIN: "1000", ...env })));
afterEach(() => setRuntimeForTests(null));

describe("GET /api/agent/status", () => {
  it("reveals the honest mode only: mock is not a language model, no keys / urls / limits", async () => {
    use({ AGENT_API_KEY: "sk-secret-0123456789", AGENT_BASE_URL: "https://llm.internal.example/v1", AGENT_MODEL: "m" });
    const j = await (await status()).json();
    expect(j).toMatchObject({ enabled: true, provider: { id: "mock", isLanguageModel: false, liveVerified: false }, evidenceMode: "fixture" });
    expect(JSON.stringify(j)).not.toMatch(/sk-secret|internal\.example|ratePerMinute/);
  });
  it("disabled provider is reported as disabled", async () => {
    use({ AGENT_PROVIDER: "disabled" });
    expect((await (await status()).json()).enabled).toBe(false);
  });
});

describe("PHASE 9: a live model can never be reached, whatever the environment says", () => {
  const FULL = { AGENT_PROVIDER: "openai-compatible", AGENT_BASE_URL: "https://llm.example.com/v1", AGENT_API_KEY: "sk-test-SECRETSECRETSECRET123456", AGENT_MODEL: "m", AGENT_LIVE_APPROVAL: "APPROVED-ABCDEFGH12", AGENT_LIVE_MAX_REQUESTS: "10", AGENT_LIVE_MAX_USD: "0.3", AGENT_LIVE_MAX_TOKENS: "600" };
  it("status says «locked»; the turn endpoint fails closed with a Persian reason (503), never answers from the mock, and makes ZERO outbound requests", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("no network allowed"); });
    use(FULL);
    const st = await (await status()).json();
    expect(st).toMatchObject({ enabled: false, provider: { id: "locked", isLanguageModel: false } });
    expect(JSON.stringify(st)).not.toMatch(/sk-test|llm\.example|AGENT_API_KEY/);
    const r = await turn(req({ message: "سلام", state: initialAgentState() }));
    const j = await r.json();
    expect([r.status, j.error]).toEqual([503, "AGENT_LIVE_LOCKED"]);
    expect(j.messageFa).toContain("قفل"); expect(j.assistant).toBeUndefined(); expect(j.provider).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
  it("the runtime never constructs the live adapter; its provider cannot be called", async () => {
    const rt = buildRuntime(readAgentConfig(FULL));
    expect(rt.config.provider).toBe("live-locked"); expect(rt.provider.info.id).toBe("locked");
    await expect(rt.provider.complete({} as never)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("POST /api/agent/turn: input hardening (needs no model and no catalog until the state check)", () => {
  it("disabled → 503 AGENT_DISABLED", async () => {
    use({ AGENT_PROVIDER: "disabled" });
    const r = await turn(req({ message: "سلام", state: initialAgentState() }));
    expect([r.status, (await r.json()).error]).toEqual([503, "AGENT_DISABLED"]);
  });
  it("cross-site browser requests are refused (CSRF)", async () => {
    use();
    expect((await turn(req({ message: "x", state: initialAgentState() }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await turn(req({ message: "x", state: initialAgentState() }, { origin: "https://evil.example" }))).status).toBe(403);
  });
  it("non-JSON, malformed JSON, oversized, unknown keys, empty and over-long messages are all 4xx with Persian messages", async () => {
    use();
    const cases: Array<[Request, number]> = [
      [new Request(URL_, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }), 415],
      [req(null, {}, "{not json"), 400],
      [req(null, { "content-length": "9999999" }, "{}"), 413],
      [req({ message: "x".repeat(600_000), state: initialAgentState() }), 413],
      [req({ message: "x", state: initialAgentState(), admin: true }), 400],
      [req({ state: initialAgentState() }), 400],
      [req({ message: "   ", state: initialAgentState() }), 400],
      [req({ message: "ا".repeat(1500), state: initialAgentState() }), 400],
      [req({ control: { type: "drop_tables" }, state: initialAgentState() }), 400],
    ];
    for (const [rq, st] of cases) { const r = await turn(rq); expect(r.status).toBe(st); const j = await r.json(); expect(j.ok).toBe(false); expect(j.messageFa).toMatch(/[؀-ۿ]/); expect(r.headers.get("cache-control")).toBe("no-store"); }
  });
  it("per-client rate limit → 429 with Retry-After; other clients are unaffected (only behind a declared trusted proxy)", async () => {
    process.env.TRUST_PROXY_HEADERS = "1";
    use({ AGENT_RATE_PER_MIN: "2" });
    const mk = (ip: string) => req({ message: "", state: initialAgentState() }, { "x-forwarded-for": ip });
    expect([(await turn(mk("1.1.1.1"))).status, (await turn(mk("1.1.1.1"))).status]).toEqual([400, 400]);
    const limited = await turn(mk("1.1.1.1"));
    expect(limited.status).toBe(429); expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await turn(mk("2.2.2.2"))).status).toBe(400);
    delete process.env.TRUST_PROXY_HEADERS;
  });
  it("without a trusted proxy a spoofed X-Forwarded-For cannot dodge the limit", async () => {
    use({ AGENT_RATE_PER_MIN: "2" });
    const mk = (ip: string) => req({ message: "", state: initialAgentState() }, { "x-forwarded-for": ip });
    expect([(await turn(mk("1.1.1.1"))).status, (await turn(mk("2.2.2.2"))).status, (await turn(mk("3.3.3.3"))).status]).toEqual([400, 400, 429]);
  });
  it("concurrency cap → 503 BUSY and the slot is always released", async () => {
    const rt = buildRuntime(readAgentConfig({ AGENT_RATE_PER_MIN: "1000", AGENT_MAX_CONCURRENT: "1" }));
    setRuntimeForTests(rt);
    expect(rt.gate.tryAcquire()).toBe(true);
    const r = await turn(req({ message: "سلام", state: initialAgentState() }));
    expect([r.status, (await r.json()).error]).toEqual([503, "BUSY"]);
    rt.gate.release();
    await turn(req({ message: "سلام", state: initialAgentState() }));
    expect(rt.gate.inFlight).toBe(0);
  });
});

describe.skipIf(!hasDb)("POST /api/agent/turn: end to end over the real catalog", () => {
  it("a normal turn returns the typed response with the honest provider label and no-store", async () => {
    use();
    const r = await turn(req({ message: "دوربین HDW1200CLQP", state: initialAgentState() }));
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("no-store");
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, provider: { id: "mock", isLanguageModel: false }, fallback: { used: false } });
    expect(j.trace.length).toBeGreaterThan(0);
  });
  it("a forged state is rejected with 400, never executed", async () => {
    use();
    const r = await turn(req({ message: "سلام", state: { ...initialAgentState(), phone: "09120000000" } }));
    expect(r.status).toBe(400);
  });
  it("a failing configured model degrades to the deterministic planner with HTTP 200 and the reason", async () => {
    const cfg = readAgentConfig({ AGENT_RATE_PER_MIN: "1000" });
    setRuntimeForTests({ ...buildRuntime(cfg), provider: createScriptedProvider([new Error("upstream 500")]) });
    const j = await (await turn(req({ message: "یک هدفون بی‌سیم می‌خوام", state: initialAgentState() }))).json();
    expect(j.ok).toBe(true); expect(j.fallback).toEqual({ used: true, reason: "PROVIDER_UNAVAILABLE" });
    expect(JSON.stringify(j)).not.toContain("upstream 500");
  });
});
