import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Type, validateToolArguments, type SimpleStreamOptions, type ToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { HelpRequest, System1Decision, System1Integration, TurboOptions } from "./contracts.js";
import { DISCOVER, REGISTER, type Registration } from "./registration.js";
import { Lifecycle } from "./runtime/lifecycle.js";
import { message, SYSTEM1_MODEL, system1Provider } from "./runtime/provider.js";
import { freezeArguments, object, permitted, positive, same, validateAnswers } from "./runtime/protocol.js";
import { consult } from "./helpers/system2.js";

const usingTurbo = (ctx: ExtensionContext) => ctx.model?.provider === "turbo";
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A factory is also exported for embedding/testing; CLI users load the default extension. */
export function createTurboExtension(defaults: TurboOptions = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const lifecycle = new Lifecycle(pi);
    const integrations = new Map<string, Registration>();
    const duplicates = new Set<string>();
    let config: TurboOptions = defaults;
    let configError: string | undefined;
    let context: ExtensionContext | undefined;
    let instrumentation: SimpleStreamOptions = {};
    let dispatched = new Set<string>();
    const stopDiscovery = pi.events.on(REGISTER, value => {
      const registration = value as Registration;
      if (registration?.version !== 1 || !registration.integration?.id) return;
      const old = integrations.get(registration.integration.id);
      if (old && old.token !== registration.token) duplicates.add(registration.integration.id);
      else integrations.set(registration.integration.id, registration);
    });
    pi.events.emit(DISCOVER, { version: 1 });
    pi.registerFlag("turbo-agent", { description: "System 1 companion integration id", type: "string" });
    pi.registerFlag("turbo-config", { description: "Path to Turbo operator JSON configuration", type: "string" });
    const integration = (): System1Integration => {
      if (configError) throw new Error(configError);
      const flag = pi.getFlag("turbo-agent");
      const id = typeof flag === "string" ? flag : config.integration ?? (integrations.size === 1 ? [...integrations.keys()][0] : undefined);
      if (!id || !integrations.has(id)) throw new Error("Select a registered companion with --turbo-agent <id>");
      if (duplicates.has(id)) throw new Error(`Duplicate Turbo integration id: ${id}`);
      return integrations.get(id)!.integration;
    };
    const assertHelp = (request: HelpRequest) => {
      if (!config.system2?.enabled) throw new Error("System 2 is disabled by the operator");
      if (!request.goal || !request.doneWhen || !Array.isArray(request.tools)) throw new Error("Invalid helper brief");
      object(request.inputs);
      const names = new Set<string>();
      for (const grant of request.tools) {
        if (names.has(grant.name) || grant.name.startsWith("turbo_") || !config.system2.tools.includes(grant.name)) throw new Error(`Helper tool not granted: ${grant.name}`);
        names.add(grant.name);
        if (grant.allowAnyArguments !== true) {
          if (!Array.isArray(grant.arguments) || !grant.arguments.length) throw new Error("Explicit helper argument policy required");
          grant.arguments.forEach(object);
        }
      }
    };
    pi.registerProvider(system1Provider(async (_transcript, options) => {
      const output = message();
      const ctx = context;
      const attempt = lifecycle.current?.attemptId;
      try {
        if (!ctx || !attempt) throw new Error("Select turbo/auto and start a new task");
        const control = lifecycle.assert(attempt, ctx);
        lifecycle.watch(options.signal);
        const author = integration();
        if (control.integration !== author.id || control.revision !== author.revision) throw new Error("Integration changed during the attempt");
        if (control.phase !== "s1" || control.pending) throw new Error("Previous tool call has not settled");
        if (++control.step > positive(config.maxSteps, 32, "maxSteps")) throw new Error("Turbo decision budget exhausted");
        instrumentation = options;
        lifecycle.save();
        const signal = AbortSignal.any([lifecycle.aborter.signal, ...(options.signal ? [options.signal] : [])]);
        signal.throwIfAborted();
        const prepared = await author.prepareTurn({ pi: ctx, signal, attemptId: attempt, step: control.step,
          capabilities: { tools: pi.getActiveTools().filter(t => author.tools.includes(t)),
            system2: config.system2?.enabled === true, helperTools: config.system2?.enabled ? config.system2.tools : [] },
          ...(control.consultation ? { consultation: structuredClone(control.consultation) } : {}),
        });
        lifecycle.assert(attempt, ctx); signal.throwIfAborted();
        let decision: System1Decision;
        if ("kind" in prepared) decision = prepared;
        else {
          object(prepared.request.state);
          if (!Object.keys(prepared.request.questions).length) throw new Error("At least one authored question is required");
          const ref = config.classifier ?? { provider: "typesafe", id: "jev-latest" };
          const model = ctx.modelRegistry.findOfType("classifier", ref.provider, ref.id);
          if (!model) throw new Error(`Classifier unavailable: ${ref.provider}/${ref.id}`);
          const request = structuredClone(prepared.request);
          const result = await ctx.modelRegistry.classify(model, request, {
            signal,
            ...(options.onPayload ? { onPayload: (payload) => options.onPayload!(payload, SYSTEM1_MODEL) } : {}),
            ...(options.onResponse ? { onResponse: (response) => options.onResponse!(response, SYSTEM1_MODEL) } : {}),
          });
          if (result.usage) output.usage = result.usage;
          output.responseModel = `${result.provider}/${result.model}`;
          pi.appendEntry("pi-turbo/judgment-v1", { attemptId: attempt, step: control.step,
            provider: result.provider, model: result.model, stopReason: result.stopReason, usage: result.usage ?? null,
            answers: result.answers, error: result.errorMessage ?? null });
          lifecycle.assert(attempt, ctx); signal.throwIfAborted();
          validateAnswers(request, result);
          decision = await prepared.resolve(result);
        }
        lifecycle.assert(attempt, ctx); signal.throwIfAborted();
        if (decision.kind === "final") {
          if (!["completed", "waiting_input", "blocked", "cancelled", "error"].includes(decision.status) || typeof decision.text !== "string") throw new Error("Invalid final decision");
          output.content = [{ type: "text", text: decision.text }];
          lifecycle.finish(decision.status);
        } else {
          let call: ToolCall;
          if (decision.kind === "consult") {
            assertHelp(decision.request);
            control.helpRequest = structuredClone(decision.request);
            call = { type: "toolCall", id: randomUUID(), name: "turbo_consult", arguments: { attemptId: attempt } };
          } else if (decision.kind === "tool") {
            if (!author.tools.includes(decision.name) || decision.name.startsWith("turbo_")) throw new Error(`Unauthored tool: ${decision.name}`);
            object(decision.args);
            call = { type: "toolCall", id: randomUUID(), name: decision.name, arguments: structuredClone(decision.args) };
          } else throw new Error("Unsupported author decision");
          const tool = pi.getAllTools().find(t => t.name === call.name);
          if (!tool || !pi.getActiveTools().includes(call.name)) throw new Error(`Tool not active: ${call.name}`);
          const validated = validateToolArguments(tool, call);
          if (!same(validated, call.arguments)) throw new Error("Tool validation changed authored arguments");
          control.pending = call; lifecycle.save();
          output.content = [call]; output.stopReason = "toolUse";
        }
      } catch (error) {
        const text = errorText(error);
        output.stopReason = options.signal?.aborted ? "aborted" : "error";
        output.errorMessage = `Turbo: ${text}`;
        if (attempt && lifecycle.current?.attemptId === attempt && lifecycle.current.phase !== "settled") {
          lifecycle.finish(output.stopReason === "aborted" ? "cancelled" : "error", text);
        }
      }
      return output;
    }));
    pi.registerVirtualModel({ provider: "turbo", id: "auto", name: "Turbo (authored System 1)", input: ["text"], thinkingLevels: ["off"],
      contextWindow: 64_000, maxTokens: 4096,
      async route(request, ctx) {
        if (request.reason === "direct") throw new Error("Turbo V1 does not generate summaries or handle direct auxiliary requests");
        if (configError) throw new Error(configError);
        context = ctx;
        const attempt = lifecycle.current?.attemptId;
        if (!attempt) throw new Error("No active Turbo attempt");
        lifecycle.assert(attempt, ctx);
        if (!ctx.modelRegistry.hasConfiguredAuth(SYSTEM1_MODEL)) {
          await ctx.modelRegistry.refresh({ providers: ["turbo"], allowNetwork: false });
        }
        lifecycle.assert(attempt, ctx);
        return { model: SYSTEM1_MODEL, thinkingLevel: "off" };
      },
    });
    pi.registerTool({ name: "turbo_consult", label: "System 2 consultation", exposure: "model-only", executionMode: "sequential",
      description: "Run an author-bound, operator-enabled subtask, then return evidence to System 1.",
      parameters: Type.Object({ attemptId: Type.String() }, { additionalProperties: false }),
      async execute(callId, args, signal, _update, ctx) {
        const control = lifecycle.assert(args.attemptId, ctx);
        if (control.pending?.id !== callId || control.phase !== "s1" || !control.helpRequest || !config.system2) throw new Error("Unbound consultation");
        assertHelp(control.helpRequest);
        control.phase = "s2"; lifecycle.save();
        const parentSignal = AbortSignal.any([lifecycle.aborter.signal, ...(signal ? [signal] : [])]);
        const result = await consult(pi, ctx, control.helpRequest, config.system2, parentSignal, args.attemptId, instrumentation);
        pi.appendEntry("pi-turbo/helper-result-v1", { attemptId: args.attemptId, result });
        if (lifecycle.current?.attemptId === args.attemptId && lifecycle.current.phase !== "settled") {
          control.consultation = result; control.phase = "s1"; lifecycle.save();
        }
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, usage: result.usage,
          isError: result.status === "error" || result.status === "cancelled" || result.status === "denied" };
      },
    });
    pi.on("tool_call", (event, ctx) => {
      if (!usingTurbo(ctx)) return;
      const c = lifecycle.current;
      const deny = (reason: string) => ({ block: true, reason, terminate: true });
      if (!c || c.phase === "settled" || !c.pending || lifecycle.aborter.signal.aborted) return deny("No active Turbo tool binding");
      if (event.parentToolCallId) {
        if (!(event.parentToolCallId === c.pending.id || event.parentToolCallId.startsWith(`${c.pending.id}/`))) return deny("Stale nested tool call");
        if (c.phase === "s2") {
          if (!config.system2?.enabled || !config.system2.tools.includes(event.toolName)
            || !c.helpRequest || !permitted(c.helpRequest.tools, event.toolName, event.input)) return deny("Outside System 2 grant");
        } else if (!integration().tools.includes(event.toolName)) return deny("Undeclared nested tool");
        freezeArguments(event.input);
        return;
      }
      if (c.phase !== "s1" || c.pending.id !== event.toolCallId || c.pending.name !== event.toolName
        || !same(c.pending.arguments, event.input) || dispatched.has(event.toolCallId)) return deny("Stale or altered Turbo binding");
      dispatched.add(event.toolCallId);
      freezeArguments(event.input);
    });
    pi.on("turn_end", event => {
      const c = lifecycle.current;
      if (c?.pending && event.toolResults.some(r => r.toolCallId === c.pending!.id) && c.phase !== "settled") {
        delete c.pending; delete c.helpRequest; lifecycle.save();
      }
    });
    pi.on("session_start", async (_event, ctx) => {
      context = ctx; dispatched = new Set(); configError = undefined;
      try {
        const file = pi.getFlag("turbo-config");
        config = structuredClone(typeof file === "string" ? { ...defaults, ...JSON.parse(await readFile(resolve(ctx.cwd, file), "utf8")) } : defaults);
        positive(config.maxSteps, 32, "maxSteps"); positive(config.timeoutMs, 120_000, "timeoutMs");
        if (config.system2?.enabled) {
          if (!config.system2.model?.provider || !config.system2.model.id || !Array.isArray(config.system2.tools)
            || config.system2.tools.some(t => typeof t !== "string")) throw new Error("Enabled System 2 requires a model and explicit tools list");
          positive(config.system2.maxTurns, 6, "system2.maxTurns");
          positive(config.system2.maxToolCalls, 8, "system2.maxToolCalls");
          positive(config.system2.timeoutMs, 60_000, "system2.timeoutMs");
        }
        lifecycle.restore(ctx);
        // Native registration refreshes availability asynchronously; await our provider before routing.
        await ctx.modelRegistry.refresh({ providers: ["turbo"], allowNetwork: false });
      } catch (error) { configError = errorText(error); }
      pi.events.emit(DISCOVER, { version: 1 });
    });
    pi.on("before_agent_start", (_event, ctx) => {
      if (!usingTurbo(ctx)) return;
      context = ctx;
      try { lifecycle.start(ctx, integration(), positive(config.timeoutMs, 120_000, "timeoutMs")); }
      catch (error) { configError = errorText(error); }
    });
    pi.on("session_tree", (_event, ctx) => lifecycle.restore(ctx));
    pi.on("session_before_compact", (_event, ctx) => {
      if (!usingTurbo(ctx)) return;
      lifecycle.finish("error", "Context limit reached: Turbo V1 preserves author input and declines automatic compaction");
      ctx.abort(); return { cancel: true };
    });
    pi.on("agent_settled", (_event, ctx) => {
      if (usingTurbo(ctx) && lifecycle.current?.phase !== "settled") {
        const last = ctx.sessionManager.getBranch().findLast(e => e.type === "message" && e.message.role === "assistant");
        const failed = last?.type === "message" && last.message.role === "assistant" && last.message.stopReason === "error";
        lifecycle.finish(lifecycle.current?.cancelRequested ? "cancelled" : failed ? "error" : "cancelled", "Pi settled without a completed Turbo decision; inspect pending effects");
      }
      lifecycle.close();
    });
    pi.on("model_select", (event) => {
      if (event.model.provider !== "turbo" && lifecycle.current?.phase !== "settled") {
        lifecycle.finish("cancelled", "Model changed"); lifecycle.close();
      }
    });
    pi.on("session_shutdown", () => { lifecycle.close(); stopDiscovery(); });
    pi.registerCommand("pi-turbo", { description: "Show Turbo integration, phase and outcome", async handler(_args, ctx) {
      const text = JSON.stringify({ integrations: [...integrations.keys()], configError: configError ?? null, control: lifecycle.current ?? null }, null, 2);
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else pi.sendMessage({ customType: "pi-turbo/status", content: text, display: true });
    } });
  };
}
export default createTurboExtension();
