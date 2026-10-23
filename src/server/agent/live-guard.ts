import fs from "node:fs";
import path from "node:path";
import { LIVE_MODEL_CALLS_ENABLED_IN_CODE } from "./live-gate";

/**
 * LIVE REQUEST GUARD (Phase 10A, prepared — unreachable while LIVE_MODEL_CALLS_ENABLED_IN_CODE is false).
 * A fetch wrapper placed between the OpenAI-compatible adapter and the network. It enforces, BEFORE a byte is sent:
 *   - deny-by-default destination: exactly `<allowedBaseUrl>/chat/completions`, no redirects, never a user-supplied URL;
 *   - deny-by-default model id and a hard `max_tokens` ≤ the owner cap; an input-size ceiling (conservative token estimate);
 *   - concurrency = 1, a hard request cap (every attempt counts — retries are not free), a USD cap with the WORST-CASE cost reserved first;
 *   - a stop switch checked before every send, and a circuit breaker (consecutive failures ⇒ halted for the process lifetime);
 *   - fail-closed accounting: if the response carries no usable `usage`, the worst case is charged and the guard HALTS.
 * It never logs prompts/responses/keys; the ledger holds counters only. A client-side cap does NOT guarantee provider-side billing stops:
 * the owner must also set the provider-side limit/credit boundary (see docs/live-ai-trial-runbook.md).
 */
export interface LiveGuardOptions {
  allowedBaseUrl: string;
  allowedModel: string;
  maxRequests: number;
  maxUsd: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  /** owner-verified USD per 1,000,000 tokens (from the provider's official page on the trial day) */
  priceInPerM: number;
  priceOutPerM: number;
  breakerThreshold?: number;
  isKilled?: () => boolean;
  /**
   * File that persists the CUMULATIVE budget (requests, reserved/charged USD, halted) across restarts. Read at construction, written (atomic
   * rename) BEFORE every send and after every response. Unreadable/corrupt/unwritable ⇒ the guard refuses everything (fail closed).
   */
  ledgerPath?: string;
}
export interface LiveLedgerEntry { seq: number; at: string; outcome: "ok" | "refused" | "failed"; reason?: string; reservedUsd: number; chargedUsd: number; inputTokens: number | null; outputTokens: number | null }
export interface LiveGuardState { requests: number; spentUsd: number; halted: boolean; haltReason: string | null; consecutiveFailures: number; inFlight: number }

export class LiveGuardError extends Error {
  constructor(public readonly reason: string) { super(`live guard refused: ${reason}`); this.name = "LiveGuardError"; }
}

const USD = (tokens: number, perM: number) => (tokens * perM) / 1_000_000;
/** deliberately pessimistic: 1 token per 2 UTF-8 bytes (real tokenizers are usually ≥ 3–4 bytes/token for Latin, ~2 for Persian) */
export const estimateInputTokens = (bytes: number) => Math.ceil(bytes / 2);

export function createLiveGuard(opts: LiveGuardOptions, now: () => Date = () => new Date()) {
  const threshold = opts.breakerThreshold ?? 2;
  const entries: LiveLedgerEntry[] = [];
  const st: LiveGuardState = { requests: 0, spentUsd: 0, halted: false, haltReason: null, consecutiveFailures: 0, inFlight: 0 };
  const endpoint = `${opts.allowedBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const valid = [opts.maxRequests, opts.maxUsd, opts.maxOutputTokens, opts.maxInputTokens, opts.priceInPerM, opts.priceOutPerM].every((n) => Number.isFinite(n) && n > 0);
  const halt = (reason: string) => { st.halted = true; st.haltReason ??= reason; persistSoon(); };
  let persistSoon: () => void = () => {};
  // ---- persistent cumulative budget (survives restarts) ----
  let persistBroken: string | null = null;
  const persist = () => {
    if (!opts.ledgerPath) return;
    try {
      const tmp = `${opts.ledgerPath}.tmp`;
      fs.mkdirSync(path.dirname(opts.ledgerPath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, requests: st.requests, spentUsd: st.spentUsd, halted: st.halted, haltReason: st.haltReason, updatedAt: now().toISOString() }), { mode: 0o600 });
      fs.renameSync(tmp, opts.ledgerPath);
    } catch { persistBroken = "ledger_unwritable"; }
  };
  persistSoon = persist;
  if (opts.ledgerPath) {
    try {
      if (fs.existsSync(opts.ledgerPath)) {
        const j = JSON.parse(fs.readFileSync(opts.ledgerPath, "utf8")) as { v?: number; requests?: unknown; spentUsd?: unknown; halted?: unknown; haltReason?: unknown };
        if (j.v !== 1 || !Number.isInteger(j.requests) || !(typeof j.spentUsd === "number" && Number.isFinite(j.spentUsd) && j.spentUsd >= 0)) throw new Error("bad ledger");
        st.requests = j.requests as number; st.spentUsd = j.spentUsd;
        if (j.halted === true) { st.halted = true; st.haltReason = typeof j.haltReason === "string" ? j.haltReason : "halted_previous_run"; }
      } else persist();
    } catch { persistBroken = "ledger_unreadable"; }
  }
  const log = (e: Omit<LiveLedgerEntry, "seq" | "at">) => { entries.push({ seq: entries.length + 1, at: now().toISOString(), ...e }); };
  const refuse = (reason: string, haltToo = false): never => { if (haltToo) halt(reason); log({ outcome: "refused", reason, reservedUsd: 0, chargedUsd: 0, inputTokens: null, outputTokens: null }); throw new LiveGuardError(reason); };

  function wrap(inner: typeof fetch): typeof fetch {
    // the real network function is unreachable while the code lock is on — even if this wrapper is constructed
    if (inner === fetch && !LIVE_MODEL_CALLS_ENABLED_IN_CODE) throw new LiveGuardError("code_lock");
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (persistBroken) return refuse(persistBroken, true);
      if (!valid) return refuse("invalid_owner_limits", true);
      if (st.halted) return refuse(`halted:${st.haltReason}`);
      if (opts.isKilled?.()) return refuse("stop_switch", true);
      if (st.inFlight >= 1) return refuse("concurrency");
      if (st.requests >= opts.maxRequests) return refuse("request_cap", true);
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url !== endpoint) return refuse("destination_not_allowlisted");
      if ((init?.method ?? "POST").toUpperCase() !== "POST" || typeof init?.body !== "string") return refuse("unexpected_request_shape");
      let body: { model?: unknown; max_tokens?: unknown };
      try { body = JSON.parse(init.body) as typeof body; } catch { return refuse("body_not_json"); }
      if (body.model !== opts.allowedModel) return refuse("model_not_allowlisted");
      if (typeof body.max_tokens !== "number" || !(body.max_tokens > 0) || body.max_tokens > opts.maxOutputTokens) return refuse("max_tokens_missing_or_over_cap");
      const inTok = estimateInputTokens(Buffer.byteLength(init.body, "utf8"));
      if (inTok > opts.maxInputTokens) return refuse("input_over_cap");
      const worst = USD(inTok, opts.priceInPerM) + USD(body.max_tokens, opts.priceOutPerM);
      if (st.spentUsd + worst > opts.maxUsd) return refuse("usd_cap", true);

      st.inFlight++; st.requests++; st.spentUsd += worst;               // reserve the worst case BEFORE sending
      persist();
      if (persistBroken) { st.inFlight--; st.requests--; st.spentUsd -= worst; return refuse(persistBroken, true); } // cannot record the spend ⇒ do not spend
      let res: Response;
      try {
        res = await inner(url, { ...init, redirect: "error" });
      } catch (e) {
        st.inFlight--; st.consecutiveFailures++;                        // charge stays reserved: a timed-out call may still have been billed
        log({ outcome: "failed", reason: "network", reservedUsd: worst, chargedUsd: worst, inputTokens: null, outputTokens: null });
        if (st.consecutiveFailures >= threshold) halt("circuit_breaker");
        persist();
        throw e;
      }
      st.inFlight--;
      type Usage = { prompt_tokens?: unknown; completion_tokens?: unknown };
      let usage = null as Usage | null;
      try { const j = (await res.clone().json()) as { usage?: Usage }; usage = j.usage ?? null; } catch { usage = null; }
      const pt = usage?.prompt_tokens; const ct = usage?.completion_tokens;
      if (typeof pt === "number" && typeof ct === "number" && Number.isFinite(pt) && Number.isFinite(ct) && pt >= 0 && ct >= 0) {
        const actual = USD(pt, opts.priceInPerM) + USD(ct, opts.priceOutPerM);
        st.spentUsd += actual - worst;                                  // replace the reservation by the reported usage
        if (actual > worst) halt("usage_exceeded_estimate");
        log({ outcome: res.ok ? "ok" : "failed", reason: res.ok ? undefined : `status_${res.status}`, reservedUsd: worst, chargedUsd: Math.max(actual, 0), inputTokens: pt, outputTokens: ct });
      } else {
        halt("usage_metadata_missing");                                 // uncertainty ⇒ the worst case stays charged and nothing more is sent
        log({ outcome: res.ok ? "ok" : "failed", reason: "usage_metadata_missing", reservedUsd: worst, chargedUsd: worst, inputTokens: null, outputTokens: null });
      }
      if (res.ok) st.consecutiveFailures = 0;
      else { st.consecutiveFailures++; if (st.consecutiveFailures >= threshold) halt("circuit_breaker"); }
      persist();
      return res;
    }) as typeof fetch;
  }
  return { wrap, state: (): LiveGuardState => ({ ...st }), ledger: (): readonly LiveLedgerEntry[] => entries.slice() };
}

/** Owner-supplied limits from the environment; null (⇒ stays locked) unless EVERY value is present and sane. */
export function liveGuardOptionsFromEnv(env: Record<string, string | undefined>, killFileExists: () => boolean = () => false): LiveGuardOptions | null {
  const n = (v: string | undefined) => Number(v);
  const o: LiveGuardOptions = {
    allowedBaseUrl: (env.AGENT_LIVE_ALLOW_BASE_URL ?? "").trim(), allowedModel: (env.AGENT_LIVE_ALLOW_MODEL ?? "").trim(),
    maxRequests: n(env.AGENT_LIVE_MAX_REQUESTS), maxUsd: n(env.AGENT_LIVE_MAX_USD), maxOutputTokens: n(env.AGENT_LIVE_MAX_TOKENS),
    maxInputTokens: n(env.AGENT_LIVE_MAX_INPUT_TOKENS), priceInPerM: n(env.AGENT_LIVE_PRICE_IN_PER_M), priceOutPerM: n(env.AGENT_LIVE_PRICE_OUT_PER_M),
    isKilled: () => env.AGENT_LIVE_KILL === "1" || killFileExists(),
    ledgerPath: (env.AGENT_LIVE_LEDGER_PATH ?? "").trim() || undefined,
  };
  if (!o.ledgerPath) return null;
  if (!o.allowedBaseUrl.startsWith("https://") || !o.allowedModel) return null;
  if (![o.maxRequests, o.maxUsd, o.maxOutputTokens, o.maxInputTokens, o.priceInPerM, o.priceOutPerM].every((x) => Number.isFinite(x) && x > 0)) return null;
  return o;
}
