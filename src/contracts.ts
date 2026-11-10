import type { JsonValue, JsonRepresentation } from "@earendil-works/chord";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import type { AssistantMessage, ClassifierContext, ClassifierResult, Message, Usage } from "@earendil-works/pi-ai";
import type { ConversationId, EntryId, Extension, HookApi, ModelRef, TaskId, ToolRegistration } from "@earendil-works/pi-durable";

export type { JsonObject, JsonValue, ModelRef };
export type TaskStatus = "completed" | "waiting_input" | "blocked" | "cancelled" | "error";
export type HelperToolGrant = { name: string } & (
  | { arguments: JsonObject[]; allowAnyArguments?: never }
  | { allowAnyArguments: true; arguments?: never }
);
export type HelpRequest = { goal: string; inputs: JsonObject; doneWhen: string; tools: HelperToolGrant[] };
export type ToolEvidence = {
  name: string; callId: string; arguments: JsonObject; isError: boolean;
  output: JsonValue; details: JsonValue;
};
export type HelpResult = {
  id: number; conversationId: number; request: HelpRequest;
  status: "completed" | "incomplete" | "denied" | "exhausted" | "error";
  findings: string; sources: string[]; uncertainties: string[];
  tools: ToolEvidence[]; model: ModelRef; turns: number; usage: JsonRepresentation<Usage>;
};
export type FinalDecision = { kind: "final"; status: TaskStatus; text: string };
export type System1Decision =
  | { kind: "tool"; name: string; args: JsonObject }
  | { kind: "consult"; request: HelpRequest }
  | FinalDecision;
/** Persisted as a native task memo. No closures, tools, or application store live here. */
export type PreparedTurn = { request: ClassifierContext; bindings: JsonObject };
export type PrepareContext = {
  api: HookApi;
  messages: readonly Message[];
  capabilities: { tools: readonly string[]; system2: boolean; helperTools: readonly string[] };
  consultation?: HelpResult;
};
export type System1Integration = {
  id: string;
  revision: string;
  prepareTurn(input: PrepareContext, context: Context): PreparedTurn | FinalDecision | Promise<PreparedTurn | FinalDecision>;
  /** Pure, deterministic translation. Application writes belong in ordinary Durable tools. */
  resolveTurn(packet: PreparedTurn, answer: ClassifierResult): System1Decision | Promise<System1Decision>;
};
export type System2Options = {
  enabled: boolean;
  model: ModelRef;
  /** Subset of the ordinary Durable tools passed to createTurbo. */
  tools: readonly string[];
  /** Default: inherit the parent's extensions, including its permission hooks. */
  extensions?: readonly Extension[];
  maxTurns?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
};
export type EvidenceIdentity = {
  integrationId: string; revision: string; conversationId: ConversationId; generationId: TaskId;
};
export type EvidenceReference = EvidenceIdentity & { entryId: EntryId };
/** Observable decision data. Native child history remains the consultation transcript. */
export type System1Evidence = EvidenceIdentity & {
  version: 1;
  input?: PreparedTurn | FinalDecision;
  answer?: ClassifierResult;
  outcome: { decision: System1Decision; diagnostic?: never } | { diagnostic: string; decision?: never };
  response: AssistantMessage;
  consultation?: { taskId: TaskId; conversationId: ConversationId };
};
export type EvidenceWriter = (evidence: System1Evidence, context: Context) => Promise<EvidenceReference>;
export type TurboOptions = {
  integration: System1Integration;
  classifier: ModelRef;
  /** Ordinary Durable tool references. The application registers and implements them. */
  tools: readonly ToolRegistration[];
  system2?: System2Options;
  /** Await retained evidence before admitting this generation's decision to native execution. */
  evidence?: EvidenceWriter;
};
