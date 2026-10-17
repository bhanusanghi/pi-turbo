import { test } from "bun:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import { inspectPortfolio } from "../src/queries.js";
import type { AppStore, PortfolioSnapshot } from "../src/contracts.js";
const env = { DATABASE_URL: "postgresql://user:password@localhost:5432/example", REDIS_URL: "redis://localhost:6379", API_TOKEN: "a-local-operator-token-long-enough" };
test("configuration defaults are local and invalid credential-bearing URLs are sanitized", () => {
  const config = readConfig(env);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8787);
  for (const name of ["DATABASE_URL", "REDIS_URL"]) {
    assert.throws(() => readConfig({ ...env, [name]: "invalid://:private-test-secret@[broken" }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(name));
      assert.ok(!String(error).includes("private-test-secret"));
      return true;
    });
  }
  assert.throws(() => readConfig({ ...env, API_TOKEN: "short" }));
  assert.throws(() => readConfig({ ...env, QUEUE_PREFIX: "invalid:prefix" }));
});
test("freshness ages the earliest account read rather than resetting at its completion", async () => {
  const snapshot = { portfolioRevision: 1, coverage: "complete", accountSnapshots: [{ accountId: "account", accountRevision: 1,
        startedAt: new Date(Date.now() - 180000).toISOString(), completedAt: new Date().toISOString() }] } as PortfolioSnapshot;
  const store = { async getResource(kind: string) { return kind === "portfolios" ? { id: "portfolio", revision: 1, enabled: true, accountIds: ["account"] } : { id: "account", revision: 1, enabled: true }; },
    async latestPortfolioSnapshot() { return snapshot; } } as unknown as AppStore;
  const result = await inspectPortfolio(store, "portfolio");
  assert.equal(result.fresh, false);
  assert.deepEqual(result.reasons, ["stale:account"]);
});
