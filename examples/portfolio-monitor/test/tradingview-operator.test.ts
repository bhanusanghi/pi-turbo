import { tradingViewSourceExtensions } from "../src/providers/tradingview/index.js";
import { createSourceCatalog } from "../src/sources/catalog.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { runSourceCli } from "../src/source-cli.js";
import { createHttp } from "../src/http/index.js";
import type { AppStore } from "../src/contracts.js";

test("TradingView CLI reuses connection API, optional session refs and push source schema", async () => {
  const writes: { kind: string; draft: any }[] = [];
  const app = createHttp({ catalog:createSourceCatalog(tradingViewSourceExtensions), apiToken: "fixture-token", store: {
    async createResource(kind: string, draft: any) { writes.push({ kind, draft }); return { id: "11111111-1111-4111-8111-111111111111", ...draft }; },
  } as unknown as AppStore, portfolios: { async requestRefresh() { return []; }, async discoverSubAccounts() { return []; } },
  deliveries: { async request() {} }, queues: { async health() {}, async inspect() {} } });
  const transport = (async (url: URL | string, init: RequestInit) => {
    const u = new URL(url);
    const reply = await app.inject({ method: init.method as "POST", url: u.pathname, headers: init.headers as Record<string, string>, payload: init.body as string });
    return new Response(reply.body, { status: reply.statusCode });
  }) as typeof fetch;
  const options = { extensions:tradingViewSourceExtensions, env: { API_TOKEN: "fixture-token" }, fetch: transport, print() {} };
  try {
    await runSourceCli(["connection", "add", "--adapter", "tradingview-headlines", "--name", "Public"], options);
    assert.deepEqual(writes[0], { kind: "connections", draft: { label: "Public", enabled: true, adapter: "tradingview-headlines" } });
    for (const adapter of ["tradingview-headlines", "tradingview-api", "tradingview-webhook"]) {
      await runSourceCli(["connection", "add", "--adapter", adapter, "--name", "Mine", "--secret-ref", "MY_TV_SECRET"], options);
      assert.equal(writes.at(-1)!.draft.secretRef, "MY_TV_SECRET");
    }
    await assert.rejects(runSourceCli(["connection", "add", "--adapter", "tradingview-api", "--name", "Missing key"], options), /secret-ref/);
    await runSourceCli(["source", "add", "--connection", "11111111-1111-4111-8111-111111111111", "--target", "CRYPTO:BTCUSD", "--name", "Alerts", "--mode", "push"], options);
    assert.equal(writes.at(-1)!.draft.watch.mode, "push");
    assert.equal(writes.at(-1)!.draft.watch.target, "CRYPTO:BTCUSD");
  } finally { await app.close(); }
});
