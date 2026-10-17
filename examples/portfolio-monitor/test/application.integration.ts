import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { Queue } from "bullmq";
import { GrammyError } from "grammy";
import { createApplication } from "../src/application.js";
import { createApplicationExtension } from "../src/pi/index.js";
import type { Account, AccountObservation, Json, PortfolioProvider } from "../src/contracts.js";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createAssistantMessageEventStream, type AssistantMessage, type Message } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const id = () => randomUUID();
async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10000;
  while (true) {
    const value = await read();
    if (accept(value))
      return value;
    if (Date.now() > deadline)
      assert.fail(`Timed out waiting for application state: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
function observation(account: Account): AccountObservation {
  const at = new Date().toISOString();
  return { accountId: account.id, network: account.network, address: account.address, startedAt: at, completedAt: at,
    accountMode: "default", positions: [{ kind: "spot", accountId: account.id, instrumentId: "testnet:hyperliquid:spot:150",
        tokenId: 150, venueSymbol: "HYPE", total: "12.5", hold: "1", spotHold: null, value: null }],
    accountFacts: {}, raw: { fixture: "external portfolio provider" }, exposureHash: "fixture-holdings",
    coverage: [{ part: "spot", status: "complete", receivedAt: at }, { part: "perps", status: "complete", receivedAt: at }], issues: [] };
}
test.skipIf(Boolean((!dbUrl || !redisUrl) && "Set TEST_DATABASE_URL and TEST_REDIS_URL for real infrastructure tests"))("complete HTTP/database/Redis/worker foundation; evaluator remains disconnected", async () => {
  const database = `pm_test_${id().replaceAll("-", "")}`;
  const admin = new SQL(dbUrl!);
  await admin.unsafe(`CREATE DATABASE ${database}`);
  const url = new URL(dbUrl!);
  url.pathname = `/${database}`;
  const prefix = `test-${id()}`;
  const calls: {
    chat: number | string;
    text: string;
  }[] = [];
  const rateLimitTimes: number[] = [];
  const errors: unknown[] = [];
  let providerReads = 0;
  const provider: PortfolioProvider = {
    async read(account, signal) { signal.throwIfAborted(); providerReads++; return observation(account); },
    async subscribe() { return async () => { }; }, async subAccounts() { return []; }, async close() { },
  };
  const application = createApplication({ databaseUrl: url.href, redisUrl: redisUrl!, apiToken: "fixture-operator-token-long-enough",
    host: "127.0.0.1", port: 8787, queuePrefix: prefix, refreshIntervalMs: 60000, dispatchIntervalMs: 25 }, {
    portfolioProvider: provider, onError: error => errors.push(error), resolveSecret: () => "fixture-token-no-network",
    telegramClient: () => ({ async sendMessage(chat, text) {
        calls.push({ chat, text });
        if (text.includes("Rate limit fixture")) {
          rateLimitTimes.push(Date.now());
          if (rateLimitTimes.length === 1)
            throw new GrammyError("Fixture rejection", { ok: false, error_code: 429, description: "Test rate limit", parameters: { retry_after: 1 } }, "sendMessage", {});
        }
        return { message_id: 42, date: 1, chat: { id: chat } };
      } }),
  });
  try {
    await application.start(false);
    const headers = { authorization: "Bearer fixture-operator-token-long-enough" };
    async function request(method: "GET" | "POST" | "PUT" | "PATCH", path: string, payload?: object, key: string = id(), expected = method === "GET" || method === "PATCH" || method === "PUT" ? 200 : 201) {
      const response = await application.http.inject({ method, url: path, headers: { ...headers, "idempotency-key": key }, ...(payload ? { payload } : {}) });
    assert.equal(response.statusCode, expected, `${method} ${path}: ${response.body}`);
    return response.json();
  }
  assert.equal((await application.http.inject({ url: "/v1/accounts" })).statusCode, 401);
  assert.equal((await application.http.inject({ method: "POST", url: "/v1/accounts", headers, payload: {} })).statusCode, 400);
  const ready = await application.http.inject({ url: "/health/ready" });
  assert.equal(ready.statusCode, 200); assert.equal(ready.json().evaluator, "not_configured");
  const source = await request("POST", "/v1/sources", { name: "Manual fixture source", kind: "manual", enabled: true });
    const account = await request("POST", "/v1/accounts", { label: "Fixture account", address: `0x${"1".repeat(40)}`, network: "testnet", perpDexs: "all", enabled: true });
    const portfolio = await request("POST", "/v1/portfolios", { name: "Fixture portfolio", accountIds: [account.id], enabled: true });
    const destination = await request("POST", "/v1/destinations", { label: "Preview", adapter: "preview", enabled: true });
    const monitor = await request("POST", "/v1/monitors", { name: "Pending evaluator", portfolioId: portfolio.id, sourceIds: [source.id], destinationIds: [destination.id], enabled: true });
    { // refresh queue produces inspectable normalized snapshot through HTTP
      const refresh = await request("POST", `/v1/portfolios/${portfolio.id}/refresh`, undefined, "r".repeat(200), 202);
      await eventually(() => request("GET", `/v1/refreshes/${refresh.requests[0].id}`), value => value.status === "completed");
      const view = await request("GET", `/v1/portfolios/${portfolio.id}/snapshot`);
      assert.equal(view.fresh, true);
      assert.equal(view.snapshot.positions[0].total, "12.5");
      assert.ok(providerReads > 0);
    }
    let inputId = "";
    let evaluationId = "";
    { // inputs retain corrections, paginate and queue real unevaluated work
      const payload = { sourceId: source.id, input: { sourceItemId: "article-a", kind: "article", publishedAt: null, text: "Original report", sourceRevision: "1" } };
      const first = await request("POST", "/v1/inputs", payload, id(), 202);
      inputId = first.inputId;
      evaluationId = first.evaluationIds[0];
      const repeat = await request("POST", "/v1/inputs", payload, id(), 202);
      assert.equal(repeat.duplicate, true);
      assert.deepEqual(repeat.evaluationIds, []);
      await request("POST", "/v1/inputs", { sourceId: source.id, input: { ...payload.input, sourceRevision: "2", text: "Corrected report" } }, id(), 202);
      assert.equal((await request("GET", `/v1/inputs/${inputId}`)).revisions.length, 2);
      const page = await request("GET", `/v1/inputs?sourceId=${source.id}&limit=1`);
      assert.ok(page.nextCursor);
      assert.equal((await request("GET", `/v1/inputs?sourceId=${source.id}&limit=1&cursor=${page.nextCursor}`)).items.length, 1);
      const evalPage = await request("GET", `/v1/evaluations?monitorId=${monitor.id}&limit=1`);
      assert.ok(evalPage.nextCursor);
      assert.equal((await request("GET", `/v1/evaluations?monitorId=${monitor.id}&limit=1&cursor=${evalPage.nextCursor}`)).items.length, 1);
      await eventually(() => application.queues.inspect(), state => (state.queues.find(q => q.name === "evaluation.run")?.counts.waiting ?? 0) > 0);
      assert.equal((await request("GET", `/v1/evaluations/${evaluationId}`)).status, "awaiting_evaluator");
      assert.equal((await application.queues.inspect()).queues.find(q => q.name === "evaluation.run")!.paused, true);
    }
    { // notification queue produces preview and explicit transport receipt; duplicate request sends once
      const preview = await request("POST", `/v1/destinations/${destination.id}/test`, { content: { title: "Pipeline test", body: "This is an operator test" } }, id(), 202);
      const delivered = await eventually(() => request("GET", `/v1/deliveries/${preview.id}`), value => value.status === "previewed");
      assert.match(delivered.renderedText, /operator test/);
      assert.equal(calls.length, 0);
      const telegram = await request("POST", "/v1/destinations", { label: "Fixture transport", adapter: "telegram", chatId: "-123", secretRef: "FIXTURE_BOT", enabled: true });
      const key = id();
      const body = { content: { title: "Explicit test", body: "Transport is substituted" } };
      const sent = await request("POST", `/v1/destinations/${telegram.id}/test`, body, key, 202);
      assert.equal((await request("POST", `/v1/destinations/${telegram.id}/test`, body, key, 202)).id, sent.id);
      const receipt = await eventually(() => request("GET", `/v1/deliveries/${sent.id}`), value => value.status === "sent");
      assert.ok(receipt.receipt);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.chat, "-123");
      await request("POST", `/v1/destinations/${telegram.id}/test`, { content: { ...body.content, body: "Changed" } }, key, 409);
      const delayed = await request("POST", `/v1/destinations/${telegram.id}/test`, { content: { title: "Rate limit fixture", body: "Confirmed rejection is retryable" } }, id(), 202);
      const retried = await eventually(() => request("GET", `/v1/deliveries/${delayed.id}`), value => value.status === "sent");
      assert.equal(retried.attempts, 2);
      assert.equal(rateLimitTimes.length, 2);
      assert.ok(rateLimitTimes[1]! - rateLimitTimes[0]! >= 950, "retry_after must delay the next transmission");
      await request("PATCH", `/v1/destinations/${telegram.id}`, { enabled: false });
      assert.equal((await request("POST", `/v1/destinations/${telegram.id}/test`, body, key, 202)).id, sent.id);
    }
    { // native Durable application tools enforce configured scope without a real model
      const native = createApplicationExtension({ store: application.store, portfolioIds: [portfolio.id], sourceIds: [source.id], notifications: application.deliveries });
      assert.deepEqual(native.tools.map(tool => tool.name), ["portfolio_snapshot", "evidence_read"]);
      const allowed = await runNativeTool(native, "evidence_read", { inputId });
      assert.equal(allowed.isError, false);
      assert.match(JSON.stringify(allowed.content), /Corrected report/);
      const denied = await runNativeTool(native, "portfolio_snapshot", { portfolioId: id() });
      assert.equal(denied.isError, true);
      const invalid = await runNativeTool(native, "portfolio_snapshot", { unexpected: true });
      assert.equal(invalid.isError, true);
    }
    { // configuration changes make existing snapshot explicitly ineligible
      await request("PATCH", `/v1/accounts/${account.id}`, { enabled: false });
      const view = await request("GET", `/v1/portfolios/${portfolio.id}/snapshot`);
      assert.equal(view.fresh, false);
      assert.ok(view.reasons.length);
      await request("POST", `/v1/portfolios/${portfolio.id}/refresh`, undefined, id(), 409);
    }
    assert.deepEqual(errors, []);
  }
  finally {
    await application.close();
    for (const name of ["portfolio.refresh", "evaluation.run", "notification.deliver"]) {
      const queue = new Queue(name, { connection: { url: redisUrl! }, prefix });
      try {
        await queue.obliterate({ force: true });
      }
      finally {
        await queue.close();
      }
    }
    await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.close();
  }
}, 60000);
/** A deterministic model transport only supplies a tool call to exercise native validation/execution. */
async function runNativeTool(product: ReturnType<typeof createApplicationExtension>, name: string, args: Record<string, Json>) {
  const context = BACKGROUND_CONTEXT;
  const registry = createRegistry();
  registry.install(product.extension);
  const models = createModels();
  let calls = 0;
  const model = { id: "tool-fixture", provider: "fixture", type: "chat" as const, name: "Fixture transport", api: "fixture-chat", baseUrl: "",
    reasoning: false, input: ["text"] as ("text")[], contextWindow: 64000, maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const stream = () => {
    const content: AssistantMessage["content"] = calls++ === 0 ? [{ type: "toolCall", id: "call-1", name, arguments: args }] : [{ type: "text", text: "Done" }];
    const message: AssistantMessage = { role: "assistant", provider: "fixture", model: "tool-fixture", api: "fixture-chat", content,
      timestamp: Date.now(), stopReason: calls === 1 ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const events = createAssistantMessageEventStream();
    events.push({ type: "start", partial: message });
    events.push({ type: "done", reason: message.stopReason as "toolUse" | "stop", message });
    events.end(message);
    return events;
  };
  models.setProvider({ id: "fixture", name: "Native tool test", auth: { apiKey: { name: "fixture", resolve: async () => ({ auth: {}, source: "fixture" }) } }, getModels: () => [model], stream, streamSimple: stream });
  const harness = await Harness.open(new MemoryStorage(), { registry, models, settings: { compaction: { enabled: false }, retry: { enabled: false } } }, context);
  try {
    const root = await harness.root(context, { agent: { extensions: [product.extension], tools: product.tools, model: { provider: "fixture", modelId: "tool-fixture" } } });
    await (await root.submit({ type: "input", content: "Exercise tool adapter" }, context)).wait(context);
    const result = (await root.context(context)).messages.find((message: Message) => message.role === "toolResult");
    assert.ok(result?.role === "toolResult");
    return result;
  }
  finally {
    await harness.close(context);
  }
}
