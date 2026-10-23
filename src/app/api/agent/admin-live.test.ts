// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAgentState } from "@/domain/agent";
import { readAgentConfig } from "@/server/agent/config";
import { createScriptedProvider } from "@/server/agent/providers/mock";
import { buildRuntime, setRuntimeForTests } from "@/server/agent/runtime";
import { adminCookieValue, isAdmin } from "@/server/agent/admin";
import { openRealDb } from "../../../../tests/helpers/real-db";
import { GET as status } from "./status/route";
import { POST as turn } from "./turn/route";
import { POST as login } from "./admin/route";

/**
 * The paid model is PRIVATE. These tests use an injected runtime whose config says "openai-compatible" and a scripted provider that stands for the
 * billable model — no network, no key. They prove who may reach it, and that the public is served by the labelled offline planner.
 */
const TOKEN = "admin-token-0123456789-abcdefghij";
const hasDb = !!openRealDb();
const URL_ = "http://localhost:3100/api/agent/turn";
const post = (headers: Record<string, string> = {}) => new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ message: "سلام", state: initialAgentState() }) });

function liveRuntime() {
  const base = buildRuntime(readAgentConfig({ AGENT_PROVIDER: "mock", AGENT_RATE_PER_MIN: "1000" }));
  const billable = createScriptedProvider([{ kind: "final", text: "پاسخ مدل خصوصی" }], { id: "openai-compatible", labelFa: "مدل زبانی (m)", isLanguageModel: true, liveVerified: false, model: "m" });
  const config = { ...base.config, provider: "openai-compatible" as const, model: "m", baseUrl: "https://llm.invalid/v1", apiKey: "sk-test-SECRETSECRETSECRET123456", limits: { ...base.config.limits, providerRetries: 0 } };
  return { rt: { ...base, config, provider: billable }, billable };
}
afterEach(() => { setRuntimeForTests(null); vi.unstubAllEnvs(); });

describe("admin identity", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
  it("no token configured ⇒ nobody is admin; short tokens are ignored", () => {
    expect(isAdmin(h({ "x-hamghadam-admin": TOKEN }), {})).toBe(false);
    expect(isAdmin(h({ "x-hamghadam-admin": "short" }), { AGENT_LIVE_ADMIN_TOKEN: "short" })).toBe(false);
  });
  it("accepts the exact header or the derived cookie, rejects everything else", () => {
    const env = { AGENT_LIVE_ADMIN_TOKEN: TOKEN };
    expect(isAdmin(h({ "x-hamghadam-admin": TOKEN }), env)).toBe(true);
    expect(isAdmin(h({ cookie: `a=b; hg_admin=${adminCookieValue(TOKEN)}` }), env)).toBe(true);
    expect(isAdmin(h({ "x-hamghadam-admin": TOKEN + "x" }), env)).toBe(false);
    expect(isAdmin(h({ cookie: `hg_admin=${TOKEN}` }), env)).toBe(false); // the raw token is not the cookie value
    expect(isAdmin(h({}), env)).toBe(false);
  });
});

describe("live model is private", () => {
  it("status: the public sees the offline planner; an admin sees the live mode; neither sees keys/urls", async () => {
    vi.stubEnv("AGENT_LIVE_ADMIN_TOKEN", TOKEN);
    setRuntimeForTests(liveRuntime().rt);
    const pub = await (await status(new Request("http://localhost/api/agent/status"))).json();
    expect(pub.provider).toMatchObject({ id: "mock", isLanguageModel: false });
    const adm = await (await status(new Request("http://localhost/api/agent/status", { headers: { "x-hamghadam-admin": TOKEN } }))).json();
    expect(adm.provider).toMatchObject({ id: "openai-compatible", isLanguageModel: true, liveVerified: false });
    expect(JSON.stringify([pub, adm])).not.toMatch(/sk-test|llm\.invalid|SECRET/);
  });
  it.skipIf(!hasDb)("turn: without the admin token the billable provider is NEVER called; with it, it is", async () => {
    vi.stubEnv("AGENT_LIVE_ADMIN_TOKEN", TOKEN);
    const { rt, billable } = liveRuntime();
    setRuntimeForTests(rt);
    const r1 = await turn(post());
    expect(r1.status).toBe(200);
    expect((await r1.json()).provider).toMatchObject({ id: "mock", isLanguageModel: false });
    expect(billable.calls.length).toBe(0);
    const r2 = await turn(post({ "x-hamghadam-admin": "wrong-token-wrong-token-wrong" }));
    expect((await r2.json()).provider.id).toBe("mock");
    expect(billable.calls.length).toBe(0);
    const r3 = await turn(post({ "x-hamghadam-admin": TOKEN }));
    expect((await r3.json()).provider).toMatchObject({ id: "openai-compatible" });
    expect(billable.calls.length).toBe(1);
  });
  it("login: 404 without a configured token, 401 for a wrong token, cookie (HttpOnly, SameSite=Strict, path-scoped) for the right one", async () => {
    const mk = (token: string) => new Request("http://localhost:3100/api/agent/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    expect((await login(mk(TOKEN))).status).toBe(404);
    vi.stubEnv("AGENT_LIVE_ADMIN_TOKEN", TOKEN);
    expect((await login(mk("nope"))).status).toBe(401);
    const ok = await login(mk(TOKEN));
    expect(ok.status).toBe(200);
    const c = ok.headers.get("set-cookie") ?? "";
    expect(c).toContain(`hg_admin=${adminCookieValue(TOKEN)}`); expect(c).not.toContain(TOKEN);
    expect(c).toMatch(/HttpOnly/i); expect(c).toMatch(/SameSite=strict/i); expect(c).toMatch(/Path=\/api\/agent/i);
  });
});
