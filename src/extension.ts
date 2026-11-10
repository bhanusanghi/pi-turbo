import { type Context } from "@earendil-works/chord/context";
import { type AssistantMessage, type ClassifierResult, type Message } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { AgentDoc, CompactionTask, GenerationTask, ToolTask, defineExtension, hook, wrapTool,
  type HookApi, type ToolExecutionApi } from "@earendil-works/pi-durable";
import { createConsultation } from "./helpers/system2.js";
import { createBridge, assistant } from "./runtime/provider.js";
import { json, object, same, validateAnswers } from "./runtime/protocol.js";
import type { HelpResult, PreparedTurn, System1Decision, System1Evidence, TurboOptions } from "./contracts.js";

type SavedResponse = { revision: string; decision?: System1Decision; message: AssistantMessage; error?: string; evidence: System1Evidence };

/** Add System 1 decisions and optional consultation to an ordinary Durable application. */
export function createTurbo(options: TurboOptions) {
  const { integration } = options;
  if (!/^[a-z][a-z0-9-]*$/.test(integration.id) || !integration.revision) throw new Error("Turbo requires an id and revision");
  const names = { provider: `turbo-${integration.id}`, extension: `turbo.${integration.id}`,
    consult: `turbo_${integration.id.replaceAll("-", "_")}_consult`, finish: `turbo_${integration.id.replaceAll("-", "_")}_finish` };
  const bridge = createBridge(names.provider);
  const model = { provider: names.provider, modelId: "system1" };
  const responseKey = `${names.extension}.response`;
  const toolNames = options.tools.map(t => t.name);
  if (new Set(toolNames).size !== toolNames.length || toolNames.some(n => n === names.consult || n === names.finish)) throw new Error("Duplicate or reserved Turbo tool name");

  async function bound(api: ToolExecutionApi, context: Context): Promise<System1Decision> {
    const task = await api.getTask(api.taskId, context);
    if (!task?.owner) throw new Error("Tool has no owning generation");
    const parent = await api.getTask(task.owner, context);
    const saved = parent?.memos?.[responseKey] as unknown as SavedResponse | undefined;
    if (!saved?.decision || saved.revision !== integration.revision) throw new Error("Missing or incompatible saved Turbo decision");
    const call = saved.message.content.find(c => c.type === "toolCall");
    if (call?.type !== "toolCall" || call.id !== api.callId) throw new Error("Stale Turbo tool call");
    return saved.decision;
  }
  const helper = createConsultation(options, names, bound);
  async function prepare(messages: readonly Message[], api: HookApi, context: Context): Promise<AssistantMessage> {
    const saved = await api.memo(responseKey, context) as unknown as SavedResponse | undefined;
    if (saved) {
      if (saved.revision !== integration.revision) throw new Error("Saved Turbo recipe revision changed");
      await options.evidence?.(structuredClone(saved.evidence), context);
      return saved.message;
    }
    let input: PreparedTurn | System1Decision | undefined;
    let answer: ClassifierResult | undefined;
    let consultation: System1Evidence["consultation"];
    let errorDetail: string | undefined;
    let output = assistant(names.provider);
    let decision: System1Decision | undefined;
    try {
      const packetKey = `${names.extension}.packet`;
      let record = await api.memo(packetKey, context) as unknown as { revision: string; packet: PreparedTurn | System1Decision; consultation?: System1Evidence["consultation"] } | undefined;
      if (!record) {
        const lastInput = messages.findLastIndex(m => m.role === "user");
        const helpMessage = messages.slice(lastInput + 1).findLast(m => m.role === "toolResult" && m.toolName === names.consult);
        const consultation = helpMessage?.role === "toolResult" && helpMessage.details && !helpMessage.isError
          ? helpMessage.details as unknown as HelpResult : undefined;
        const offered = new Set(getCurrentTools(messages).map(tool => tool.name));
        const availableTools = toolNames.filter(name => offered.has(name));
        const system2 = options.system2?.enabled === true && offered.has(names.consult);
        const packet = await integration.prepareTurn({ api, messages,
          capabilities: { tools: availableTools, system2,
            helperTools: system2 ? options.system2!.tools.filter(name => availableTools.includes(name)) : [] },
          ...(consultation ? { consultation } : {}) }, context);
        object(packet);
        record = await api.memo(packetKey, json({ revision: integration.revision, packet,
          ...(consultation ? { consultation: { taskId: consultation.id, conversationId: consultation.conversationId } } : {}) }), context) as unknown as typeof record;
      }
      if (!record || record.revision !== integration.revision) throw new Error("Saved Turbo recipe revision changed");
      const packet = record.packet;
      input = packet; consultation = record.consultation;
      if ("kind" in packet) {
        if (packet.kind !== "final") throw new Error("Preparation may return only a packet or final decision");
        decision = packet;
      } else {
        object(packet.request.state); object(packet.bindings);
        if (!Object.keys(packet.request.questions).length) throw new Error("At least one authored question is required");
        const answerKey = `${names.extension}.answer`;
        answer = await api.memo(answerKey, context) as unknown as ClassifierResult | undefined;
        if (!answer) {
          const classifier = api.models.getModelOfType("classifier", options.classifier.provider, options.classifier.modelId);
          if (!classifier) throw new Error("Configured classifier is unavailable");
          answer = await api.models.classify(classifier, structuredClone(packet.request), {
            maxRetries: 0, ...(context.abortSignal ? { signal: context.abortSignal } : {}),
          });
          context.abortSignal?.throwIfAborted();
          answer = await api.memo(answerKey, json(answer), context) as unknown as ClassifierResult;
        }
        output.usage = answer.usage ?? output.usage;
        output.provider = answer.provider; output.model = answer.model; output.api = answer.api;
        validateAnswers(packet.request, answer);
        decision = await integration.resolveTurn(structuredClone(packet), structuredClone(answer));
      }
      context.abortSignal?.throwIfAborted();
      object(decision);
      if (decision.kind === "tool") {
        object(decision.args);
        if (!toolNames.includes(decision.name)) throw new Error("Undeclared System 1 tool");
        output.content = [{ type: "toolCall", id: `${api.taskId}:decision`, name: decision.name, arguments: decision.args }];
        output.stopReason = "toolUse";
      } else if (decision.kind === "consult") {
        if (!options.system2?.enabled) throw new Error("System 2 is disabled");
        output.content = [{ type: "toolCall", id: `${api.taskId}:decision`, name: names.consult, arguments: {} }];
        output.stopReason = "toolUse";
      } else if (decision.kind === "final" && typeof decision.text === "string"
        && ["completed", "blocked", "waiting_input", "cancelled", "error"].includes(decision.status)) {
        output.content = [{ type: "text", text: decision.text }];
        // Preserve authored outcome without turning a blocked result into success.
        output.rawStopReason = `turbo.${decision.status}`;
      } else throw new Error("Invalid authored decision");
    } catch (error) {
      context.abortSignal?.throwIfAborted();
      const detail = error instanceof Error ? error.message : String(error);
      output = { ...output, content: [{ type: "text", text: detail }], stopReason: "error", errorMessage: "Turbo decision failed; inspect the recorded diagnostic" };
      errorDetail = detail;
    }
    const evidence = json({ version: 1, integrationId: integration.id, revision: integration.revision,
      conversationId: api.conversationId, generationId: api.taskId,
      ...(input ? { input } : {}), ...(answer ? { answer } : {}),
      outcome: errorDetail !== undefined ? { diagnostic: errorDetail } : { decision }, response: output,
      ...(consultation ? { consultation } : {}),
    }) as unknown as System1Evidence;
    const response = await api.memo(responseKey, json({ revision: integration.revision,
      ...(errorDetail !== undefined ? { error: errorDetail } : { decision }), message: output, evidence }), context) as unknown as SavedResponse;
    await options.evidence?.(structuredClone(response.evidence), context);
    return response.message;
  }
  const extension = defineExtension({ name: names.extension,
    tools: [helper.consult, helper.finish],
    hooks: [
      hook(GenerationTask, { async beforeRequest({ messages }, api, context) {
        const state = await api.snapshot(AgentDoc, api.conversationId, context);
        if (state?.model?.provider !== names.provider) return;
        const result = state.model.modelId === "system2" ? await helper.prepare(messages, api, context) : await prepare(messages, api, context);
        if (!result) throw new Error("Missing consultation scope");
        return { messages: bridge.envelope(result) };
      } }),
      hook(ToolTask, { beforeTool: (call, api, context) => helper.beforeTool(call.name, call.arguments, api, context) }),
      hook(CompactionTask, { async beforeCompact(_input, api, context) {
        const state = await api.snapshot(AgentDoc, api.conversationId, context);
        if (state?.model?.provider === names.provider) return { decline: true };
        return undefined;
      } }),
    ],
    wraps: options.tools.map(tool => wrapTool(tool, original => ({ ...original,
      async execute(args, api, context) {
        const task = await api.getTask(api.taskId, context);
        const scope = await api.snapshot(helper.ScopeDoc, api.conversationId, context);
        if (!scope?.scope && task?.input && typeof task.input === "object" && !Array.isArray(task.input) && task.input.kind === "model") {
          const parent = task.owner ? await api.getTask(task.owner, context) : undefined;
          const agent = await api.agent(context);
          if (parent?.memos?.[responseKey] || agent.model?.provider === names.provider) {
            const decision = await bound(api, context);
            if (decision.kind !== "tool" || decision.name !== original.name || !same(decision.args, args)) throw new Error("Changed Turbo tool binding");
          }
        }
        object(args);
        return helper.guarded(original, args, api, context);
      },
    }))),
  });
  return { extension, provider: bridge.provider, model, consultTool: helper.consult };
}
