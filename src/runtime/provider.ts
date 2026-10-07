import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Provider, type SimpleStreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { zeroUsage } from "./protocol.js";
export const SYSTEM1_MODEL: Model<"turbo-system-one"> = {
  id: "system1", name: "Turbo System 1 Adapter", provider: "turbo", api: "turbo-system-one", baseUrl: "",
  reasoning: false, input: ["text"], contextWindow: 64_000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
export function message(): AssistantMessage {
  return { role: "assistant", content: [], provider: "turbo", model: "system1", api: "turbo-system-one",
    usage: zeroUsage(), stopReason: "stop", timestamp: Date.now() };
}
export function system1Provider(run: (context: TranscriptContext, options: SimpleStreamOptions) => Promise<AssistantMessage>): Provider {
  const stream: Provider["streamSimple"] = (_model, context, options = {}) => {
    const events = createAssistantMessageEventStream();
    void (async () => {
      let output = message();
      events.push({ type: "start", partial: output });
      try { output = await run(context, options); }
      catch (error) {
        output.stopReason = options.signal?.aborted ? "aborted" : "error";
        output.errorMessage = error instanceof Error ? error.message : String(error);
      }
      if (output.stopReason === "error" || output.stopReason === "aborted") {
        events.push({ type: "error", reason: output.stopReason, error: output });
      } else {
        output.content.forEach((block, contentIndex) => {
          if (block.type === "toolCall") {
            events.push({ type: "toolcall_start", contentIndex, partial: output });
            events.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(block.arguments), partial: output });
            events.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
          } else if (block.type === "text") {
            events.push({ type: "text_start", contentIndex, partial: output });
            events.push({ type: "text_delta", contentIndex, delta: block.text, partial: output });
            events.push({ type: "text_end", contentIndex, content: block.text, partial: output });
          }
        });
        events.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
      }
      events.end(output);
    })();
    return events;
  };
  return { id: "turbo", name: "Turbo", auth: { apiKey: { name: "Native Pi classifier",
    async check() { return { type: "api_key", source: "local Adapter (no network)" }; },
    async resolve() { return { auth: {}, source: "local Adapter (no network)" }; } } },
    getModels: () => [SYSTEM1_MODEL],
    stream(model, context, options) {
      return stream(model, context, {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.onPayload ? { onPayload: options.onPayload } : {}),
        ...(options?.onResponse ? { onResponse: options.onResponse } : {}),
        ...(options?.onProviderStreamEvent ? { onProviderStreamEvent: options.onProviderStreamEvent } : {}),
      });
    }, streamSimple: stream };
}
