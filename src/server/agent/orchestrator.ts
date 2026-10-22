import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AgentAction, AgentCard, AgentControl, AgentState, AgentTurnResponse, ClarifyView, FallbackReason, ToolName, ToolTraceEntry } from "@/domain/agent";
import { sanitizeText } from "@/domain/inquiry-parse";
import { renderAnswer, type ToolRun } from "./answer";
import { agentLog, providerInfo, redact, type AgentConfig } from "./config";
import { validateAssistantText } from "./grounding";
import { understand, type Understanding } from "./intent";
import { Ledger } from "./ledger";
import { ProviderError, SYSTEM_PROMPT, type LlmProvider, type ProviderMessage, type ProviderToolCall, type ToolSpec } from "./provider";
import { createMockProvider } from "./providers/mock";
import { applyControl } from "./state";
import { isToolName, TOOLS, type ToolContext, type ToolOutput } from "./tools";
import { TOOL_NAMES } from "@/domain/agent";

export interface TurnInput {
  db: DatabaseSync;
  config: AgentConfig;
  /** the configured provider (may be the mock). Controls and fallbacks always use the deterministic planner. */
  provider: LlmProvider;
  state: AgentState;
  message: string | null;
  control: AgentControl | null;
  now?: Date;
  signal?: AbortSignal;
}

export function toolSpecs(): ToolSpec[] {
  return TOOL_NAMES.map((n) => ({ name: n, description: TOOLS[n].description, parameters: z.toJSONSchema(TOOLS[n].args) as Record<string, unknown> }));
}

class Abort extends Error { constructor(public readonly reason: FallbackReason) { super(reason); } }

const withTimeout = <T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(onTimeout()), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const argsSummary = (a: unknown) => { try { return JSON.stringify(a).slice(0, 80); } catch { return "?"; } };
/** untrusted (unvalidated) arguments are never echoed to the client: only their key names */
const keysOnly = (a: unknown) => (a && typeof a === "object" ? `{${Object.keys(a as object).slice(0, 6).map((k) => k.replace(/[^\w]/g, "").slice(0, 20)).join(",")}}` : "{}");

interface ExecResult { state: AgentState; text: string; groundingFallback: boolean; cards: AgentCard[]; actions: AgentAction[]; clarify: ClarifyView | null; trace: ToolTraceEntry[]; runs: ToolRun[]; notices: string[] }

async function execute(inp: TurnInput, provider: LlmProvider, state0: AgentState, understanding: Understanding | null): Promise<ExecResult> {
  const { db, config } = inp;
  const L = config.limits;
  const now = inp.now ?? new Date();
  const deadline = Date.now() + L.turnDeadlineMs;
  const ledger = new Ledger();
  // numbers the USER supplied (budget, radius) are legitimate to repeat
  ledger.num(state0.budget.min, state0.budget.max);
  ledger.meters(state0.radius);
  let state = state0;
  const cards = new Map<string, AgentCard>();
  const actions: AgentAction[] = [];
  let clarify: ClarifyView | null = null;
  const trace: ToolTraceEntry[] = [];
  const runs: ToolRun[] = [];
  const notices: string[] = [];
  const messages: ProviderMessage[] = inp.message ? [{ role: "user", content: sanitizeText(inp.message, L.maxMessageChars) }] : [];
  const specs = toolSpecs();
  const cache = new Map<string, string>();
  let toolCount = 0;
  let dupes = 0;

  const runTool = async (c: ProviderToolCall): Promise<string> => {
    const t0 = Date.now();
    const name = c.name;
    const done = (status: ToolTraceEntry["status"], tool: ToolTraceEntry["tool"], payload: Record<string, unknown>): string => { trace.push({ tool, status, ms: Date.now() - t0, argsSummary: keysOnly(c.arguments) }); return JSON.stringify(payload); };
    if (!isToolName(name)) return done("invalid_args", "unknown_tool", { tool: "unknown", status: "invalid_args", summary: { error: "unknown or disallowed tool" } });
    let raw: string;
    try { raw = JSON.stringify(c.arguments ?? {}); } catch { return done("invalid_args", name, { tool: name, status: "invalid_args", summary: { error: "arguments not serialisable" } }); }
    if (raw.length > L.maxToolArgBytes) return done("invalid_args", name, { tool: name, status: "invalid_args", summary: { error: "arguments too large" } });
    const def = TOOLS[name];
    const parsed = def.args.safeParse(c.arguments ?? {});
    if (!parsed.success) return done("invalid_args", name, { tool: name, status: "invalid_args", summary: { error: parsed.error.issues[0]?.message ?? "invalid arguments" } });
    const key = `${name}:${JSON.stringify(parsed.data)}:${JSON.stringify(state.selection)}:${state.selectedShopIds.join(",")}`;
    const hit = cache.get(key);
    if (hit) { dupes++; if (dupes >= 2) throw new Abort("TOOL_LOOP_LIMIT"); return done("ok", name, { ...JSON.parse(hit), duplicateCall: true }); }
    const ctx: ToolContext = { db, state, userMessage: inp.message ? sanitizeText(inp.message, L.maxMessageChars) : null, understanding, ledger, config, now };
    let out: ToolOutput;
    try {
      out = await withTimeout(Promise.resolve(def.run(ctx, parsed.data as never)), L.toolTimeoutMs, () => new Error("tool timeout"));
    } catch (e) {
      return done("error", name, { tool: name, status: "error", summary: { error: redact(e instanceof Error ? e.message : "tool failed").slice(0, 80) } });
    }
    if (out.patch) state = out.patch(state);
    for (const cd of out.cards) cards.set(cd.id, cd);
    for (const a of out.actions) if (!actions.some((x) => x.kind === a.kind && x.label === a.label)) actions.push(a);
    if (out.clarify) clarify = out.clarify; else if (out.status === "ok") clarify = name === "advise_products" || name === "find_sellers_for_product" || name === "get_product_details" ? null : clarify;
    runs.push({ tool: name, status: out.status, summary: out.summary, notes: out.notes });
    let payload = JSON.stringify({ tool: name, status: out.status, summary: out.summary, notes: out.notes, clarify: out.clarify ? { text: out.clarify.text } : null });
    if (payload.length > L.maxToolResultChars) payload = JSON.stringify({ tool: name, status: out.status, summary: { truncated: true }, notes: out.notes.slice(0, 2) });
    cache.set(key, payload);
    trace.push({ tool: name, status: out.status, ms: Date.now() - t0, argsSummary: argsSummary(parsed.data) });
    return payload;
  };

  for (let hop = 0; hop < L.maxHops; hop++) {
    if (Date.now() > deadline) throw new Abort("BUDGET_EXCEEDED");
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    inp.signal?.addEventListener("abort", onAbort, { once: true });
    let resp;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          resp = await withTimeout(provider.complete({ system: SYSTEM_PROMPT, messages, tools: specs, maxOutputChars: L.maxOutputChars, signal: ac.signal, context: { state, userMessage: inp.message, control: inp.control } }), L.providerTimeoutMs, () => { ac.abort(); return new ProviderError("TIMEOUT", "provider timeout", true); });
          break;
        } catch (e) {
          if (e instanceof ProviderError && e.retryable && e.code !== "TIMEOUT" && attempt < L.providerRetries) { await sleep(150 * (attempt + 1)); continue; }
          throw e;
        }
      }
    } catch (e) {
      if (e instanceof Abort) throw e;
      if (e instanceof ProviderError) throw new Abort(e.code === "TIMEOUT" ? "PROVIDER_TIMEOUT" : e.code === "RATE_LIMITED" ? "PROVIDER_RATE_LIMITED" : e.code === "INVALID_RESPONSE" ? "INVALID_PROVIDER_OUTPUT" : "PROVIDER_UNAVAILABLE");
      throw new Abort("PROVIDER_UNAVAILABLE");
    } finally {
      inp.signal?.removeEventListener("abort", onAbort);
    }

    if (resp.kind === "final") {
      const text = sanitizeText(resp.text, L.maxOutputChars);
      const g = validateAssistantText(text, ledger, L.maxOutputChars);
      if (g.ok) return { state, text, groundingFallback: false, cards: [...cards.values()], actions, clarify, trace, runs, notices };
      agentLog("grounding_rejected", { violations: g.violations.slice(0, 5).join(","), provider: provider.info.id }, config);
      // the model's words are discarded; the answer is rebuilt from tool results only
      const safe = renderAnswer({ state, runs, clarify, fallback: null });
      return { state, text: safe, groundingFallback: true, cards: [...cards.values()], actions, clarify, trace, runs, notices: provider.info.isLanguageModel ? [...notices, "متن مدل به‌دلیل ادعای پشتیبانی‌نشده رد شد؛ پاسخ از روی نتایج ابزارها بازسازی شد."] : notices };
    }
    if (!resp.calls.length || !Array.isArray(resp.calls)) throw new Abort("INVALID_PROVIDER_OUTPUT");
    const calls = resp.calls.slice(0, L.maxCallsPerHop);
    messages.push({ role: "assistant", content: "", toolCalls: calls });
    for (const c of calls) {
      if (++toolCount > L.maxToolCalls) throw new Abort("TOOL_LOOP_LIMIT");
      const content = await runTool(c);
      messages.push({ role: "tool", toolCallId: c.id, name: c.name, content });
    }
  }
  throw new Abort("TOOL_LOOP_LIMIT");
}

/** the most advanced artefact of a turn replaces the intermediate cards that fed it (a comparison already lists its sellers) */
export function pruneCards(cards: AgentCard[]): AgentCard[] {
  const has = (t: AgentCard["type"]) => cards.some((c) => c.type === t);
  if (has("inquiry")) return cards.filter((c) => c.type === "inquiry" || c.type === "notice" || c.type === "outcome");
  if (has("comparison")) return cards.filter((c) => c.type !== "seller" && c.type !== "product");
  if (has("outcome")) return cards.filter((c) => c.type === "outcome" || c.type === "notice");
  return cards;
}

/** suggestions for the next step, derived from state + what ran; every href comes from a route builder inside a tool */
function nextActions(state: AgentState, runs: ToolRun[]): AgentAction[] {
  const out: AgentAction[] = [];
  const ran = (t: ToolName) => runs.some((r) => r.tool === t);
  if (state.selection && !ran("find_sellers_for_product") && state.stage <= 2) out.push({ kind: "suggest", label: "فروشنده‌های نزدیک را نشان بده", message: "فروشنده‌های نزدیک را نشان بده" });
  if (ran("find_sellers_for_product") && !ran("compare_sellers")) out.push({ kind: "suggest", label: "فروشنده‌ها را مقایسه کن", message: "فروشنده‌ها را مقایسه کن" });
  if (state.selection && !ran("get_external_evidence")) out.push({ kind: "suggest", label: "مشخصات یا نظر بیرونی دارد؟", message: "نظر و مشخصات بیرونی این محصول را بگو" });
  if (ran("compare_sellers") && !ran("compose_seller_inquiry")) out.push({ kind: "suggest", label: "پیش‌نویس پرسش بنویس", message: "برای فروشنده‌ی اول پیش‌نویس سؤال بنویس" });
  return out.slice(0, 3);
}

export async function runTurn(inp: TurnInput): Promise<AgentTurnResponse> {
  const t0 = Date.now();
  const { config } = inp;
  const message = inp.message ? sanitizeText(inp.message, config.limits.maxMessageChars) : null;
  let base = inp.state;
  if (inp.control) base = applyControl(base, inp.control);
  const understanding = message ? understand(inp.db, message) : null;
  const deterministic = createMockProvider();
  // structured controls never need (or spend) a language model; free text uses the configured provider
  const primary = message ? inp.provider : deterministic;
  let used = primary;
  let fb: FallbackReason | null = null;
  let res: ExecResult;
  try {
    res = await execute({ ...inp, message }, primary, base, understanding);
  } catch (e) {
    const reason: FallbackReason = e instanceof Abort ? e.reason : "PROVIDER_UNAVAILABLE";
    agentLog("fallback", { reason, provider: primary.info.id }, config);
    if (primary === deterministic) {
      // even the deterministic path failed: return the unchanged state with an honest notice rather than a guess
      return { ok: true, state: base, assistant: { text: "الان نتوانستم این درخواست را اجرا کنم. دوباره تلاش کنید یا از کنترل‌های صفحه استفاده کنید.", groundingFallback: false }, cards: [{ type: "notice", id: "n:err", badges: ["UNKNOWN"], tone: "error", text: "خطای داخلی در اجرای ابزارها؛ چیزی تغییر نکرد." }], actions: [], clarify: null, trace: [], provider: deterministic.info, fallback: { used: true, reason }, notices: [], durationMs: Date.now() - t0 };
    }
    used = deterministic;
    fb = reason;
    res = await execute({ ...inp, message }, deterministic, base, understanding);
    res.notices.push(reason === "PROVIDER_TIMEOUT" ? "مدل زبانی پاسخ نداد؛ با جست‌وجوی قطعی ادامه دادم." : reason === "PROVIDER_RATE_LIMITED" ? "مدل زبانی موقتاً محدود شده؛ با جست‌وجوی قطعی ادامه دادم." : reason === "TOOL_LOOP_LIMIT" ? "چرخه‌ی ابزارها از حد مجاز گذشت؛ با جست‌وجوی قطعی ادامه دادم." : "مدل زبانی در دسترس نبود؛ با جست‌وجوی قطعی ادامه دادم.");
  }
  const actions = [...res.actions, ...nextActions(res.state, res.runs)];
  const cardsOut = pruneCards(res.cards).slice(-14);
  const resp: AgentTurnResponse = {
    ok: true, state: res.state, assistant: { text: res.text, groundingFallback: res.groundingFallback }, cards: cardsOut, actions: actions.slice(0, 8), clarify: res.clarify,
    trace: res.trace, provider: used === deterministic && inp.provider.info.id !== "mock" && !message ? providerInfo({ ...config, provider: "mock" }) : used.info,
    fallback: { used: fb !== null, reason: fb }, notices: res.notices, durationMs: Date.now() - t0,
  };
  agentLog("turn", { provider: used.info.id, tools: res.trace.length, fallback: fb ?? "none", grounding: res.groundingFallback, ms: resp.durationMs, stage: res.state.stage }, config);
  return resp;
}
