import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "bun:test";
import type { Account, AccountObservation, AppStore, PortfolioProvider, RefreshRequest } from "../src/contracts.js";
import { createPortfolioModule } from "../src/portfolio/index.js";
const account: Account = { id: "a1", revision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", label: "test", address: `0x${"1".repeat(40)}`, enabled: true, network: "testnet", perpDexs: "all" };
const observation: AccountObservation = { accountId: "a1", network: "testnet", address: account.address, startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:00Z", positions: [], accountMode: "disabled", accountFacts: {}, raw: {}, coverage: [], issues: [], exposureHash: "empty" };
const refresh: RefreshRequest = { id: "r1", accountId: "a1", reason: "test", status: "queued", dirty: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", snapshotId: null, error: null };
const provider = (overrides: Partial<PortfolioProvider> = {}): PortfolioProvider => ({ async read() { return observation; }, async subscribe() { return async () => { }; }, async subAccounts() { return []; }, async close() { }, ...overrides });
test("portfolio refresh delegates one atomic command with its original idempotency key", async () => {
  const requested: unknown[][] = [];
  const store = {
    async requestPortfolioRefresh(...args: unknown[]) { requested.push(args); return [refresh]; },
  } as unknown as AppStore;
  const module = createPortfolioModule({ store, provider: provider() });
  assert.deepEqual(await module.requestRefresh("p1", "test-key"), [refresh]);
  assert.deepEqual(requested, [["p1", "test-key"]]);
  await module.close();
});
test("worker calls provider and store production boundary, and rejects a configuration change during the read", async () => {
  let current = { ...account };
  const finished: unknown[][] = [];
  const store = {
    async beginRefresh() { return refresh; }, async getResource() { return current; },
    async finishRefresh(...args: unknown[]) { finished.push(args); },
  } as unknown as AppStore;
  const first = createPortfolioModule({ store, provider: provider() });
  await first.processRefresh("r1", new AbortController().signal);
  assert.equal(finished[0]![1], observation);
  await first.close();
  const second = createPortfolioModule({ store, provider: provider({ async read() { current = { ...current, revision: 2 }; return observation; } }) });
  await assert.rejects(second.processRefresh("r1", new AbortController().signal), /configuration changed/);
  assert.equal(finished[1]![1], null);
  assert.match(String(finished[1]![2]), /configuration changed/);
  await second.close();
});
test("subscriptions precede bootstrap, periodic reconciliation replaces changed account subscriptions, and close drains them", async () => {
  const events: string[] = [];
  let current = { ...account };
  const store = {
    async listResources() { return { items: [current], nextCursor: null }; },
    async requestRefresh(_id: string, reason: string) { events.push(reason); return refresh; },
  } as unknown as AppStore;
  const module = createPortfolioModule({ store, refreshIntervalMs: 100, provider: provider({
      async subscribe(account, onChange) { events.push(`subscribe:${account.revision}`); onChange(); return async () => { events.push(`unsubscribe:${account.revision}`); }; },
      async close() { events.push("provider-close"); },
    }) });
  await module.start();
  await delay(20);
  assert.equal(events[0], "subscribe:1");
  assert.ok(events.includes("subscription_change"));
  assert.ok(events.includes("startup"));
  current = { ...current, revision: 2 };
  await delay(130);
  assert.ok(events.includes("unsubscribe:1"));
  assert.ok(events.includes("subscribe:2"));
  await module.close();
  assert.ok(events.includes("unsubscribe:2"));
  assert.equal(events.at(-1), "provider-close");
});
test("subscription failure retains REST bootstrap and lifecycle startup stays responsive", async () => {
  const errors: unknown[] = [];
  const events: string[] = [];
  const store = {
    async listResources() { return { items: [account], nextCursor: null }; },
    async requestRefresh(_id: string, reason: string) { events.push(reason); return refresh; },
  } as unknown as AppStore;
  const module = createPortfolioModule({ store, onError: error => errors.push(error), provider: provider({ async subscribe() { await delay(20); throw new Error("socket unavailable"); } }) });
  await module.start();
  assert.equal(events.length, 0);
  await delay(30);
  assert.equal(events.length, 1);
  assert.match(String(errors[0]), /socket unavailable/);
  await module.close();
});
