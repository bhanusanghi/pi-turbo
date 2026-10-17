import { emptySourceCatalog, type SourceCatalog } from "../sources/catalog.js";
import type { SourceReceiver } from "../sources/extension.js";
import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import { AppError, type AppStore, type DeliveryResolution, type InputDraft, type ListOptions, type NotificationContent, type NotificationDraft,
  type RefreshRequest, type ResourceDrafts, type ResourceKind } from "../contracts.js";
import { inspectPortfolio } from "../queries.js";
import * as schemas from "./schemas.js";
import { SourceFailure, type SourceProbe, type SourceStore, type SourceSyncRequest, type SourceTarget } from "../sources/contracts.js";

export type HttpDependencies = {
  store: AppStore; apiToken: string; logger?: boolean;
  portfolios: {
    requestRefresh(id: string, key: string): Promise<RefreshRequest[]>;
    discoverSubAccounts(id: string, signal?: AbortSignal): Promise<{ address: string; name: string }[]>;
  };
  deliveries: { request(draft: NotificationDraft, key: string): Promise<unknown> };
  queues: { health(): Promise<void>; inspect(): Promise<unknown> };
  sourceStore?: SourceStore;
  catalog?: SourceCatalog;
  receivers?: readonly SourceReceiver[];
  sources?: {
    requestSync(id: string, key: string): Promise<SourceSyncRequest>;
    probe(id: string, signal: AbortSignal): Promise<SourceProbe>;
    discover(id: string, signal: AbortSignal, limit?: number): Promise<SourceTarget[]>;
  };
};
export function createHttp(deps: HttpDependencies) {
  const { resourceSchemas, patchSchemas } = schemas.createResourceSchemas(deps.catalog ?? emptySourceCatalog);
  const receivers = deps.receivers ?? [];
  const receiverPaths = new Set(receivers.map(receiver => receiver.path));
  if (receiverPaths.size !== receivers.length || receivers.some(r => !r.path.startsWith("/webhooks/"))) throw new Error("Receiver routes must be unique and under /webhooks/");
  const app = Fastify({ routerOptions: { maxParamLength: 128 }, bodyLimit: 256 * 1024, requestTimeout: 30_000,
    logger: deps.logger ? { redact: ["req.headers.authorization", "req.headers.cookie", "req.url"] } : false });
  app.setValidatorCompiler(TypeBoxValidatorCompiler);
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "GET" && ["/health/live", "/health/ready"].includes(request.url.split("?")[0]!)) return;
    // Only exact registered POST routes delegate authentication to their receiver.
    if (request.method === "POST" && receiverPaths.has(request.routeOptions.url ?? "")) return;
    const supplied = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${deps.apiToken}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(401).send({ error: "unauthorized" });
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[\x21-\x7e]{8,200}$/.test(key)) throw new AppError("invalid_idempotency_key", "Idempotency-Key must be 8–200 printable non-space characters");
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    if (error instanceof SourceFailure) return reply.code(error.code === "rate_limit" ? 429 : error.code === "configuration" ? 400 : 502)
      .send({ error: error.code, message: error.message, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) });
    if (typeof error === "object" && error !== null && "validation" in error) return reply.code(400).send({ error: "invalid_request", message: "Request does not match its schema" });
    if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: "invalid_request" });
    }
    request.log.error({ operation: `${request.method} ${request.routeOptions.url}`, errorType: error instanceof Error ? error.name : "Error" }, "Application operation failed");
    return reply.code(500).send({ error: "internal_error", message: "Operation failed; inspect application diagnostics" });
  });
  for (const receiver of receivers) {
    app.post(receiver.path, { schema: { params: receiver.params, body: receiver.body } }, async (request, reply) =>
      reply.code(202).send(await receiver.receive(request.params as Record<string,string>, request.body)));
  }
  app.get("/health/live", async () => ({ status: "alive" }));
  app.get("/health/ready", async (_request, reply) => {
    const results = await Promise.allSettled([deps.store.health(), deps.queues.health()]);
    const database = results[0]?.status === "fulfilled"; const redis = results[1]?.status === "fulfilled";
    return reply.code(database && redis ? 200 : 503).send({ ready: database && redis, database, redis, evaluator: "not_configured" });
  });
  const key = (headers: Record<string, unknown>) => headers["idempotency-key"] as string;
  for (const kind of Object.keys(resourceSchemas) as ResourceKind[]) {
    app.post(`/v1/${kind}`, { schema: { body: resourceSchemas[kind] } }, async (request, reply) =>
      reply.code(201).send(await deps.store.createResource(kind, request.body as ResourceDrafts[typeof kind], key(request.headers))));
    app.get(`/v1/${kind}`, { schema: { querystring: schemas.listQuery } }, async request => deps.store.listResources(kind, request.query as ListOptions));
    app.get(`/v1/${kind}/:id`, { schema: { params: schemas.params } }, async request => {
      const record = await deps.store.getResource(kind, (request.params as { id: string }).id);
      if (!record) throw new AppError("not_found", "Resource not found", 404);
      return record;
    });
    app.patch(`/v1/${kind}/:id`, { schema: { params: schemas.params, body: patchSchemas[kind] } }, async request =>
      deps.store.updateResource(kind, (request.params as { id: string }).id, request.body as Partial<ResourceDrafts[typeof kind]>, key(request.headers)));
  }
  app.put("/v1/portfolios/:id/accounts", { schema: { params: schemas.params, body: schemas.membership } }, async request =>
    deps.store.updateResource("portfolios", (request.params as { id: string }).id, request.body as { accountIds: string[] }, key(request.headers)));
  app.post("/v1/inputs", { schema: { body: schemas.inputSubmission } }, async (request, reply) => {
    const body = request.body as { sourceId: string; input: InputDraft };
    return reply.code(202).send(await deps.store.acceptInput(body.sourceId, body.input, key(request.headers)));
  });
  app.get("/v1/inputs", { schema: { querystring: schemas.inputListQuery } }, async request => deps.store.listInputs(request.query as ListOptions & { sourceId?: string }));
  app.get("/v1/inputs/:id", { schema: { params: schemas.params } }, async request => {
    const record = await deps.store.getInput((request.params as { id: string }).id);
    if (!record) throw new AppError("not_found", "Input not found", 404); return record;
  });
  app.post("/v1/portfolios/:id/refresh", { schema: { params: schemas.params } }, async (request, reply) =>
    reply.code(202).send({ requests: await deps.portfolios.requestRefresh((request.params as { id: string }).id, key(request.headers)) }));
  app.get("/v1/portfolios/:id/snapshot", { schema: { params: schemas.params } }, request => inspectPortfolio(deps.store, (request.params as { id: string }).id));
  app.get("/v1/accounts/:id/subaccounts", { schema: { params: schemas.params } }, async request =>
    ({ items: await deps.portfolios.discoverSubAccounts((request.params as { id: string }).id, AbortSignal.timeout(20_000)) }));
  app.get("/v1/refreshes/:id", { schema: { params: schemas.params } }, async request => {
    const record = await deps.store.getRefresh((request.params as { id: string }).id);
    if (!record) throw new AppError("not_found", "Refresh not found", 404); return record;
  });
  app.post("/v1/evaluations", { schema: { body: schemas.evaluation } }, async (request, reply) =>
    reply.code(202).send(await deps.store.requestEvaluation((request.body as { monitorId: string }).monitorId, { kind: "manual" }, key(request.headers))));
  app.get("/v1/evaluations", { schema: { querystring: schemas.evaluationListQuery } }, async request => deps.store.listEvaluations(request.query as ListOptions & { monitorId?: string }));
  app.get("/v1/evaluations/:id", { schema: { params: schemas.params } }, async request => {
    const record = await deps.store.getEvaluation((request.params as { id: string }).id);
    if (!record) throw new AppError("not_found", "Evaluation not found", 404); return record;
  });
  app.post("/v1/notifications", { schema: { body: schemas.notification } }, async (request, reply) =>
    reply.code(202).send(await deps.deliveries.request(request.body as NotificationDraft, key(request.headers))));
  app.post("/v1/destinations/:id/test", { schema: { params: schemas.params, body: schemas.testNotification } }, async (request, reply) =>
    reply.code(202).send(await deps.deliveries.request({ destinationId: (request.params as { id: string }).id,
      content: (request.body as { content: NotificationContent }).content, origin: "operator_test" }, key(request.headers))));
  app.get("/v1/deliveries", { schema: { querystring: schemas.listQuery } }, async request => deps.store.listDeliveries(request.query as ListOptions));
  app.post("/v1/deliveries/:id/reconcile", { schema: { params: schemas.params, body: schemas.deliveryResolution } }, request =>
    deps.store.reconcileDelivery((request.params as { id: string }).id, request.body as DeliveryResolution, key(request.headers)));
  app.get("/v1/deliveries/:id", { schema: { params: schemas.params } }, async request => {
    const record = await deps.store.getDelivery((request.params as { id: string }).id);
    if (!record) throw new AppError("not_found", "Delivery not found", 404); return record;
  });
  app.get("/v1/queues", () => deps.queues.inspect());
  if (deps.sources && deps.sourceStore) {
    const sources = deps.sources, sourceStore = deps.sourceStore;
    app.post("/v1/connections/:id/probe", { schema: { params: schemas.params } }, request => sources.probe((request.params as { id: string }).id, AbortSignal.timeout(30_000)));
    app.get("/v1/connections/:id/targets", { schema: { params: schemas.params, querystring: schemas.discoverQuery } }, async request =>
      ({ items: await sources.discover((request.params as { id: string }).id, AbortSignal.timeout(30_000), (request.query as { limit?: number }).limit) }));
    app.post("/v1/sources/:id/sync", { schema: { params: schemas.params } }, async (request, reply) =>
      reply.code(202).send(await sources.requestSync((request.params as { id: string }).id, key(request.headers))));
    app.get("/v1/sources/:id/status", { schema: { params: schemas.params } }, request => sourceStore.status((request.params as { id: string }).id));
    app.get("/v1/source-syncs/:id", { schema: { params: schemas.params } }, async request => {
      const sync = await sourceStore.getSync((request.params as { id: string }).id);
      if (!sync) throw new AppError("not_found", "Source sync not found", 404);
      return sync;
    });
  }
  return app;
}
