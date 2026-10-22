import { readAgentConfig, type AgentConfig } from "./config";
import { RateLimiter, Semaphore } from "./guard";
import type { LlmProvider } from "./provider";
import { createMockProvider } from "./providers/mock";
import { ProviderError } from "./provider";
import { providerInfo } from "./config";
import { createOpenAiCompatibleProvider } from "./providers/openai-compatible";
import { createLiveGuard, liveGuardOptionsFromEnv } from "./live-guard";
import { existsSync } from "node:fs";

/** a provider that cannot talk to anything: calling it is a bug, and it says so (no network, no mock answer) */
export function createLockedProvider(config: AgentConfig): LlmProvider {
  return { info: providerInfo(config), async complete() { throw new ProviderError("UNAVAILABLE", "provider is locked or disabled", false); } };
}

export interface AgentRuntime { config: AgentConfig; provider: LlmProvider; limiter: RateLimiter; gate: Semaphore }

let cached: AgentRuntime | null = null;

/** live provider = adapter + LiveGuard-wrapped transport; any missing owner limit (or the code lock) ⇒ a provider that cannot talk to anything */
function buildLiveProvider(config: AgentConfig): LlmProvider {
  const opts = liveGuardOptionsFromEnv(process.env, () => existsSync(".live-kill"));
  if (!opts || opts.allowedModel !== config.model || opts.allowedBaseUrl.replace(/\/$/, "") !== (config.baseUrl ?? "")) return createLockedProvider(config);
  try { return createOpenAiCompatibleProvider({ ...config, maxOutputTokens: opts.maxOutputTokens }, createLiveGuard(opts).wrap(fetch)); } catch { return createLockedProvider(config); }
}

export function buildRuntime(config: AgentConfig = readAgentConfig()): AgentRuntime {
  // the live adapter is constructed ONLY when the gate is open (never before the owner-approved Phase 10B); a locked provider can never be called
  const provider = config.provider === "openai-compatible" ? buildLiveProvider(config) : config.provider === "live-locked" || config.provider === "disabled" ? createLockedProvider(config) : createMockProvider();
  return { config, provider, limiter: new RateLimiter(config.limits.ratePerMinute), gate: new Semaphore(config.limits.maxConcurrent) };
}
export function getRuntime(): AgentRuntime { return (cached ??= buildRuntime()); }
/** test hook: inject a runtime (scripted provider, tiny limits, evidence fixtures…) */
export function setRuntimeForTests(r: AgentRuntime | null): void { cached = r; }
