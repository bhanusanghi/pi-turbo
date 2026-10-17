import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHttp } from "../src/http/index.js";
import type { AppStore, ResourceDrafts } from "../src/contracts.js";
function fixture() {
  const writes: unknown[] = [];
  const queries: unknown[] = [];
  const http = createHttp({ apiToken: "fixture-token", store: {
      async health() { },
      async createResource(kind: string, draft: ResourceDrafts["sources"], key: string) {
        writes.push({ kind, draft, key });
        return { id: "source-1", ...draft };
      },
      async listInputs(query: unknown) { queries.push(query); return { items: [], nextCursor: null }; },
    } as unknown as AppStore, portfolios: {
      async requestRefresh() { throw new Error("Unexpected refresh"); },
      async discoverSubAccounts() { throw new Error("Unexpected discovery"); },
    }, deliveries: { async request() { throw new Error("Unexpected delivery"); } },
    queues: { async health() { }, async inspect() { return { queues: [] }; } } });
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => http.inject({
    method: body === undefined ? "GET" : "POST", url: path,
    headers: { authorization: "Bearer fixture-token", "idempotency-key": "fixture-key", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  return { http, request, writes, queries };
}
test("Fastify validates authorization, idempotency and schema before invoking the store", async () => {
  const { http, request, writes } = fixture();
  try {
    const draft = { name: "Evidence", kind: "manual", enabled: true };
    assert.equal((await request("/v1/sources", draft, { authorization: "Bearer wrong" })).statusCode, 401);
    assert.equal((await request("/v1/sources", draft, { "idempotency-key": "bad" })).statusCode, 400);
    assert.equal((await request("/v1/sources", { ...draft, unexpected: true })).statusCode, 400);
    assert.equal((await request("/v1/sources", { ...draft, enabled: "true" })).statusCode, 400);
    assert.deepEqual(writes, []);
    const response = await request("/v1/sources", draft);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { id: "source-1", ...draft });
    assert.deepEqual(writes, [{ kind: "sources", draft, key: "fixture-key" }]);
  }
  finally {
    await http.close();
  }
});
test("Fastify preserves typed pagination and rejects malformed/oversized bodies", async () => {
  const { http, request, queries, writes } = fixture();
  try {
    assert.equal((await request("/v1/inputs?limit=1&cursor=42")).statusCode, 200);
    assert.deepEqual(queries.map(query => ({ ...query as object })), [{ limit: 1, cursor: "42" }]);
    for (const query of ["limit=0", "limit=1&limit=2", "limit=not-a-number", "extra=value"]) {
      assert.equal((await request(`/v1/inputs?${query}`)).statusCode, 400);
    }
    assert.equal((await request("/v1/sources", { name: "x".repeat(256 * 1024), kind: "manual", enabled: true })).statusCode, 413);
    const malformed = await http.inject({ url: "/v1/sources", method: "POST",
      headers: { authorization: "Bearer fixture-token", "idempotency-key": "fixture-key", "content-type": "application/json" }, payload: "{" });
    assert.equal(malformed.statusCode, 400);
    assert.deepEqual(writes, []);
  }
  finally {
    await http.close();
  }
});
test("Fastify readiness is public and reflects failed dependencies; closed handler declines work", async () => {
  const { http, request } = fixture();
  assert.equal((await http.inject({ url: "/health/live" })).statusCode, 200);
  const ready = await http.inject({ url: "/health/ready" });
  assert.deepEqual(ready.json(), { ready: true, database: true, redis: true, evaluator: "not_configured" });
  await http.close();
  await assert.rejects(request("/v1/inputs"), /closed|closing|reopen/i);
  const unavailable = createHttp({ apiToken: "fixture-token", store: { async health() { throw new Error("Database unavailable"); } } as unknown as AppStore,
    queues: { async health() { }, async inspect() { } }, portfolios: { async requestRefresh() { return []; }, async discoverSubAccounts() { return []; } },
    deliveries: { async request() { } } });
  try {
    const response = await unavailable.inject({ url: "/health/ready" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { ready: false, database: false, redis: true, evaluator: "not_configured" });
  }
  finally {
    await unavailable.close();
  }
});
