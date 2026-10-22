import type { DatabaseSync } from "node:sqlite";
import { initialAgentState, type AgentCard, type AgentControl, type AgentState, type AgentTurnResponse } from "@/domain/agent";
import type { AgentConfig } from "../config";
import { runTurn } from "../orchestrator";
import type { LlmProvider } from "../provider";
import { createMockProvider } from "../providers/mock";

export type Metric =
  | "tool_selection" | "grounding" | "false_availability" | "false_contact" | "dataset_retention" | "variant_confusion"
  | "recovery" | "review_attribution" | "state_retention" | "provenance" | "safety" | "fallback" | "clarification";

export interface Check { metric: Metric; ok: boolean; note: string }
export type StageTag = "choose" | "find" | "compare" | "communicate" | "failure";
export type LabelSource = "hand-labelled-from-dataset" | "spec-derived" | "adversarial-design" | "team-judgment-user-like";

export interface Scenario {
  id: string;
  /** category 1..14 of the Phase 7 corpus definition */
  cat: number;
  stage: StageTag;
  titleFa: string;
  label: LabelSource;
  /** why the expectation is what it is (not "whatever the code returned") */
  basis: string;
  run(h: Harness): Promise<Check[]>;
}

export const chk = (metric: Metric, ok: boolean, note: string): Check => ({ metric, ok, note });

/** Everything a scenario does goes through here so global safety scans see every turn. */
export class Harness {
  readonly turns: AgentTurnResponse[] = [];
  state: AgentState = initialAgentState();
  constructor(readonly db: DatabaseSync, readonly config: AgentConfig, readonly provider: LlmProvider = createMockProvider(), readonly now = new Date("2026-10-22T09:00:00Z")) {}
  get last(): AgentTurnResponse { return this.turns[this.turns.length - 1]!; }
  async say(message: string, provider: LlmProvider = this.provider, config: AgentConfig = this.config): Promise<AgentTurnResponse> { return this.go(message, null, provider, config); }
  async ctl(control: AgentControl, provider: LlmProvider = this.provider): Promise<AgentTurnResponse> { return this.go(null, control, provider); }
  private async go(message: string | null, control: AgentControl | null, provider: LlmProvider, config: AgentConfig = this.config) {
    const r = await runTurn({ db: this.db, config, provider, state: this.state, message, control, now: this.now });
    this.state = r.state;
    this.turns.push(r);
    return r;
  }
  fresh(): Harness { return new Harness(this.db, this.config, this.provider, this.now); }
}

export const tools = (r: AgentTurnResponse): string[] => r.trace.map((t) => t.tool);
export const cardsOf = <T extends AgentCard["type"]>(r: AgentTurnResponse, t: T): Extract<AgentCard, { type: T }>[] => r.cards.filter((c): c is Extract<AgentCard, { type: T }> => c.type === t);
export const textOf = (r: AgentTurnResponse): string => JSON.stringify([r.assistant.text, r.cards, r.notices, r.actions, r.clarify]);
