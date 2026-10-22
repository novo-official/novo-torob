import type { AgentControl, ToolName } from "@/domain/agent";
import { suggestFromText } from "@/domain/inquiry-parse";
import { renderAnswer, type ToolRun } from "../answer";
import { providerInfo, readAgentConfig } from "../config";
import type { LlmProvider, ProviderMessage, ProviderRequest, ProviderResponse, ProviderToolCall } from "../provider";

/**
 * The OFFLINE / DEMO provider: a deterministic, rule-based planner that emits exactly the kind of multi-turn tool calls a model would,
 * so the whole pipeline (validation, grounding, fallback, UI) runs without any network, key or cost.
 * It is NOT a language model and is always labelled so (`info.isLanguageModel === false`).
 */
let seq = 0;
const call = (name: ToolName, args: Record<string, unknown> = {}): ProviderToolCall => ({ id: `mock_${++seq}`, name, arguments: args });

/** parse the structured tool results the orchestrator appended to the conversation */
export function runsFromMessages(messages: ProviderMessage[]): Array<ToolRun & { args: unknown }> {
  const out: Array<ToolRun & { args: unknown }> = [];
  const argsById = new Map<string, unknown>();
  for (const m of messages) if (m.role === "assistant") for (const c of m.toolCalls ?? []) argsById.set(c.id, c.arguments);
  for (const m of messages) {
    if (m.role !== "tool") continue;
    try { const j = JSON.parse(m.content) as { tool: ToolName; status: ToolRun["status"]; summary: Record<string, unknown>; notes?: string[]; clarify?: { text?: string } | null }; out.push({ tool: j.tool, status: j.status, summary: { ...(j.summary ?? {}), ...(j.clarify?.text ? { __clarifyText: j.clarify.text } : {}) }, notes: j.notes ?? [], args: argsById.get(m.toolCallId) }); } catch { /* ignore */ }
  }
  return out;
}

interface UnderstandSummary { category: string | null; model: string | null; intents: string[]; hasNeed: boolean; district: string | null; radiusMeters: number | null }

export function planNext(req: ProviderRequest): ProviderToolCall[] | null {
  const { state, userMessage } = req.context;
  const control = req.context.control as AgentControl | null;
  const runs = runsFromMessages(req.messages);
  const has = (t: ToolName) => runs.some((r) => r.tool === t);
  const lastRun = (t: ToolName) => runs.filter((r) => r.tool === t).at(-1);
  const sel = state.selection;

  // ---- structured controls (no text): deterministic refresh of exactly the affected stage
  if (control && !userMessage) {
    switch (control.type) {
      case "reset": case "set_visit": return control.type === "set_visit" && sel && state.selectedShopIds.length >= 2 && !has("compare_sellers") ? [call("compare_sellers", { shopIds: state.selectedShopIds })] : null;
      case "answer": case "skip_question": return !has("advise_products") ? [call("advise_products", {})] : null;
      case "select_product":
        if (!has("get_product_details")) return [call("get_product_details", { productId: control.productId })];
        if (!has("find_sellers_for_product")) return [call("find_sellers_for_product", {})];
        return null;
      case "set_origin": case "set_radius":
        if (sel && state.stage >= 2 && !has("find_sellers_for_product")) return [call("find_sellers_for_product", {})];
        if (sel && state.stage === 3 && state.selectedShopIds.length >= 2 && !has("compare_sellers")) return [call("compare_sellers", { shopIds: state.selectedShopIds })];
        return null;
      case "set_budget":
        if (!sel && (state.category || state.text) && !has("advise_products")) return [call("advise_products", {})];
        if (sel && state.stage === 3 && state.selectedShopIds.length >= 2 && !has("compare_sellers")) return [call("compare_sellers", { shopIds: state.selectedShopIds })];
        return null;
      case "set_priority": return sel && state.selectedShopIds.length >= 2 && !has("compare_sellers") ? [call("compare_sellers", { shopIds: state.selectedShopIds, priority: control.priority })] : null;
      case "select_shops": return !has("compare_sellers") ? [call("compare_sellers", { shopIds: control.shopIds })] : null;
      case "select_offer": return !has("compose_seller_inquiry") ? [call("compose_seller_inquiry", { shopId: control.shopId, offerId: control.offerId })] : null;
      case "toggle_external": return sel && control.on && !has("get_external_evidence") ? [call("get_external_evidence", { productId: sel.productId })] : null;
    }
  }

  // ---- free text
  if (userMessage && !has("understand_or_clarify_need")) return [call("understand_or_clarify_need")];
  const ur = lastRun("understand_or_clarify_need");
  const u = (ur?.summary ?? {}) as unknown as UnderstandSummary;
  if (ur?.summary.reset) return null;
  const intents = new Set(u.intents ?? []);
  const wantsSellers = intents.has("sellers") || intents.has("hours") || intents.has("stock") || !!u.district || !!u.radiusMeters;
  const wantsCompare = intents.has("compare");
  const wantsReview = intents.has("review");
  const wantsInquiry = intents.has("inquiry") || intents.has("send") || intents.has("phone");
  const wantsAlt = intents.has("alternatives");
  const wantsAreas = intents.has("areas");

  // a user's own report of what a seller said
  if (intents.has("reply") && state.selectedOffer && !has("summarize_user_reported_reply")) {
    const sug = suggestFromText(userMessage ?? "");
    return [call("summarize_user_reported_reply", { shopId: state.selectedOffer.shopId, offerId: state.selectedOffer.offerId, ...(sug.stock ? { stock: sug.stock } : {}), ...(sug.amountText ? { reportedPriceText: sug.amountText } : {}), ...(sug.modelDifferent ? { model: "different" } : {}) })];
  }
  // exact model first (dataset-first routing)
  if (u.model && !has("search_products")) return [call("search_products", { query: u.model })];
  if (!sel) {
    if (has("search_products")) {
      const sr = lastRun("search_products");
      if (sr?.status === "not_found" && !has("recommend_shopping_areas")) {
        const hint = (sr.summary.categoryHints as string[] | undefined)?.[0] ?? state.category;
        return hint ? [call("recommend_shopping_areas", { category: hint })] : null;
      }
      return null;
    }
    if ((u.hasNeed || state.category) && !has("advise_products")) return [call("advise_products", {})];
    return null;
  }
  // a product is selected
  if (wantsReview && !has("get_external_evidence")) return [call("get_external_evidence", { productId: sel.productId })];
  if ((wantsSellers || wantsCompare || wantsInquiry) && !has("find_sellers_for_product")) return [call("find_sellers_for_product", {})];
  const sr = lastRun("find_sellers_for_product");
  const shopIds = ((sr?.summary.sellers as Array<{ shopId: string }> | undefined) ?? []).map((s) => s.shopId);
  if (wantsCompare && shopIds.length >= 2 && !has("compare_sellers")) return [call("compare_sellers", { shopIds: shopIds.slice(0, 3) })];
  if (wantsInquiry && !has("compose_seller_inquiry")) {
    const pick = state.selectedOffer?.shopId ?? (shopIds.length ? shopIds[0] : null);
    if (pick) return [call("compose_seller_inquiry", { shopId: pick, ...(state.selectedOffer && state.selectedOffer.shopId === pick ? { offerId: state.selectedOffer.offerId } : {}) })];
  }
  if (wantsAlt && !has("find_product_alternatives")) return [call("find_product_alternatives", { productId: sel.productId })];
  if ((wantsAreas || (sr && (sr.status === "not_found") && !shopIds.length)) && !has("recommend_shopping_areas")) return [call("recommend_shopping_areas", {})];
  return null;
}

export function createMockProvider(): LlmProvider {
  const info = providerInfo({ ...readAgentConfig({}), provider: "mock" });
  return {
    info,
    async complete(req: ProviderRequest): Promise<ProviderResponse> {
      const next = planNext(req);
      if (next) return { kind: "tool_calls", calls: next };
      return { kind: "final", text: renderAnswer({ state: req.context.state, runs: runsFromMessages(req.messages), clarify: null, fallback: null }) };
    },
  };
}

/** Test helper: a provider that replays a fixed script (tool calls / final text / thrown errors). */
export type ScriptStep = ProviderResponse | Error | ((req: ProviderRequest) => ProviderResponse | Promise<ProviderResponse>);
export function createScriptedProvider(steps: ScriptStep[], info = readAgentConfig({}) && providerInfo({ ...readAgentConfig({}), provider: "mock" })): LlmProvider & { calls: ProviderRequest[] } {
  let i = 0;
  const calls: ProviderRequest[] = [];
  return {
    info: { ...info, labelFa: "ارائه‌دهنده‌ی آزمونی (اسکریپت)" }, calls,
    async complete(req) {
      calls.push(req);
      const step = steps[Math.min(i++, steps.length - 1)]!;
      if (step instanceof Error) throw step;
      return typeof step === "function" ? step(req) : step;
    },
  };
}
