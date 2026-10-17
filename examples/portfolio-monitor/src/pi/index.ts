import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { AppError, type AppStore, type NotificationDraft } from "../contracts.js";
import { inspectPortfolio } from "../queries.js";

/** Optional native tools. Installing these does not create conversations or invoke a model. */
export function createApplicationExtension(options: {
  store: AppStore;
  portfolioIds: readonly string[];
  sourceIds: readonly string[];
  destinationIds?: readonly string[];
  notifications: { request(draft: NotificationDraft, key: string): Promise<unknown> };
}) {
  const portfolios = new Set(options.portfolioIds);
  const sources = new Set(options.sourceIds);
  const destinations = new Set(options.destinationIds ?? []);
  const result = (value: unknown) => ({ output: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: JSON.parse(JSON.stringify(value)) as JsonValue });
  const snapshot = defineTool({ name: "portfolio_snapshot", description: "Inspect a configured portfolio snapshot and freshness. This does not evaluate news.",
    parameters: Type.Object({ portfolioId: Type.String() }, { additionalProperties: false }), replay: "safe",
    async execute(args, _api, context) {
      context.abortSignal?.throwIfAborted();
      if (!portfolios.has(args.portfolioId)) throw new AppError("forbidden", "Portfolio outside configured scope", 403);
      return result(await inspectPortfolio(options.store, args.portfolioId));
    } });
  const evidence = defineTool({ name: "evidence_read", description: "Read an exact stored input and its revisions from a configured source. No automatic context selection.",
    parameters: Type.Object({ inputId: Type.String() }, { additionalProperties: false }), replay: "safe",
    async execute(args, _api, context) {
      context.abortSignal?.throwIfAborted();
      const input = await options.store.getInput(args.inputId);
      if (!input || !sources.has(input.sourceId)) throw new AppError("forbidden", "Input outside configured source scope", 403);
      const source = await options.store.getResource("sources", input.sourceId);
      if (!source?.enabled) throw new AppError("disabled", "Source disabled", 409);
      return result(input);
    } });
  const notification = defineTool({ name: "notification_request", description: "Queue explicit content for an allowed destination. Acceptance is not a delivery receipt.",
    parameters: Type.Object({ destinationId: Type.String(), idempotencyKey: Type.String({ minLength: 8, maxLength: 200 }),
      title: Type.String({ minLength: 1, maxLength: 500 }), body: Type.String({ minLength: 1, maxLength: 12000 }) }, { additionalProperties: false }), replay: "unsafe",
    async execute(args, _api, context) {
      context.abortSignal?.throwIfAborted();
      if (!destinations.has(args.destinationId)) throw new AppError("forbidden", "Destination outside configured scope", 403);
      return result(await options.notifications.request({ destinationId: args.destinationId, origin: "application",
        content: { title: args.title, body: args.body } }, args.idempotencyKey));
    } });
  // Host must explicitly grant delivery; default extension contains only reads.
  const tools = destinations.size ? [snapshot, evidence, notification] : [snapshot, evidence];
  return { extension: defineExtension({ name: "portfolio-monitor", tools }), tools, snapshot, evidence,
    ...(destinations.size ? { notification } : {}) };
}
