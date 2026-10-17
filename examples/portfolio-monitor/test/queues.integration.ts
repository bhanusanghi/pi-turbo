import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createQueueRuntime } from "../src/queues/index.js";
import type { AppStore } from "../src/contracts.js";
test("unavailable Redis fails startup within a deadline and closes reconnecting clients", async () => {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  await reservation.stop(true);
  const runtime = createQueueRuntime({ store: {} as AppStore, redisUrl: `redis://127.0.0.1:${port}`, prefix: `unavailable-${randomUUID()}`,
    async processRefresh() { assert.fail("No job should run"); }, async processDelivery() { assert.fail("No job should run"); } });
  const before = Date.now();
  try {
    await assert.rejects(runtime.start(), /Redis readiness timeout/);
    assert.ok(Date.now() - before < 8000);
  }
  finally {
    await runtime.close();
  }
}, 12000);
