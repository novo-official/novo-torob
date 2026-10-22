// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { publicStatus, providerInfo, readAgentConfig, redact } from "./config";
import { LIVE_MODEL_CALLS_ENABLED_IN_CODE, liveGate } from "./live-gate";
import { createOpenAiCompatibleProvider, toWireMessages } from "./providers/openai-compatible";
import { ProviderError, type ProviderRequest } from "./provider";
import { initialAgentState } from "@/domain/agent";
import { toolSpecs } from "./orchestrator";

const KEY = "sk-test-SECRETSECRETSECRET123456";
const LIVE_ENV = { AGENT_PROVIDER: "openai-compatible", AGENT_BASE_URL: "https://llm.example.com/v1", AGENT_API_KEY: KEY, AGENT_MODEL: "model-x" };
/** the adapter is contract-tested through an INJECTED transport only; this is not a runtime configuration */
const live = { baseUrl: "https://llm.example.com/v1", apiKey: KEY, model: "model-x", limits: readAgentConfig({}).limits };

describe("configuration (server only)", () => {
  it("defaults to the offline mock and says it is NOT a language model", () => {
    const c = readAgentConfig({});
    expect(c.provider).toBe("mock"); expect(providerInfo(c)).toMatchObject({ id: "mock", isLanguageModel: false, liveVerified: false }); expect(c.evidenceMode).toBe("off");
  });
  it("PHASE 9 LOCK: a live provider can NEVER be selected from the environment — not with a complete base URL + key + model, not with an «approval» and caps", () => {
    const full = { ...LIVE_ENV, AGENT_LIVE_APPROVAL: "APPROVED-ABCDEFGH12", AGENT_LIVE_MAX_REQUESTS: "20", AGENT_LIVE_MAX_USD: "0.5", AGENT_LIVE_MAX_TOKENS: "700" };
    for (const env of [LIVE_ENV, full, { AGENT_PROVIDER: "openai-compatible" }, { ...full, AGENT_LIVE_KILL: "1" }]) {
      const c = readAgentConfig(env);
      expect(c.provider).toBe("live-locked"); expect(c.apiKey).toBeNull(); expect(c.baseUrl).toBeNull(); expect(c.model).toBeNull();
      expect(providerInfo(c)).toMatchObject({ id: "locked", isLanguageModel: false, liveVerified: false });
      expect(c.liveGate.open).toBe(false); expect(c.liveGate.missing).toContain("code_lock"); expect(c.liveGate.reasonFa).toContain("قفل");
    }
    expect(liveGate({ ...LIVE_ENV }).missing).toEqual(expect.arrayContaining(["owner_approval_id", "max_requests", "max_usd", "max_tokens_per_request"]));
    expect(LIVE_MODEL_CALLS_ENABLED_IN_CODE).toBe(false);
  });
  it("only an explicit mock selection gives the offline planner; the default is mock; there is no silent substitution for a live request", () => {
    expect(readAgentConfig({ AGENT_PROVIDER: "mock" }).provider).toBe("mock");
    expect(readAgentConfig({}).provider).toBe("mock");
    expect(readAgentConfig({ AGENT_PROVIDER: "openai-compatible" }).provider).not.toBe("mock");
  });
  it("the public status never exposes the key, the base URL or limits (and explains the lock in Persian)", () => {
    const s = JSON.stringify(publicStatus(readAgentConfig(LIVE_ENV)));
    expect(s).not.toContain(KEY); expect(s).not.toContain("llm.example.com"); expect(s).not.toMatch(/apiKey|baseUrl|AGENT_API_KEY/i);
    expect(publicStatus(readAgentConfig(LIVE_ENV))).toMatchObject({ enabled: false, provider: { id: "locked" } });
    expect(publicStatus(readAgentConfig(LIVE_ENV)).lockedReasonFa).toContain("قفل");
  });
  it("evidence mode: live requires an explicit second opt-in; fixture is separate; unknown → off", () => {
    expect(readAgentConfig({ AGENT_EVIDENCE_MODE: "live" }).evidenceMode).toBe("off");
    expect(readAgentConfig({ AGENT_EVIDENCE_MODE: "live", AGENT_EXTERNAL_LIVE: "1" }).evidenceMode).toBe("live");
    expect(readAgentConfig({ AGENT_EVIDENCE_MODE: "fixture" }).evidenceMode).toBe("fixture");
    expect(readAgentConfig({ AGENT_EVIDENCE_MODE: "yes please" }).evidenceMode).toBe("off");
  });
  it("limits are clamped to safe ranges", () => {
    const c = readAgentConfig({ AGENT_MAX_HOPS: "999", AGENT_RATE_PER_MIN: "-3", AGENT_PROVIDER_TIMEOUT_MS: "1" });
    expect(c.limits.maxHops).toBe(6); expect(c.limits.ratePerMinute).toBe(30); expect(c.limits.providerTimeoutMs).toBe(20_000);
  });
  it("redaction removes keys, bearer tokens and key-like assignments from anything that is logged", () => {
    const t = redact(`failed with Authorization: Bearer abcdefghijkl and ${KEY} and api_key=zzzzzzzzzzzz`, [KEY]);
    expect(t).not.toContain(KEY); expect(t).not.toMatch(/abcdefghijkl|zzzzzzzzzzzz/); expect(t).toContain("[REDACTED]");
  });
  it(".env.example documents the variables with placeholders only", async () => {
    const fs = await import("node:fs");
    const t = fs.readFileSync(".env.example", "utf8");
    for (const k of ["AGENT_PROVIDER", "AGENT_MODEL", "AGENT_BASE_URL", "AGENT_API_KEY", "AGENT_EVIDENCE_MODE"]) expect(t).toContain(k);
    expect(t).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(t).toMatch(/AGENT_API_KEY=\s*(#.*)?$/m);
  });
});

const req = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({ system: "S", messages: [{ role: "user", content: "سلام" }], tools: toolSpecs(), maxOutputChars: 1400, context: { state: initialAgentState(), userMessage: "سلام", control: null }, ...over });
const res = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OpenAI-compatible adapter (contract-tested with mocked HTTP only — NOT LIVE VERIFIED)", () => {
  const mk = (f: typeof fetch) => createOpenAiCompatibleProvider(live, f);
  it("the REAL network function is unreachable while the code lock is on (even constructed directly with a key)", async () => {
    const real = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("network must not be touched"); });
    await expect(createOpenAiCompatibleProvider(live).complete(req())).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(real).not.toHaveBeenCalled();
    real.mockRestore();
  });
  it("sends tools as functions, bearer auth, no key in the body, temperature 0", async () => {
    const f = vi.fn(async () => res(200, { choices: [{ message: { content: "سلام!" } }] }));
    await mk(f as never).complete(req());
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(body.temperature).toBe(0); expect(body.tools.length).toBe(12); expect(body.tools[0].type).toBe("function");
    expect(body.messages[0].content).toContain("CONVERSATION STATE");
  });
  it("parses tool calls (arguments stay UNTRUSTED data) and final text", async () => {
    const tc = await mk((async () => res(200, { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_products", arguments: '{"query":"x"}' } }, { id: "c2", function: { name: "compare_sellers", arguments: "{not json" } }] } }] })) as never).complete(req());
    expect(tc).toMatchObject({ kind: "tool_calls" });
    if (tc.kind === "tool_calls") { expect(tc.calls[0]).toEqual({ id: "c1", name: "search_products", arguments: { query: "x" } }); expect(tc.calls[1]!.arguments).toEqual({ __invalidJson: true }); }
    expect(await mk((async () => res(200, { choices: [{ message: { content: "متن" } }] })) as never).complete(req())).toEqual({ kind: "final", text: "متن" });
  });
  it("maps failures to typed errors without leaking the key", async () => {
    const code = async (f: () => Promise<Response>) => { try { await mk(f as never).complete(req()); return "none"; } catch (e) { expect(String((e as Error).message)).not.toContain(KEY); return (e as ProviderError).code + ((e as ProviderError).retryable ? "+retry" : ""); } };
    expect(await code(async () => res(401, {}))).toBe("AUTH"); expect(await code(async () => res(403, {}))).toBe("AUTH");
    expect(await code(async () => res(429, {}))).toBe("RATE_LIMITED+retry"); expect(await code(async () => res(503, {}))).toBe("UNAVAILABLE+retry");
    expect(await code(async () => res(400, {}))).toBe("INVALID_RESPONSE"); expect(await code(async () => res(200, "not json"))).toBe("INVALID_RESPONSE");
    expect(await code(async () => res(200, { choices: [] }))).toBe("INVALID_RESPONSE"); expect(await code(async () => res(200, { choices: [{ message: { content: "  " } }] }))).toBe("INVALID_RESPONSE");
    expect(await code(async () => { throw new Error(`socket hang up ${KEY}`); })).toBe("UNAVAILABLE+retry");
  });
  it("an aborted request is a TIMEOUT", async () => {
    const ac = new AbortController(); ac.abort();
    await expect(mk((async () => { throw new DOMException("aborted", "AbortError"); }) as never).complete(req({ signal: ac.signal }))).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("wire messages keep roles separate and never include the key or raw secrets", () => {
    const w = toWireMessages(req({ messages: [{ role: "user", content: "u" }, { role: "assistant", content: "", toolCalls: [{ id: "1", name: "search_products", arguments: { query: "q" } }] }, { role: "tool", toolCallId: "1", name: "search_products", content: "{}" }] })) as Array<{ role: string }>;
    expect(w.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(JSON.stringify(w)).not.toContain(KEY);
  });
  it("an unconfigured adapter refuses to call anything", async () => {
    await expect(createOpenAiCompatibleProvider({ baseUrl: null, apiKey: null, model: null, limits: live.limits }, vi.fn() as never).complete(req())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("tool registry exposed to a model", () => {
  it("is a closed allowlist of 12 read-only tools with JSON-schema parameters and no free-form capability", () => {
    const specs = toolSpecs();
    expect(specs.map((s) => s.name).sort()).toEqual(["advise_products", "compare_sellers", "compose_seller_inquiry", "find_product_alternatives", "find_sellers_for_product", "get_external_evidence", "get_product_details", "get_shop_declared_hours", "recommend_shopping_areas", "search_products", "summarize_user_reported_reply", "understand_or_clarify_need"]);
    for (const s of specs) { expect(s.parameters).toBeTypeOf("object"); const props = JSON.stringify((s.parameters as { properties?: object }).properties ?? {});
      expect(props, s.name).not.toMatch(/"(url|href|link|sql|command|phone|coordinates?|lat|lon|price|priceToman|offerPrice)"\s*:/i);
      // the ONLY place stock can appear is the user's own reported reply, and it can never be «confirmed»
      if (s.name !== "summarize_user_reported_reply") expect(props, s.name).not.toMatch(/stock|inventory|available/i);
    }
    expect(specs.some((s) => /send|call|sms|whatsapp|pay|buy|fetch|http|shell|file|sql/i.test(s.name))).toBe(false);
  });
});
