import { tradingViewSourceExtensions } from "../src/providers/tradingview/index.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { Queue } from "bullmq";
import { createApplication } from "../src/application.js";
import { createTradingViewClient } from "../src/providers/tradingview/client.js";

const databaseUrl = process.env.TEST_DATABASE_URL, redisUrl = process.env.TEST_REDIS_URL;
async function eventually(read: () => Promise<any>, accept: (value: any) => boolean) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { const value = await read(); if (accept(value)) return value; await Bun.sleep(25); }
  assert.fail("Timed out waiting for TradingView ingestion");
}
test.skipIf(!databaseUrl || !redisUrl)("TradingView user connections: polling and webhook → guarded ingress → paused evaluations", async () => {
  const dbName = `pm_tv_${randomUUID().replaceAll("-", "")}`, prefix = `tv-${randomUUID()}`;
  const admin = new SQL(databaseUrl!); await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url = new URL(databaseUrl!); url.pathname = `/${dbName}`;
  const receiverToken = "r".repeat(128);
  const published = Math.floor(Date.now() / 1000);
  let title = "Synthetic market headline";
  const provider = createTradingViewClient({ resolveSecret: async () => { throw Error("Public feed needs no credentials"); },
    fetch: (async () => Response.json({ items: [{ id: "synthetic:1", title, provider: "fixture", published, permission: "headline", relatedSymbols: [{ symbol: "CRYPTO:BTCUSD" }] }] })) as unknown as typeof fetch });
  const app = createApplication({ databaseUrl: url.href, redisUrl: redisUrl!, apiToken: "fixture-api-token", host: "127.0.0.1", port: 8787, queuePrefix: prefix, refreshIntervalMs: 60000, dispatchIntervalMs: 25 }, {
    sourceExtensions: tradingViewSourceExtensions,
    resolveSecret: name => name === "TV_RECEIVER" ? receiverToken : undefined,
    sourceClients: { "tradingview-headlines": provider },
    portfolioProvider: { async read() { throw Error("No accounts expected"); }, async subscribe() { return async () => {}; }, async subAccounts() { return []; }, async close() {} },
  });
  async function request(method: "GET" | "POST" | "PATCH", path: string, payload?: object, status = method === "POST" ? 201 : 200) {
    const result = await app.http.inject({ method, url: path, headers: { authorization: "Bearer fixture-api-token", "idempotency-key": randomUUID() }, ...(payload ? { payload } : {}) });
    assert.equal(result.statusCode, status, `${method} ${path}: ${result.body}`); return result.json();
  }
  try {
    await app.start(false);
    const connection = await request("POST", "/v1/connections", { adapter: "tradingview-headlines", label: "My headlines", enabled: true });
    const source = await request("POST", "/v1/sources", { kind: "adapter", name: "Bitcoin news", enabled: false,
      watch: { connectionId: connection.id, target: "CRYPTO:BTCUSD", pollIntervalMs: 60000, startAt: new Date((published - 5) * 1000).toISOString() } });
    const portfolio = await request("POST", "/v1/portfolios", { name: "Portfolio", enabled: true, accountIds: [] });
    const monitor = await request("POST", "/v1/monitors", { name: "Monitor", enabled: true, portfolioId: portfolio.id, sourceIds: [source.id], destinationIds: [] });
    await request("PATCH", `/v1/sources/${source.id}`, { enabled: true });
    async function sync() {
      const run = await request("POST", `/v1/sources/${source.id}/sync`, undefined, 202);
      await eventually(() => request("GET", `/v1/source-syncs/${run.id}`), x => x.status === "completed");
    }
    await sync(); await sync();
    let inputs = await request("GET", `/v1/inputs?sourceId=${source.id}`);
    assert.equal(inputs.items.length, 1, "same provider observation is deduplicated");
    title = "Corrected synthetic headline"; await sync();
    inputs = await request("GET", `/v1/inputs?sourceId=${source.id}`);
    assert.equal(inputs.items.length, 2, "changed headline becomes another input revision");
    let evaluations = await request("GET", `/v1/evaluations?monitorId=${monitor.id}`);
    assert.equal(evaluations.items.length, 2);
    assert.ok(evaluations.items.every((e: any) => e.status === "awaiting_evaluator"));

    const webhook = await request("POST", "/v1/connections", { adapter: "tradingview-webhook", label: "My alert receiver", enabled: true, secretRef: "TV_RECEIVER" });
    assert.ok(!JSON.stringify(await request("GET", "/v1/connections")).includes(receiverToken));
    const push = await request("POST", "/v1/sources", { kind: "adapter", name: "My BTC alert", enabled: true,
      watch: { mode: "push", connectionId: webhook.id, target: "CRYPTO:BTCUSD", pollIntervalMs: 60000 } });
    await request("PATCH", `/v1/monitors/${monitor.id}`, { sourceIds: [source.id, push.id] });
    const alert = { eventId: "btc-cross-1", symbol: "CRYPTO:BTCUSD", triggeredAt: new Date().toISOString(), text: "Synthetic threshold crossed" };
    const send = (body = alert, token = receiverToken) => app.http.inject({ method: "POST", url: `/webhooks/tradingview/${push.id}/${token}`, payload: body });
    assert.equal((await send(alert, "wrong_token_12345678901234567890123")).statusCode, 401);
    assert.equal((await send({ ...alert, symbol: "CRYPTO:ETHUSD" })).statusCode, 400);
    assert.equal((await send({ ...alert, triggeredAt: "2026-02-30T00:00:00Z" })).statusCode, 400);
    assert.equal((await send({ ...alert, extra: "unknown" } as typeof alert)).statusCode, 400);
    const first = await send(); assert.equal(first.statusCode, 202, first.body); assert.equal(first.json().duplicate, false);
    const repeat = await send(); assert.equal(repeat.statusCode, 202, repeat.body); assert.equal(repeat.json().duplicate, true);
    assert.equal((await send({ ...alert, text: "Different event with same ID" })).statusCode, 409);
    assert.equal((await request("GET", `/v1/inputs?sourceId=${push.id}`)).items.length, 1);
    await app.sourceStore.scheduleDue();
    assert.equal((await request("GET", `/v1/sources/${push.id}/status`)).nextRunAt, null);
    await request("POST", `/v1/sources/${push.id}/sync`, undefined, 409);
    // The webhook auth exemption cannot authorize management endpoints or other methods.
    assert.equal((await app.http.inject({ method: "GET", url: `/webhooks/tradingview/${push.id}/${receiverToken}` })).statusCode, 401);
    assert.equal((await app.http.inject({ method: "POST", url: "/v1/inputs", payload: {} })).statusCode, 401);
    await request("PATCH", `/v1/connections/${webhook.id}`, { enabled: false });
    assert.equal((await send()).statusCode, 401, "even duplicate delivery is rejected after disable");
    await request("PATCH", `/v1/connections/${webhook.id}`, { enabled: true });
    await request("PATCH", `/v1/sources/${push.id}`, { enabled: false });
    assert.equal((await send()).statusCode, 401);
    evaluations = await request("GET", `/v1/evaluations?monitorId=${monitor.id}`);
    assert.equal(evaluations.items.length, 3, "rejected and repeated alerts do not create evaluations");
    assert.equal((await request("GET", "/v1/queues")).queues.find((q: any) => q.name === "evaluation.run").paused, true);
  } finally {
    await app.close();
    for (const name of ["source.sync", "evaluation.run", "portfolio.refresh", "notification.deliver"]) {
      const queue = new Queue(name, { connection: { url: redisUrl! }, prefix });
      try { await queue.obliterate({ force: true }); } finally { await queue.close(); }
    }
    await admin.unsafe(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.close();
  }
}, 40000);
