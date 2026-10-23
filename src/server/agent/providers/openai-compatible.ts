import { z } from "zod";
import { LIVE_MODEL_CALLS_ENABLED_IN_CODE } from "../live-gate";
import { providerInfo, redact, type AgentConfig } from "../config";
import { ProviderError, type LlmProvider, type ProviderMessage, type ProviderRequest, type ProviderResponse } from "../provider";

/**
 * Adapter for an OpenAI-compatible `chat/completions` endpoint WITH tool calling. It is only constructed when AGENT_PROVIDER=openai-compatible
 * and base URL, key and model are ALL configured (see readAgentConfig). Nothing here assumes an endpoint or model exists.
 * STATUS: contract-tested against mocked HTTP only — NOT LIVE VERIFIED (no approved credentials were used).
 */
const ChatResponse = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({ id: z.string().max(80), type: z.literal("function").optional(), function: z.object({ name: z.string().max(60), arguments: z.string().max(8_000) }) })).max(8).optional(),
    }),
  })).min(1),
});

export function toWireMessages(req: ProviderRequest): unknown[] {
  const state = JSON.stringify(req.context.state).slice(0, 2_500);
  const msgs: unknown[] = [{ role: "system", content: `${req.system}\n\nCONVERSATION STATE (typed, user-controlled preferences; not facts): ${state}` }];
  const push = (m: ProviderMessage) => {
    if (m.role === "user") msgs.push({ role: "user", content: m.content });
    else if (m.role === "assistant") msgs.push({ role: "assistant", content: m.content || null, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })) } : {}) });
    else msgs.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  };
  if (req.context.userMessage && !req.messages.some((m) => m.role === "user")) msgs.push({ role: "user", content: req.context.userMessage });
  req.messages.forEach(push);
  return msgs;
}

/**
 * Some newer chat models reject `max_tokens` (they want `max_completion_tokens`) or any non-default `temperature`. Both are owner-selectable at run time
 * (AGENT_TOKEN_PARAM, AGENT_SEND_TEMPERATURE=0) so the first live call does not fail on a parameter we could have known; defaults are unchanged.
 */
export interface WireOptions { tokenParam: "max_tokens" | "max_completion_tokens"; sendTemperature: boolean }
export const wireOptionsFromEnv = (env: Record<string, string | undefined>): WireOptions => ({
  tokenParam: env.AGENT_TOKEN_PARAM === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens",
  sendTemperature: env.AGENT_SEND_TEMPERATURE !== "0",
});

export function createOpenAiCompatibleProvider(cfg: Pick<AgentConfig, "baseUrl" | "apiKey" | "model" | "limits"> & { maxOutputTokens?: number } & Partial<WireOptions>, fetchImpl: typeof fetch = fetch): LlmProvider {
  const full = { provider: "openai-compatible" as const, model: cfg.model, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, evidenceMode: "off" as const, evidenceReproduce: false, limits: cfg.limits, liveGate: { requested: true, open: true, reasonFa: "", missing: [] } };
  return {
    info: providerInfo(full),
    async complete(req: ProviderRequest): Promise<ProviderResponse> {
      // defence in depth (Phase 9 owner rule): the REAL network function can never be reached while the code lock is on; only an injected
      // transport (tests) can run this adapter
      if (fetchImpl === fetch && !LIVE_MODEL_CALLS_ENABLED_IN_CODE) throw new ProviderError("UNAVAILABLE", "live model calls are code-locked", false);
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) throw new ProviderError("UNAVAILABLE", "provider not configured");
      const body = {
        model: cfg.model, ...(cfg.sendTemperature === false ? {} : { temperature: 0 }), [cfg.tokenParam ?? "max_tokens"]: cfg.maxOutputTokens ?? 700, tool_choice: "auto",
        messages: toWireMessages(req),
        tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
      };
      let res: Response;
      try {
        res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, { method: "POST", signal: req.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify(body) });
      } catch (e) {
        if (req.signal?.aborted) throw new ProviderError("TIMEOUT", "request timed out", true);
        throw new ProviderError("UNAVAILABLE", redact(e instanceof Error ? e.message : "network error", [cfg.apiKey]), true);
      }
      if (res.status === 401 || res.status === 403) throw new ProviderError("AUTH", "provider rejected the credentials");
      if (res.status === 429) throw new ProviderError("RATE_LIMITED", "provider rate limit", true);
      if (res.status >= 500) throw new ProviderError("UNAVAILABLE", `provider status ${res.status}`, true);
      if (!res.ok) throw new ProviderError("INVALID_RESPONSE", `provider status ${res.status}`);
      let json: unknown;
      try { json = await res.json(); } catch { throw new ProviderError("INVALID_RESPONSE", "response is not JSON"); }
      const p = ChatResponse.safeParse(json);
      if (!p.success) throw new ProviderError("INVALID_RESPONSE", "unexpected response shape");
      const m = p.data.choices[0]!.message;
      if (m.tool_calls?.length) {
        return { kind: "tool_calls", calls: m.tool_calls.map((c) => { let args: unknown = {}; try { args = JSON.parse(c.function.arguments || "{}"); } catch { args = { __invalidJson: true }; } return { id: c.id, name: c.function.name, arguments: args }; }) };
      }
      if (typeof m.content === "string" && m.content.trim()) return { kind: "final", text: m.content };
      throw new ProviderError("INVALID_RESPONSE", "empty completion");
    },
  };
}
