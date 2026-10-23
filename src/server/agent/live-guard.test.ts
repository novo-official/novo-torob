// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLiveGuard, estimateInputTokens, liveGuardOptionsFromEnv, LiveGuardError, type LiveGuardOptions } from "./live-guard";
import { liveGate, LIVE_MODEL_CALLS_ENABLED_IN_CODE } from "./live-gate";
import { createOpenAiCompatibleProvider, wireOptionsFromEnv } from "./providers/openai-compatible";
import { buildRuntime } from "./runtime";
import { publicStatus, readAgentConfig, redact } from "./config";
import { initialAgentState } from "@/domain/agent";
import { toolSpecs } from "./orchestrator";
import { ProviderError, type ProviderRequest } from "./provider";

/**
 * ZERO-COST HARNESS: every transport here is a local function. Nothing in this file can reach a network — the only way to the real `fetch`
 * is blocked twice (guard and adapter) while LIVE_MODEL_CALLS_ENABLED_IN_CODE is false, and vitest.setup.ts replaces global fetch with a thrower.
 */
const BASE = "https://llm.invalid/v1";
const KEY = "sk-test-SECRETSECRETSECRET123456";
const opts = (o: Partial<LiveGuardOptions> = {}): LiveGuardOptions => ({ allowedBaseUrl: BASE, allowedModel: "model-x", maxRequests: 3, maxUsd: 0.05, maxOutputTokens: 300, maxInputTokens: 4_000, priceInPerM: 1, priceOutPerM: 2, ...o });
const body = (o: Record<string, unknown> = {}) => JSON.stringify({ model: "model-x", max_tokens: 300, messages: [{ role: "user", content: "سلام" }], ...o });
const init = (b = body()): RequestInit => ({ method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: b });
const reply = (usage: unknown, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], ...(usage ? { usage } : {}) }), { status, headers: { "content-type": "application/json" } });
const URL_OK = `${BASE}/chat/completions`;

describe("LiveGuard (prepared; zero-cost harness)", () => {
  it("cannot wrap the real network function while the code lock is on", () => {
    expect(LIVE_MODEL_CALLS_ENABLED_IN_CODE).toBe(false);
    expect(() => createLiveGuard(opts()).wrap(fetch)).toThrow(LiveGuardError);
  });

  it("allows exactly one well-formed request and records usage-based cost (no prompt/key in the ledger)", async () => {
    const inner = vi.fn(async () => reply({ prompt_tokens: 100, completion_tokens: 50 }));
    const g = createLiveGuard(opts());
    const f = g.wrap(inner as unknown as typeof fetch);
    const r = await f(URL_OK, init());
    expect(r.ok).toBe(true);
    expect((inner.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: "error" });
    const s = g.state();
    expect(s).toMatchObject({ requests: 1, halted: false, inFlight: 0 });
    expect(s.spentUsd).toBeCloseTo(100 * 1e-6 + 50 * 2e-6, 9);
    const led = JSON.stringify(g.ledger());
    expect(led).not.toContain(KEY); expect(led).not.toContain("سلام");
  });

  it("is deny-by-default: other URL, host, path, model, over-cap max_tokens, missing max_tokens, non-JSON, wrong method", async () => {
    const inner = vi.fn(async () => reply({ prompt_tokens: 1, completion_tokens: 1 }));
    const f = createLiveGuard(opts()).wrap(inner as unknown as typeof fetch);
    const bad: Array<[string, RequestInit]> = [
      ["https://evil.example/v1/chat/completions", init()],
      [`${BASE}/models`, init()],
      [`${BASE}/chat/completions?x=1`, init()],
      [URL_OK, init(body({ model: "other-model" }))],
      [URL_OK, init(body({ max_tokens: 301 }))],
      [URL_OK, init(JSON.stringify({ model: "model-x" }))],
      [URL_OK, init("not json")],
      [URL_OK, { ...init(), method: "GET" }],
    ];
    for (const [u, i] of bad) await expect(f(u, i)).rejects.toBeInstanceOf(LiveGuardError);
    expect(inner).not.toHaveBeenCalled();
  });

  it("input over the ceiling is refused before sending (conservative estimate)", async () => {
    const inner = vi.fn(async () => reply({ prompt_tokens: 1, completion_tokens: 1 }));
    const f = createLiveGuard(opts({ maxInputTokens: 50 })).wrap(inner as unknown as typeof fetch);
    expect(estimateInputTokens(100)).toBe(50);
    await expect(f(URL_OK, init(body({ messages: [{ role: "user", content: "x".repeat(400) }] })))).rejects.toThrow(/input_over_cap/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("concurrency = 1", async () => {
    let release!: () => void;
    const inner = vi.fn(() => new Promise<Response>((res) => { release = () => res(reply({ prompt_tokens: 1, completion_tokens: 1 })); }));
    const g = createLiveGuard(opts());
    const f = g.wrap(inner as unknown as typeof fetch);
    const first = f(URL_OK, init());
    await expect(f(URL_OK, init())).rejects.toThrow(/concurrency/);
    release(); await first;
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("every ATTEMPT counts against the request cap (a retry is a second charge) and the cap halts the guard", async () => {
    const inner = vi.fn(async () => reply({ prompt_tokens: 1, completion_tokens: 1 }));
    const g = createLiveGuard(opts({ maxRequests: 2 }));
    const f = g.wrap(inner as unknown as typeof fetch);
    await f(URL_OK, init()); await f(URL_OK, init());
    await expect(f(URL_OK, init())).rejects.toThrow(/request_cap/);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(g.state().halted).toBe(true);
  });

  it("reserves the WORST case before sending: a request that could exceed the USD cap is never sent", async () => {
    const inner = vi.fn(async () => reply({ prompt_tokens: 1, completion_tokens: 1 }));
    // worst case ≈ input(≈20 tok)*1e-6 + 300*2e-6 = ~0.00062 > 0.0005
    const g = createLiveGuard(opts({ maxUsd: 0.0005 }));
    await expect(g.wrap(inner as unknown as typeof fetch)(URL_OK, init())).rejects.toThrow(/usd_cap/);
    expect(inner).not.toHaveBeenCalled(); expect(g.state().halted).toBe(true);
  });

  it("price/usage metadata absent ⇒ the worst case stays charged and the guard HALTS (fail closed on uncertainty)", async () => {
    const inner = vi.fn(async () => reply(null));
    const g = createLiveGuard(opts());
    const f = g.wrap(inner as unknown as typeof fetch);
    await f(URL_OK, init());
    expect(g.state()).toMatchObject({ halted: true, haltReason: "usage_metadata_missing" });
    expect(g.state().spentUsd).toBeGreaterThan(300 * 2e-6 - 1e-12);
    await expect(f(URL_OK, init())).rejects.toThrow(/halted/);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("usage larger than the estimate ⇒ halted", async () => {
    const inner = vi.fn(async () => reply({ prompt_tokens: 50_000, completion_tokens: 50_000 }));
    const g = createLiveGuard(opts());
    await g.wrap(inner as unknown as typeof fetch)(URL_OK, init());
    expect(g.state()).toMatchObject({ halted: true, haltReason: "usage_exceeded_estimate" });
  });

  it("circuit breaker: consecutive failures (network / 5xx) halt the guard; timeouts keep the reservation charged", async () => {
    const g = createLiveGuard(opts({ breakerThreshold: 2 }));
    const inner = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(reply({ prompt_tokens: 1, completion_tokens: 1 }, 503));
    const f = g.wrap(inner as unknown as typeof fetch);
    await expect(f(URL_OK, init())).rejects.toThrow("timeout");
    expect(g.state().spentUsd).toBeGreaterThan(0);
    await f(URL_OK, init());
    expect(g.state()).toMatchObject({ halted: true, haltReason: "circuit_breaker", consecutiveFailures: 2 });
    await expect(f(URL_OK, init())).rejects.toThrow(/halted/);
  });

  it("stop switch is checked before EVERY send and is sticky", async () => {
    let killed = false;
    const inner = vi.fn(async () => reply({ prompt_tokens: 1, completion_tokens: 1 }));
    const g = createLiveGuard(opts({ isKilled: () => killed }));
    const f = g.wrap(inner as unknown as typeof fetch);
    await f(URL_OK, init());
    killed = true;
    await expect(f(URL_OK, init())).rejects.toThrow(/stop_switch/);
    killed = false;
    await expect(f(URL_OK, init())).rejects.toThrow(/halted/);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("invalid / missing owner limits refuse everything", async () => {
    const inner = vi.fn(async () => reply({ prompt_tokens: 1, completion_tokens: 1 }));
    for (const bad of [{ maxUsd: 0 }, { priceInPerM: NaN }, { maxRequests: -1 }, { maxOutputTokens: Infinity as number }]) {
      await expect(createLiveGuard(opts(bad)).wrap(inner as unknown as typeof fetch)(URL_OK, init())).rejects.toThrow(/invalid_owner_limits/);
    }
    expect(inner).not.toHaveBeenCalled();
  });

  it("works through the real adapter: tool calls parsed, the owner's max_tokens is what is sent, a refused request surfaces as a typed error", async () => {
    const limits = readAgentConfig({}).limits;
    const sent: Array<{ max_tokens: number }> = [];
    const inner = vi.fn(async (_u: unknown, i: RequestInit) => { sent.push(JSON.parse(String(i.body))); return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_products", arguments: "{\"q\":\"x\"}" } }] } }], usage: { prompt_tokens: 120, completion_tokens: 20 } }), { status: 200 }); });
    const req: ProviderRequest = { system: "s", messages: [], tools: toolSpecs(), maxOutputChars: 1400, context: { state: initialAgentState(), userMessage: "سلام", control: null } };
    const g = createLiveGuard(opts({ maxInputTokens: 8_000 }));
    const p = createOpenAiCompatibleProvider({ baseUrl: BASE, apiKey: KEY, model: "model-x", limits, maxOutputTokens: 300 }, g.wrap(inner as unknown as typeof fetch));
    expect((await p.complete(req)).kind).toBe("tool_calls");
    expect(sent[0]!.max_tokens).toBe(300);
    // adapter default (700) exceeds the owner's cap ⇒ refused by the guard BEFORE the transport; surfaces as UNAVAILABLE, prompt/key not in the message
    const g2 = createLiveGuard(opts({ maxInputTokens: 8_000 }));
    const p2 = createOpenAiCompatibleProvider({ baseUrl: BASE, apiKey: KEY, model: "model-x", limits }, g2.wrap(inner as unknown as typeof fetch));
    const err = await p2.complete(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(String((err as Error).message)).toContain("max_tokens_missing_or_over_cap");
    expect(String((err as Error).message)).not.toContain(KEY);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe("handshake gate (second lock; the first is the code constant)", () => {
  const good = () => ({
    AGENT_PROVIDER: "openai-compatible", AGENT_BASE_URL: BASE, AGENT_API_KEY: KEY, AGENT_MODEL: "model-x",
    AGENT_LIVE_APPROVAL: "APPROVED-ABCDEFGH12", AGENT_LIVE_MAX_REQUESTS: "5", AGENT_LIVE_MAX_USD: "0.2", AGENT_LIVE_MAX_TOKENS: "300",
    AGENT_LIVE_APPROVAL_EXPIRES: new Date(Date.now() + 3_600_000).toISOString(), AGENT_LIVE_ALLOW_BASE_URL: BASE, AGENT_LIVE_ALLOW_MODEL: "model-x",
    AGENT_LIVE_PRICE_IN_PER_M: "1", AGENT_LIVE_PRICE_OUT_PER_M: "2",
    AGENT_LIVE_ADMIN_TOKEN: "t".repeat(32), AGENT_LIVE_LEDGER_PATH: "/tmp/never-written-ledger.json",
  });
  it("live mode also needs a private admin token and a persistent ledger path", () => {
    const m = (patch: Record<string, string | undefined>) => liveGate({ ...good(), ...patch }).missing;
    expect(m({ AGENT_LIVE_ADMIN_TOKEN: undefined })).toContain("admin_token");
    expect(m({ AGENT_LIVE_ADMIN_TOKEN: "short" })).toContain("admin_token");
    expect(m({ AGENT_LIVE_LEDGER_PATH: "" })).toContain("ledger_path");
  });
  it("only the code lock remains when every other condition is met", () => {
    expect(liveGate(good()).missing).toEqual(["code_lock"]);
  });
  it("malformed, expired, over-long, forged-shape and mismatched handshakes each add their own missing condition", () => {
    const m = (patch: Record<string, string | undefined>) => liveGate({ ...good(), ...patch }).missing;
    expect(m({ AGENT_LIVE_APPROVAL: "APPROVED-short" })).toContain("owner_approval_id");
    expect(m({ AGENT_LIVE_APPROVAL: "approved-abcdefgh12" })).toContain("owner_approval_id");
    expect(m({ AGENT_LIVE_APPROVAL_EXPIRES: new Date(Date.now() - 1000).toISOString() })).toContain("approval_expired_or_missing_expiry");
    expect(m({ AGENT_LIVE_APPROVAL_EXPIRES: undefined })).toContain("approval_expired_or_missing_expiry");
    expect(m({ AGENT_LIVE_APPROVAL_EXPIRES: "tomorrow" })).toContain("approval_expired_or_missing_expiry");
    expect(m({ AGENT_LIVE_APPROVAL_EXPIRES: new Date(Date.now() + 30 * 86_400_000).toISOString() })).toContain("approval_expired_or_missing_expiry");
    expect(m({ AGENT_LIVE_ALLOW_BASE_URL: "https://other.invalid/v1" })).toContain("base_url_not_allowlisted");
    expect(m({ AGENT_LIVE_ALLOW_MODEL: "model-y" })).toContain("model_not_allowlisted");
    expect(m({ AGENT_LIVE_PRICE_IN_PER_M: undefined })).toContain("owner_verified_prices");
    expect(m({ AGENT_LIVE_PRICE_OUT_PER_M: "-1" })).toContain("owner_verified_prices");
    expect(m({ AGENT_LIVE_KILL: "1" })).toContain("kill_switch_engaged");
  });
  it("a complete, valid-looking handshake STILL yields a locked provider that cannot reach any transport", async () => {
    const c = readAgentConfig(good());
    expect(c.provider).toBe("live-locked");
    const rt = buildRuntime(c);
    await expect(rt.provider.complete({ system: "s", messages: [], tools: [], maxOutputChars: 10, context: { state: initialAgentState(), userMessage: "x", control: null } })).rejects.toBeInstanceOf(ProviderError);
  });
  it("guard options from env are null unless every limit is present", () => {
    expect(liveGuardOptionsFromEnv(good())).toBeNull(); // AGENT_LIVE_MAX_INPUT_TOKENS missing
    expect(liveGuardOptionsFromEnv({ ...good(), AGENT_LIVE_MAX_INPUT_TOKENS: "4000" })).toMatchObject({ allowedModel: "model-x", maxInputTokens: 4000 });
    expect(liveGuardOptionsFromEnv({ ...good(), AGENT_LIVE_MAX_INPUT_TOKENS: "4000", AGENT_LIVE_LEDGER_PATH: "" })).toBeNull(); // no ledger file ⇒ no live
    expect(liveGuardOptionsFromEnv({ ...good(), AGENT_LIVE_MAX_INPUT_TOKENS: "4000", AGENT_LIVE_ALLOW_BASE_URL: "http://insecure/v1" })).toBeNull();
  });
});

describe("persistent global budget ledger (survives restarts; fails closed)", () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "live-ledger-")), "ledger.json");
  const okFetch = () => vi.fn(async () => reply({ prompt_tokens: 100, completion_tokens: 50 }));
  const wrapOf = (o: LiveGuardOptions, f: ReturnType<typeof okFetch>) => createLiveGuard(o).wrap(f as unknown as typeof fetch);
  // the real network function is unreachable while the code lock is on; an injected transport is the test seam
  it("a restart resumes the spent budget and request count instead of resetting it", async () => {
    const ledgerPath = tmp();
    const f1 = okFetch();
    const g1 = createLiveGuard(opts({ ledgerPath, maxRequests: 2, maxUsd: 1 }));
    await g1.wrap(f1 as unknown as typeof fetch)(URL_OK, init());
    const spent1 = g1.state().spentUsd;
    expect(JSON.parse(fs.readFileSync(ledgerPath, "utf8"))).toMatchObject({ v: 1, requests: 1 });
    // "process restart": a brand-new guard on the same file
    const f2 = okFetch();
    const g2 = createLiveGuard(opts({ ledgerPath, maxRequests: 2, maxUsd: 1 }));
    expect(g2.state()).toMatchObject({ requests: 1 });
    expect(g2.state().spentUsd).toBeCloseTo(spent1, 10);
    await g2.wrap(f2 as unknown as typeof fetch)(URL_OK, init());
    await expect(g2.wrap(f2 as unknown as typeof fetch)(URL_OK, init())).rejects.toThrow(/request_cap/); // 2 requests TOTAL across both processes
    expect(f2).toHaveBeenCalledTimes(1);
  });
  it("a halted state is sticky across restarts", async () => {
    const ledgerPath = tmp();
    const g1 = createLiveGuard(opts({ ledgerPath }));
    await g1.wrap((async () => reply(null)) as unknown as typeof fetch)(URL_OK, init()); // no usage ⇒ halts
    expect(g1.state().halted).toBe(true);
    const f = okFetch();
    await expect(wrapOf(opts({ ledgerPath }), f)(URL_OK, init())).rejects.toThrow(/halted/);
    expect(f).not.toHaveBeenCalled();
  });
  it("a corrupt or unwritable ledger refuses every request and sends nothing", async () => {
    const bad = tmp(); fs.writeFileSync(bad, "{not json");
    const f = okFetch();
    await expect(wrapOf(opts({ ledgerPath: bad }), f)(URL_OK, init())).rejects.toThrow(/ledger_unreadable/);
    const blocked = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "live-ledger-")), "file-as-dir");
    fs.writeFileSync(blocked, "x");
    const f2 = okFetch();
    await expect(wrapOf(opts({ ledgerPath: path.join(blocked, "ledger.json") }), f2)(URL_OK, init())).rejects.toThrow(/ledger_unwritable/);
    expect(f).not.toHaveBeenCalled(); expect(f2).not.toHaveBeenCalled();
  });
  it("the ledger file holds counters only — never prompts, responses or keys", async () => {
    const ledgerPath = tmp();
    await wrapOf(opts({ ledgerPath }), okFetch())(URL_OK, init());
    const raw = fs.readFileSync(ledgerPath, "utf8");
    expect(raw).not.toContain(KEY); expect(raw).not.toContain("سلام"); expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["haltReason", "halted", "requests", "spentUsd", "updatedAt", "v"]);
  });
});

describe("BoxAPI-style wire compatibility (mocked HTTP only — no network, no key)", () => {
  const cfg = { baseUrl: BASE, apiKey: KEY, model: "gpt-6-luna", limits: readAgentConfig({}).limits };
  const req = (): ProviderRequest => ({ system: "s", messages: [{ role: "user", content: "سلام" }], tools: toolSpecs(), maxOutputChars: 1400, context: { state: initialAgentState(), userMessage: null, control: null } });
  const capture = () => { const seen: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []; const f = vi.fn(async (u: unknown, i?: RequestInit) => { seen.push({ url: String(u), headers: i?.headers as Record<string, string>, body: JSON.parse(String(i?.body)) }); return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "search_products", arguments: "{\"query\":\"x\"}" } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } }); }); return { seen, f }; };

  it("default wire: chat/completions, Bearer key in the header only, 12 function tools, tool_choice auto, max_tokens + temperature 0", async () => {
    const { seen, f } = capture();
    const r = await createOpenAiCompatibleProvider(cfg, f as unknown as typeof fetch).complete(req());
    expect(r).toMatchObject({ kind: "tool_calls", calls: [{ id: "call_1", name: "search_products" }] });
    expect(seen[0]!.url).toBe(`${BASE}/chat/completions`);
    expect(seen[0]!.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(seen[0]!.body)).not.toContain(KEY);
    expect(seen[0]!.body).toMatchObject({ model: "gpt-6-luna", temperature: 0, max_tokens: 700, tool_choice: "auto" });
    expect((seen[0]!.body.tools as unknown[]).length).toBe(12);
    expect((seen[0]!.body.tools as Array<{ type: string }>).every((t) => t.type === "function")).toBe(true);
  });
  it("newer-model wire options: max_completion_tokens instead of max_tokens, and no temperature field", async () => {
    const { seen, f } = capture();
    await createOpenAiCompatibleProvider({ ...cfg, tokenParam: "max_completion_tokens", sendTemperature: false }, f as unknown as typeof fetch).complete(req());
    expect(seen[0]!.body.max_completion_tokens).toBe(700); expect("max_tokens" in seen[0]!.body).toBe(false); expect("temperature" in seen[0]!.body).toBe(false);
    expect(wireOptionsFromEnv({})).toEqual({ tokenParam: "max_tokens", sendTemperature: true });
    expect(wireOptionsFromEnv({ AGENT_TOKEN_PARAM: "max_completion_tokens", AGENT_SEND_TEMPERATURE: "0" })).toEqual({ tokenParam: "max_completion_tokens", sendTemperature: false });
  });
  it("the guard accepts exactly one output-token field within the cap, for either spelling", async () => {
    const g = createLiveGuard(opts({ allowedModel: "gpt-6-luna", maxRequests: 5, maxUsd: 1 }));
    const f = vi.fn(async () => reply({ prompt_tokens: 10, completion_tokens: 5 }));
    const w = g.wrap(f as unknown as typeof fetch);
    await w(URL_OK, init(body({ model: "gpt-6-luna", max_tokens: undefined, max_completion_tokens: 300 })));
    await expect(w(URL_OK, init(body({ model: "gpt-6-luna", max_tokens: 300, max_completion_tokens: 300 })))).rejects.toThrow(/ambiguous_token_limit/);
    await expect(w(URL_OK, init(body({ model: "gpt-6-luna", max_tokens: undefined, max_completion_tokens: 301 })))).rejects.toThrow(/max_tokens_missing_or_over_cap/);
    await expect(w(URL_OK, init(body({ model: "gpt-6-luna", max_tokens: undefined })))).rejects.toThrow(/max_tokens_missing_or_over_cap/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("BOXAPI_API_KEY is read server-side only: never in the public status, never in a log line or error", () => {
    const env = { AGENT_PROVIDER: "openai-compatible", AGENT_BASE_URL: BASE, BOXAPI_API_KEY: KEY, AGENT_MODEL: "gpt-6-luna", AGENT_LIVE_APPROVAL: "APPROVED-ABCDEFGH12" };
    const c = readAgentConfig(env);
    expect(c.provider).toBe("live-locked"); // the lock still wins
    const json = JSON.stringify(publicStatus(c));
    expect(json).not.toContain(KEY); expect(json).not.toContain("llm.invalid");
    expect(redact(`upstream said Bearer ${KEY} while using ${KEY}`, [KEY])).not.toContain(KEY);
    expect(redact("authorization: Bearer abcdef0123456789abcdef")).not.toContain("abcdef0123456789");
  });
});

describe("a rejected call (HTTP 400) is diagnosable and does not masquerade as a missing-usage success", () => {
  const cfg = { baseUrl: BASE, apiKey: KEY, model: "gpt-6-luna", limits: readAgentConfig({}).limits };
  const reject = (status: number, errBody: unknown) => vi.fn(async () => new Response(JSON.stringify(errBody), { status, headers: { "content-type": "application/json" } }));
  const req = (): ProviderRequest => ({ system: "s", messages: [{ role: "user", content: "سلام" }], tools: toolSpecs(), maxOutputChars: 1400, context: { state: initialAgentState(), userMessage: null, control: null } });

  it("default wire for gpt-5/6/o-series ids is max_completion_tokens without temperature; classic models keep max_tokens + temperature; env overrides win", () => {
    expect(wireOptionsFromEnv({}, "gpt-6-luna")).toEqual({ tokenParam: "max_completion_tokens", sendTemperature: false });
    expect(wireOptionsFromEnv({}, "openai/gpt-6-luna")).toEqual({ tokenParam: "max_completion_tokens", sendTemperature: false });
    expect(wireOptionsFromEnv({}, "gpt-4o-mini")).toEqual({ tokenParam: "max_tokens", sendTemperature: true });
    expect(wireOptionsFromEnv({ AGENT_TOKEN_PARAM: "max_tokens", AGENT_SEND_TEMPERATURE: "1" }, "gpt-6-luna")).toEqual({ tokenParam: "max_tokens", sendTemperature: true });
  });
  it("the provider's error type/code/param/message reaches the operator (redacted, capped), never the request content", async () => {
    const seen: Array<[number, string]> = [];
    const f = reject(400, { error: { message: `Unsupported parameter: 'max_tokens' ... key ${KEY}`, type: "invalid_request_error", param: "max_tokens", code: "unsupported_parameter" } });
    const p = createOpenAiCompatibleProvider({ ...cfg, onProviderError: (s, d) => seen.push([s, d]) }, f as unknown as typeof fetch);
    await expect(p.complete(req())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe(400);
    expect(seen[0]![1]).toContain("code=unsupported_parameter"); expect(seen[0]![1]).toContain("param=max_tokens");
    expect(seen[0]![1]).not.toContain(KEY); expect(seen[0]![1]).not.toContain("سلام");
  });
  it("a 400 is recorded as status_400 and counts toward the breaker; it does not set the 'usage missing' halt", async () => {
    const g = createLiveGuard(opts({ allowedModel: "gpt-6-luna", maxRequests: 5, maxUsd: 1 }));
    const w = g.wrap(reject(400, { error: { message: "bad" } }) as unknown as typeof fetch);
    const r = await w(URL_OK, init(body({ model: "gpt-6-luna" })));
    expect(r.status).toBe(400);
    expect(g.ledger()[0]).toMatchObject({ outcome: "failed", reason: "status_400" });
    expect(g.state().haltReason).not.toBe("usage_metadata_missing");
    expect(g.state().halted).toBe(false);
    await w(URL_OK, init(body({ model: "gpt-6-luna" })));
    expect(g.state()).toMatchObject({ halted: true, haltReason: "circuit_breaker" }); // two failures in a row stop it
  });
});
