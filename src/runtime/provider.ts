import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createAssistantMessageEventStream, type AssistantMessage, type Message, type Model, type Provider } from "@earendil-works/pi-ai";
import { zeroUsage } from "./protocol.js";

export function assistant(provider: string, model = "system1"): AssistantMessage {
  return { role: "assistant", content: [], provider, model, api: "turbo-durable",
    usage: zeroUsage(), stopReason: "stop", timestamp: Date.now() };
}

/** Request-local, authenticated transport. No mutable current conversation or model loop. */
export function createBridge(id: string) {
  const secret = randomBytes(32);
  const sign = (text: string) => createHmac("sha256", secret).update(text).digest("hex");
  const models: Model<"turbo-durable">[] = ["system1", "system2"].map(model => ({
    id: model, name: `${id} ${model} decision transport`, provider: id, api: "turbo-durable", baseUrl: "",
    reasoning: false, input: ["text"], contextWindow: 0, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }));
  function envelope(message: AssistantMessage): readonly Message[] {
    const body = JSON.stringify(message);
    return [{ role: "user", content: JSON.stringify({ body, signature: sign(body) }), timestamp: Date.now() }];
  }
  const stream: Provider["streamSimple"] = (model, transcript, options = {}) => {
    const events = createAssistantMessageEventStream();
    let output = assistant(id, model.id);
    try {
      options.signal?.throwIfAborted();
      const last = transcript.messages.at(-1);
      if (last?.role !== "user" || typeof last.content !== "string") throw new Error("Missing prepared Turbo decision");
      const { body, signature } = JSON.parse(last.content) as { body: string; signature: string };
      if (typeof body !== "string" || typeof signature !== "string" || signature.length !== 64
        || !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(body)))) throw new Error("Invalid prepared Turbo decision");
      output = JSON.parse(body) as AssistantMessage;
    } catch (error) {
      output.stopReason = options.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : "Missing prepared Turbo decision";
    }
    events.push({ type: "start", partial: output });
    if (output.stopReason === "error" || output.stopReason === "aborted") {
      events.push({ type: "error", reason: output.stopReason, error: output });
    } else {
      for (const [contentIndex, block] of output.content.entries()) {
        if (block.type === "toolCall") events.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
        if (block.type === "text") events.push({ type: "text_end", contentIndex, content: block.text, partial: output });
      }
      events.push({ type: "done", reason: output.stopReason as "stop" | "toolUse" | "length", message: output });
    }
    events.end(output);
    return events;
  };
  const provider: Provider = {
    id, name: id,
    auth: { apiKey: { name: "Local durable decision transport", resolve: async () => ({ auth: {}, source: "local" }) } },
    getModels: () => models,
    stream: (model, transcript, options) => stream(model, transcript, options?.signal ? { signal: options.signal } : {}),
    streamSimple: stream,
  };
  return { provider, envelope };
}
