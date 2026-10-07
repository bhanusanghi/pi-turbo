import type { ClassifierContext, ClassifierResult, JsonObject, JsonValue, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type { JsonObject, JsonValue };
export type TaskStatus = "completed" | "waiting_input" | "blocked" | "cancelled" | "error";
export interface ModelRef { provider: string; id: string }
/** Every helper tool has an explicit argument policy. */
export type HelperToolGrant = { name: string } & (
  | { arguments: JsonObject[]; allowAnyArguments?: never }
  | { allowAnyArguments: true; arguments?: never }
);
export interface HelpRequest { goal: string; inputs: JsonObject; doneWhen: string; tools: HelperToolGrant[] }
export interface ToolEvidence {
  name: string; callId: string; arguments: JsonObject; isError: boolean;
  content: JsonValue; details: JsonValue;
  usage?: Usage;
}
export interface HelpResult {
  id: string;
  status: "completed" | "incomplete" | "denied" | "exhausted" | "error" | "cancelled";
  findings: string; sources: string[]; uncertainties: string[];
  /** Actual native tool outcomes, never inferred from model prose. */
  tools: ToolEvidence[];
  /** Helper model usage only; Pi adds nested tool usage to the parent result separately. */
  model: ModelRef; turns: number; usage: Usage;
}
export type FinalDecision = { kind: "final"; status: TaskStatus; text: string };
export type System1Decision =
  | { kind: "tool"; name: string; args: JsonObject }
  | { kind: "consult"; request: HelpRequest }
  | FinalDecision;
export interface PreparedTurn {
  request: ClassifierContext;
  /** Paired with this exact request snapshot. */
  resolve(response: ClassifierResult): System1Decision | Promise<System1Decision>;
}
export interface PrepareContext {
  pi: ExtensionContext; signal: AbortSignal; attemptId: string; step: number;
  capabilities: { tools: readonly string[]; system2: boolean; helperTools: readonly string[] };
  /** Author decides whether and how to use the last consultation on this attempt. */
  consultation?: HelpResult;
}
export interface System1Integration {
  id: string; revision: string; tools: readonly string[];
  prepareTurn(context: PrepareContext): PreparedTurn | FinalDecision | Promise<PreparedTurn | FinalDecision>;
}
export interface System2Options {
  enabled: boolean; model: ModelRef;
  /** Operator ceiling; the author requests a subset with argument constraints. */
  tools: string[]; maxTurns?: number; maxToolCalls?: number; timeoutMs?: number;
}
export interface TurboOptions {
  integration?: string; classifier?: ModelRef; maxSteps?: number; timeoutMs?: number; system2?: System2Options;
}
