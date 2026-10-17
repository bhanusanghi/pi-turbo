import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore } from "../src/storage/index.js";
test("application store rejects malformed input before accessing PostgreSQL", async () => {
  const store = createStore("postgresql://unused:unused@127.0.0.1:1/unused");
  try {
    await assert.rejects(store.createResource("accounts", { label: "Invalid", address: "not-an-address", network: "testnet", perpDexs: "all", enabled: true }, randomUUID()), { code: "invalid_input" });
    await assert.rejects(store.acceptInput(randomUUID(), { sourceItemId: "a", kind: "article", publishedAt: null, text: "test", url: "file:///tmp/secret" }, randomUUID()), { code: "invalid_input" });
    await assert.rejects(store.requestNotification({ destinationId: randomUUID(), origin: "application", content: { title: "test", body: "test", links: [{ label: "unsafe", url: "https://user:password@example.org" }] } }, randomUUID()), { code: "invalid_input" });
    await assert.rejects(store.listResources("sources", { limit: 201 }), { code: "invalid_input" });
    await assert.rejects(store.getDelivery("not-a-uuid"), { code: "invalid_input" });
    for (const publishedAt of ["1", "2026-10-14", "2026-10-14T00:00:00", "2026-02-30T10:00:00Z", "2025-02-29T10:00:00Z", "2026-10-14T24:00:00Z", "2026-10-14T00:00:00+05:60"]) {
      await assert.rejects(store.acceptInput(randomUUID(), { sourceItemId: "a", kind: "article", publishedAt, text: "test" }, randomUUID()), { code: "invalid_input" });
    }
    await assert.rejects(store.finishRefresh(randomUUID(), { accountId: randomUUID(), network: "testnet", address: `0x${"0".repeat(40)}`, startedAt: "1", completedAt: new Date().toISOString(), positions: [], accountMode: null, accountFacts: {}, coverage: [], issues: [], exposureHash: "test", raw: {} }), { code: "invalid_input" });
  }
  finally {
    await store.close();
  }
});
