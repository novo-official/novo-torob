import type { ProviderInfo } from "@/domain/agent";
import { liveGate, type LiveGate } from "./live-gate";

/**
 * Server-only agent configuration. Nothing here is ever sent to the client except `publicStatus()`.
 *   AGENT_PROVIDER      mock (default: deterministic offline planner, NOT a language model) | openai-compatible | disabled
 *   AGENT_MODEL         model name for the openai-compatible adapter
 *   AGENT_BASE_URL      https base URL of an OpenAI-compatible endpoint (never guessed)
 *   AGENT_API_KEY       secret; read only here, redacted from every log/error
 *   AGENT_EVIDENCE_MODE off (default) | fixture (QA/demo; clearly labelled synthetic) | live (allowlisted adapters only; needs AGENT_EXTERNAL_LIVE=1)
 * A configured provider is NOT proof of a successful live call: `liveVerified` stays false until a human runs the documented live check.
 */
/** `live-locked`: a live provider was requested but the live gate (see live-gate.ts) is closed → fail closed, NO mock substitution, NO network */
export type ProviderKind = "mock" | "openai-compatible" | "disabled" | "live-locked";
export type EvidenceMode = "off" | "fixture" | "live";

export interface AgentConfig {
  provider: ProviderKind;
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  evidenceMode: EvidenceMode;
  /** AGENT_EVIDENCE_REPRODUCE=1 — the OWNER decided that quoting short spans of third-party pages is allowed (rights checked). Default: link-only. */
  evidenceReproduce: boolean;
  limits: AgentLimits;
  liveGate: LiveGate;
}

export interface AgentLimits {
  maxHops: number;
  maxToolCalls: number;
  maxCallsPerHop: number;
  toolTimeoutMs: number;
  providerTimeoutMs: number;
  turnDeadlineMs: number;
  maxMessageChars: number;
  maxBodyBytes: number;
  maxToolArgBytes: number;
  maxToolResultChars: number;
  maxOutputChars: number;
  maxContextChars: number;
  ratePerMinute: number;
  maxConcurrent: number;
  providerRetries: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxHops: 6, maxToolCalls: 10, maxCallsPerHop: 3, toolTimeoutMs: 8_000, providerTimeoutMs: 20_000, turnDeadlineMs: 28_000,
  maxMessageChars: 600, maxBodyBytes: 24_000, maxToolArgBytes: 2_000, maxToolResultChars: 6_000, maxOutputChars: 1_400, maxContextChars: 24_000,
  ratePerMinute: 30, maxConcurrent: 4, providerRetries: 1,
};

const num = (v: string | undefined, d: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.trunc(n) : d; };
const httpsUrl = (v: string | undefined): string | null => {
  if (!v) return null;
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password ? u.toString().replace(/\/$/, "") : null; } catch { return null; }
};

export function readAgentConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const p = (env.AGENT_PROVIDER ?? "mock").trim().toLowerCase();
  const gate = liveGate(env);
  // a requested live provider is `live-locked` unless EVERY live condition holds; there is no silent fallback to the mock
  let provider: ProviderKind = p === "openai-compatible" ? (gate.open ? "openai-compatible" : "live-locked") : p === "disabled" ? "disabled" : "mock";
  const baseUrl = httpsUrl(env.AGENT_BASE_URL);
  // server-side env only; BOXAPI_API_KEY is the name the hackathon reference uses, AGENT_API_KEY stays as an alias
  const apiKey = (env.BOXAPI_API_KEY ?? env.AGENT_API_KEY)?.trim() || null;
  const model = env.AGENT_MODEL?.trim().slice(0, 80) || null;
  // an incomplete configuration of an OPEN gate stays closed too (never guess an endpoint/model)
  if (provider === "openai-compatible" && (!baseUrl || !apiKey || !model)) provider = "live-locked";
  const m = (env.AGENT_EVIDENCE_MODE ?? "off").trim().toLowerCase();
  const evidenceMode: EvidenceMode = m === "fixture" ? "fixture" : m === "live" && env.AGENT_EXTERNAL_LIVE === "1" ? "live" : "off";
  return {
    provider, model: provider === "openai-compatible" ? model : null, baseUrl: provider === "openai-compatible" ? baseUrl : null, apiKey: provider === "openai-compatible" ? apiKey : null, evidenceMode, evidenceReproduce: env.AGENT_EVIDENCE_REPRODUCE === "1", liveGate: gate,
    limits: {
      ...DEFAULT_LIMITS,
      maxHops: num(env.AGENT_MAX_HOPS, DEFAULT_LIMITS.maxHops, 1, 8),
      ratePerMinute: num(env.AGENT_RATE_PER_MIN, DEFAULT_LIMITS.ratePerMinute, 1, 600),
      maxConcurrent: num(env.AGENT_MAX_CONCURRENT, DEFAULT_LIMITS.maxConcurrent, 1, 32),
      providerTimeoutMs: num(env.AGENT_PROVIDER_TIMEOUT_MS, DEFAULT_LIMITS.providerTimeoutMs, 500, 60_000),
      // a live model answers in seconds per hop (measured 3-10 s on gpt-6-luna), so the whole-turn deadline is tunable; default unchanged
      turnDeadlineMs: num(env.AGENT_TURN_DEADLINE_MS, DEFAULT_LIMITS.turnDeadlineMs, 5_000, 120_000),
      // a retry against a paid endpoint is a second charge: none for the live provider (the guard counts every attempt anyway)
      providerRetries: provider === "openai-compatible" ? 0 : DEFAULT_LIMITS.providerRetries,
    },
  };
}

export function providerInfo(c: AgentConfig): ProviderInfo {
  if (c.provider === "openai-compatible") return { id: "openai-compatible", labelFa: `مدل زبانی (${c.model}) — اتصال زنده هنوز تأیید نشده`, isLanguageModel: true, liveVerified: false, model: c.model };
  if (c.provider === "live-locked") return { id: "locked", labelFa: "مدل زنده قفل است — بدون تأیید مالک و سقف هزینه فعال نمی‌شود", isLanguageModel: false, liveVerified: false, model: null };
  if (c.provider === "mock") return { id: "mock", labelFa: "حالت آفلاین/نمایشی — برنامه‌ریز قطعی، نه مدل زبانی", isLanguageModel: false, liveVerified: false, model: null };
  return { id: "none", labelFa: "دستیار غیرفعال است", isLanguageModel: false, liveVerified: false, model: null };
}

/** What the browser may know. NEVER the key, base URL or model credentials. */
export function publicStatus(c: AgentConfig) {
  return { enabled: c.provider === "mock" || c.provider === "openai-compatible", provider: providerInfo(c), lockedReasonFa: c.provider === "live-locked" ? c.liveGate.reasonFa : null, evidenceMode: c.evidenceMode, maxMessageChars: c.limits.maxMessageChars };
}

/** Remove anything that looks like a credential before it reaches a log line or an error message. */
export function redact(text: string, secrets: Array<string | null | undefined> = []): string {
  let t = String(text);
  for (const s of secrets) if (s && s.length >= 6) t = t.split(s).join("[REDACTED]");
  return t
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(sk|rk|pk|key|tok|api)[-_][A-Za-z0-9_\-]{12,}\b/gi, "[REDACTED]")
    .replace(/(api[_-]?key|authorization|secret|password|token)(["'\s:=]+)[^\s"',}]{6,}/gi, "$1$2[REDACTED]");
}

/** Structured, redacted, content-free log line (no user text, no tool results). */
export function agentLog(event: string, data: Record<string, string | number | boolean | null>, cfg?: AgentConfig): void {
  if (process.env.NODE_ENV === "test" && process.env.AGENT_LOG !== "1") return;
  const line = redact(JSON.stringify({ t: new Date().toISOString(), event, ...data }), [cfg?.apiKey]);
  console.log(`[agent] ${line}`);
}
