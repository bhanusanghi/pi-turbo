import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createSourceCatalog, emptySourceCatalog } from "../src/sources/catalog.js";
import type { SourceDefinition } from "../src/sources/catalog.js";
import type { InputDraft } from "../src/contracts.js";
import type { ConnectionDraft, SourceWatch } from "../src/sources/contracts.js";
import { input, resource } from "../src/storage/validation.js";
import { createResourceSchemas, input as inputSchema } from "../src/http/schemas.js";

const closed = (properties: Parameters<typeof Type.Object>[0]) => Type.Object(properties, { additionalProperties: false });
const base = { label: Type.String({ minLength: 1, maxLength: 200 }), enabled: Type.Boolean() };
const pollDefinition: SourceDefinition = {
  id: "synthetic-poll",
  connectionSchema: closed({ ...base, adapter: Type.Literal("synthetic-poll"), tokenRef: Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,99}$" }), shared: Type.Optional(Type.Integer()) }),
  validateWatch(_connection, watch) {
    if ((watch.mode ?? "poll") !== "poll" || !watch.target.startsWith("feed:")) throw new Error("poll target required");
  },
  acceptsRevision(previous, incoming) { return previous.sourceRevision !== incoming.sourceRevision; },
};
const pushDefinition: SourceDefinition = {
  id: "synthetic-push",
  connectionSchema: closed({ ...base, adapter: Type.Literal("synthetic-push"), channel: Type.String({ minLength: 1 }), shared: Type.Optional(Type.String()) }),
  validateWatch(_connection, watch) {
    if (watch.mode !== "push" || watch.target !== "alerts") throw new Error("push target required");
  },
};
const catalog = createSourceCatalog([pollDefinition, pushDefinition]);
const poll: ConnectionDraft = { label: "Poll", enabled: true, adapter: "synthetic-poll", tokenRef: "POLL_TOKEN" };
const push: ConnectionDraft = { label: "Push", enabled: true, adapter: "synthetic-push", channel: "news" };
const watch: SourceWatch = { connectionId: randomUUID(), target: "feed:market/news", pollIntervalMs: 10000 };
const draft: InputDraft = { sourceItemId: "item", kind: "article", publishedAt: null, text: "News", sourceRevision: "1" };

test("empty catalog has no implicit providers and rejects every connection", () => {
  assert.deepEqual(emptySourceCatalog.definitions, []);
  assert.equal(emptySourceCatalog.get("synthetic-poll"), undefined);
  assert.throws(() => emptySourceCatalog.validateConnection(poll), { code: "invalid_input" });
  assert.throws(() => resource("connections", poll), { code: "invalid_input" });
  assert.equal(Value.Check(emptySourceCatalog.connectionSchema, poll), false);
  assert.equal(Value.Check(emptySourceCatalog.connectionPatchSchema, {}), true);
  assert.equal(Value.Check(emptySourceCatalog.connectionPatchSchema, { tokenRef: "TOKEN" }), false);
});

test("catalog rejects duplicate and unsafe registrations", () => {
  assert.throws(() => createSourceCatalog([pollDefinition, pollDefinition]), /Duplicate source definition/);
  assert.throws(() => createSourceCatalog([{ ...pollDefinition, id: "wrong-id" }]), /matching literal adapter/);
  assert.throws(() => createSourceCatalog([{ ...pollDefinition, connectionSchema: Type.Object({ ...base, adapter: Type.Literal("synthetic-poll") }) }]), /closed object/);
  assert.throws(() => createSourceCatalog([{ ...pollDefinition, connectionSchema: closed({ ...base, adapter: Type.Optional(Type.Literal("synthetic-poll")) }) }]), /required/);
});

test("registered connection policy is identical in HTTP schemas and direct storage validation", () => {
  const schemas = createResourceSchemas(catalog);
  assert.equal(catalog.get(poll.adapter), pollDefinition);
  assert.deepEqual(catalog.definitions, [pollDefinition, pushDefinition]);
  for (const connection of [poll, push]) {
    assert.equal(Value.Check(schemas.resourceSchemas.connections, connection), true);
    assert.doesNotThrow(() => resource("connections", connection, catalog));
  }
  for (const connection of [
    { ...poll, adapter: "unregistered" }, { ...poll, tokenRef: "actual-secret-value" }, { ...poll, enabled: "yes" },
    { ...poll, label: 1 }, { ...poll, tokenRef: 1 }, { ...poll, secret: "inline credential" }, { ...poll, channel: "news" },
  ]) {
    assert.equal(Value.Check(schemas.resourceSchemas.connections, connection), false);
    assert.throws(() => resource("connections", connection as ConnectionDraft, catalog), { code: "invalid_input" });
  }
});

test("provider watch policy distinguishes polling and push targets while core validates bounds", () => {
  assert.doesNotThrow(() => resource("sources", { name: "News", enabled: true, kind: "adapter", watch }, catalog));
  assert.doesNotThrow(() => catalog.validateWatch(poll, watch));
  assert.doesNotThrow(() => catalog.validateWatch({ ...poll, id: randomUUID(), revision: 1, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" }, watch));
  assert.doesNotThrow(() => catalog.validateWatch(push, { ...watch, mode: "push", target: "alerts" }));
  assert.throws(() => catalog.validateWatch(poll, { ...watch, mode: "push" }), /poll target/);
  assert.throws(() => catalog.validateWatch(push, watch), /push target/);
  assert.throws(() => catalog.validateWatch({ ...poll, adapter: "missing" }, watch), { code: "invalid_input" });
  for (const invalid of [{ ...watch, mode: "stream" }, { ...watch, pollIntervalMs: 9999 }, { ...watch, maxPages: 21 }, { ...watch, startAt: "2026-02-30T00:00:00Z" }, { ...watch, secret: "hidden" }]) {
    assert.throws(() => resource("sources", { name: "News", enabled: true, kind: "adapter", watch: invalid as SourceWatch }, catalog), { code: "invalid_input" });
  }
});

test("safe patches expose known optional fields and final validation preserves provider ownership", () => {
  const schema = createResourceSchemas(catalog).patchSchemas.connections;
  for (const patch of [{}, { enabled: false }, { tokenRef: "NEW_TOKEN" }, { shared: 5 }, { shared: "five" }, { channel: "alerts" }]) assert.equal(Value.Check(schema, patch), true);
  for (const patch of [{ tokenRef: 5 }, { enabled: null }, { adapter: "synthetic-push" }, { secret: "inline" }, { shared: false }]) assert.equal(Value.Check(schema, patch), false);
  assert.doesNotThrow(() => resource("connections", { ...poll, tokenRef: "NEW_TOKEN" }, catalog));
  assert.throws(() => resource("connections", { ...poll, channel: "alerts" }, catalog), { code: "invalid_input" });
  assert.throws(() => resource("connections", { ...poll, shared: "five" }, catalog), { code: "invalid_input" });
  assert.throws(() => resource("connections", { ...push, shared: 5 }, catalog), { code: "invalid_input" });
});

test("revision acceptance is provider-owned and unknown provider policies fail closed", () => {
  assert.equal(catalog.acceptsRevision(poll.adapter, draft, draft), false);
  assert.equal(catalog.acceptsRevision(poll.adapter, draft, { ...draft, sourceRevision: "2" }), true);
  assert.equal(catalog.acceptsRevision(push.adapter, draft, draft), true);
  assert.throws(() => catalog.acceptsRevision("unknown", draft, draft), { code: "invalid_input" });
});

test("news provenance allows bounded provider-neutral fields without arbitrary metadata", () => {
  const provenance = { provider: "synthetic-news", targetId: "news", messageId: "item", contentKind: "headline" as const, permission: "licensed", relatedSymbols: ["BTC", "HYPE"] };
  assert.doesNotThrow(() => input({ ...draft, provenance }));
  assert.equal(Value.Check(inputSchema, { ...draft, provenance }), true);
  for (const malformed of [
    { ...provenance, provider: "x".repeat(101) }, { ...provenance, provider: 1 }, { ...provenance, contentKind: "video" },
    { ...provenance, permission: "x".repeat(201) }, { ...provenance, relatedSymbols: ["BTC", "BTC"] },
    { ...provenance, relatedSymbols: ["x".repeat(101)] }, { ...provenance, relatedSymbols: Array.from({ length: 101 }, (_, i) => `S${i}`) },
    { ...provenance, secret: "hidden" },
  ]) {
    assert.equal(Value.Check(inputSchema, { ...draft, provenance: malformed }), false);
    assert.throws(() => input({ ...draft, provenance: malformed as typeof provenance }), { code: "invalid_input" });
  }
});
