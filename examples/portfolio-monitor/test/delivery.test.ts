import assert from "node:assert/strict";
import { test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { GrammyError } from "grammy";
import type { AppStore, Delivery, DeliveryResult, Destination, NotificationDraft } from "../src/contracts.js";
import { createDeliveryModule, createTelegramAdapter, renderNotification } from "../src/delivery/index.js";
import type { TelegramClient } from "../src/delivery/telegram.js";
const now = "2026-10-14T00:00:00.000Z";
const destination: Destination = { id: "destination", label: "Alerts", enabled: true, adapter: "telegram", chatId: "-10042", secretRef: "TEST_TELEGRAM_TOKEN", revision: 1, createdAt: now, updatedAt: now };
const draft: NotificationDraft = { destinationId: destination.id, origin: "operator_test", content: { title: "Portfolio watch", body: "A manually requested notification", links: [{ label: "Source", url: "https://example.com/article" }] } };
const idle = new AbortController().signal;
const receipt = { message_id: 42, chat: { id: -10042 }, date: 1791936000 };
const secrets = (name: string) => name === "TEST_TELEGRAM_TOKEN" ? "test-token-never-persist" : undefined;
function apiError(code: number, retryAfter?: number): GrammyError {
  return new GrammyError("private token-bearing diagnostic", { ok: false, error_code: code, description: "private diagnostic", ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }) }, "sendMessage", {});
}
/** Stateful storage seam; PostgreSQL transaction behavior is covered by storage integration tests. */
function storage(initialDestination: Destination = destination) {
  let target: Destination | null = structuredClone(initialDestination);
  const records = new Map<string, Delivery>();
  const keys = new Map<string, string>();
  const destinationRevisions = new Map<string, number>();
  const outcomes: DeliveryResult[] = [];
  const store = {
    async getResource() { return target; },
    async requestNotification(value: NotificationDraft, key: string) {
      const oldId = keys.get(key);
      if (oldId)
        return structuredClone(records.get(oldId)!);
      if (!target)
        throw new Error("Notification destination not found");
      if (!target.enabled)
        throw new Error("Notification destination is disabled");
      const id = String(records.size + 1);
      const result: Delivery = { ...structuredClone(value), id, status: "queued", renderedText: null, receipt: null, error: null, attempts: 0, nextAttemptAt: null, createdAt: now, updatedAt: now };
      records.set(id, result);
      keys.set(key, id);
      destinationRevisions.set(id, target!.revision);
      return structuredClone(result);
    },
    async getDelivery(id: string) { return records.has(id) ? structuredClone(records.get(id)!) : null; },
    async beginDelivery(id: string, text: string) {
      const record = records.get(id);
      if (!record || record.status !== "queued" || (record.nextAttemptAt && Date.parse(record.nextAttemptAt) > Date.now()))
        return null;
      if (!target || !target.enabled || target.revision !== destinationRevisions.get(id)) {
        record.status = "rejected";
        record.error = "Destination disabled, missing or changed after request";
        return null;
      }
      record.status = "sending";
      record.renderedText = text;
      record.attempts++;
      return structuredClone(record);
    },
    async finishDelivery(id: string, result: DeliveryResult) {
      const record = records.get(id)!;
      outcomes.push(result);
      if (result.status === "retry") {
        record.status = "queued";
        record.error = result.error;
        record.nextAttemptAt = new Date(Date.now() + result.retryAfterMs).toISOString();
      }
      else {
        record.status = result.status;
        record.nextAttemptAt = null;
        if (result.status === "sent" || result.status === "previewed") {
          record.receipt = result.receipt;
          record.error = null;
        }
        else if ("error" in result)
          record.error = result.error;
      }
      return structuredClone(record);
    },
  } as unknown as AppStore;
  return { store, records, outcomes, setDestination(value: Destination | null) { target = value; } };
}
test("renderer produces plain deterministic text and source URLs", () => {
  assert.equal(renderNotification(draft.content), "Portfolio watch\n\nA manually requested notification\n\nSource: https://example.com/article");
  assert.equal(renderNotification({ title: "<b>literal</b>", body: "[literal](text)" }), "<b>literal</b>\n\n[literal](text)");
});
test("renderer rejects oversized and invalid content without truncation", () => {
  assert.equal(renderNotification({ title: "A", body: "x".repeat(4093) }).length, 4096);
  assert.throws(() => renderNotification({ title: "A", body: "x".repeat(4094) }), /not truncated/);
  assert.throws(() => renderNotification({ title: "A", body: "😀".repeat(2047) }), /exceeds/);
  for (const content of [
    { title: " ", body: "B" }, { title: "A", body: "\u0000" },
    { title: "A", body: "B", links: [{ label: "source", url: "javascript:alert(1)" }] },
    { title: "A", body: "B", links: [{ label: "source", url: "https://user:password@example.com" }] },
    { title: "A", body: "B", links: [{ label: "bad\nlabel", url: "https://example.com" }] },
  ])
    assert.throws(() => renderNotification(content));
});
test("preview runs request -> admission -> rendered receipt; duplicate jobs do not send", async () => {
  const fixture = storage({ ...destination, adapter: "preview" });
  let externalCalls = 0;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: () => { externalCalls++; throw Error("must not run"); } });
  const first = await module.request(draft, "same-key");
  const second = await module.request(draft, "same-key");
  assert.equal(first.id, second.id);
  await Promise.all([module.processDelivery(first.id, idle), module.processDelivery(first.id, idle)]);
  await module.processDelivery(first.id, idle);
  const result = await fixture.store.getDelivery(first.id);
  assert.equal(result!.status, "previewed");
  assert.equal(result!.attempts, 1);
  assert.deepEqual(result!.receipt, { provider: "preview", text: renderNotification(draft.content) });
  assert.equal(externalCalls, 0);
});
test("Telegram records acceptance receipt and sends plain text to configured chat", async () => {
  const fixture = storage();
  let externalCalls = 0;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: token => {
      assert.equal(token, "test-token-never-persist");
      return { async sendMessage(chatId, text, options, signal) {
          externalCalls++;
          assert.equal(chatId, "-10042");
          assert.equal(text, renderNotification(draft.content));
          assert.deepEqual(options, { link_preview_options: { is_disabled: true } });
          assert.equal(signal.aborted, false);
          return receipt;
        } };
    } });
  const item = await module.request(draft, "one");
  await module.processDelivery(item.id, idle);
  await module.processDelivery(item.id, idle);
  const result = await fixture.store.getDelivery(item.id);
  assert.equal(result!.status, "sent");
  assert.equal(externalCalls, 1);
  assert.deepEqual(result!.receipt, { provider: "telegram", messageId: "42", chatId: "-10042", providerTimestamp: receipt.date });
  assert.doesNotMatch(JSON.stringify(result), /test-token/);
});
test("new disabled destination is rejected atomically at admission", async () => {
  const fixture = storage({ ...destination, enabled: false });
  let calls = 0;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: () => { calls++; throw Error("must not run"); } });
  await assert.rejects(module.request(draft, "one"), /disabled/);
  assert.equal(fixture.records.size, 0);
  assert.equal(calls, 0);
});
test("new missing-secret request is accepted then explicitly rejected at dispatch", async () => {
  const fixture = storage();
  let calls = 0;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: () => undefined, createClient: () => { calls++; throw Error("must not run"); } });
  const item = await module.request(draft, "one");
  assert.equal(item.status, "queued");
  assert.equal(fixture.records.size, 1);
  await module.processDelivery(item.id, idle);
  const result = await fixture.store.getDelivery(item.id);
  assert.equal(result!.status, "rejected");
  assert.match(result!.error!, /secret is unavailable/);
  assert.equal(calls, 0);
});
test("accepted request receipt stays recoverable after destination disable and secret removal", async () => {
  const fixture = storage();
  let secretsAvailable = true;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: name => secretsAvailable ? secrets(name) : undefined });
  const original = await module.request(draft, "same-key");
  fixture.setDestination({ ...destination, enabled: false, revision: 2 });
  secretsAvailable = false;
  const recovered = await module.request(draft, "same-key");
  assert.deepEqual(recovered, original);
  assert.equal(fixture.records.size, 1);
  await module.processDelivery(original.id, idle);
  const terminal = await module.request(draft, "same-key");
  assert.equal(terminal.id, original.id);
  assert.equal(terminal.status, "rejected");
});
test("destination disabled after acceptance is rejected at dispatch", async () => {
  const fixture = storage();
  let calls = 0;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: () => { calls++; throw Error("must not run"); } });
  const item = await module.request(draft, "one");
  fixture.setDestination({ ...destination, enabled: false });
  await module.processDelivery(item.id, idle);
  assert.equal((await fixture.store.getDelivery(item.id))!.status, "rejected");
  assert.equal(calls, 0);
});
test("destination changed before admission rejects the queued delivery", async () => {
  const fixture = storage();
  let calls = 0;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: () => ({ async sendMessage() { calls++; return receipt; } }) });
  const item = await module.request(draft, "one");
  fixture.setDestination({ ...destination, chatId: "-10099", revision: 2 });
  await module.processDelivery(item.id, idle);
  assert.equal((await fixture.store.getDelivery(item.id))!.status, "rejected");
  assert.equal(calls, 0);
});
test("destination PATCH after admission cannot reroute Telegram chat or adapter", async () => {
  for (const patch of [{ ...destination, chatId: "-10099", revision: 2 }, { ...destination, adapter: "preview" as const, revision: 2 }]) {
    const fixture = storage();
    const begin = fixture.store.beginDelivery.bind(fixture.store);
    fixture.store.beginDelivery = async (id, rendered) => { const admitted = await begin(id, rendered); fixture.setDestination(patch); return admitted; };
    let calls = 0;
    const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: () => ({ async sendMessage(chatId) {
          calls++;
          assert.equal(chatId, destination.chatId);
          return receipt;
        } }) });
    const item = await module.request(draft, "one");
    await module.processDelivery(item.id, idle);
    const result = await fixture.store.getDelivery(item.id);
    assert.equal(result!.status, "sent");
    assert.equal(calls, 1);
    assert.deepEqual(result!.receipt, { provider: "telegram", messageId: "42", chatId: destination.chatId, providerTimestamp: receipt.date });
  }
});
test("missing destination and vanished secret never reach an external send", async () => {
  for (const mode of ["missing", "secret"] as const) {
    const fixture = storage();
    let calls = 0;
    let available = true;
    const module = createDeliveryModule({ store: fixture.store, resolveSecret: name => available ? secrets(name) : undefined, createClient: () => ({ async sendMessage() { calls++; return receipt; } }) });
    const item = await module.request(draft, "one");
    if (mode === "missing")
      fixture.setDestination(null);
    else
      available = false;
    await module.processDelivery(item.id, idle);
    assert.equal((await fixture.store.getDelivery(item.id))!.status, "rejected");
    assert.equal(calls, 0);
  }
});
test("invalid stored content is rejected with nonempty diagnostic and no send", async () => {
  const fixture = storage();
  let calls = 0;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: () => ({ async sendMessage() { calls++; return receipt; } }) });
  const item = await module.request(draft, "one");
  fixture.records.get(item.id)!.content.body = "";
  await module.processDelivery(item.id, idle);
  const result = await fixture.store.getDelivery(item.id);
  assert.equal(result!.status, "rejected");
  assert.ok(result!.renderedText!.length > 0);
  assert.equal(calls, 0);
});
test("confirmed API rejection is terminal and redacts provider diagnostics", async () => {
  const fixture = storage();
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: () => ({ async sendMessage() { throw apiError(403); } }) });
  const item = await module.request(draft, "one");
  await module.processDelivery(item.id, idle);
  const result = await fixture.store.getDelivery(item.id);
  assert.equal(result!.status, "rejected");
  assert.equal(result!.error, "Telegram rejected message (API 403)");
  assert.doesNotMatch(JSON.stringify(result), /private/);
});
test("ambiguous network failure becomes unknown without a blind resend", async () => {
  const fixture = storage();
  let calls = 0;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: () => ({ async sendMessage() { calls++; throw Error("https://api.telegram.org/bottest-token/sendMessage"); } }) });
  const item = await module.request(draft, "one");
  await module.processDelivery(item.id, idle);
  await module.processDelivery(item.id, idle);
  const result = await fixture.store.getDelivery(item.id);
  assert.equal(result!.status, "unknown");
  assert.equal(calls, 1);
  assert.equal(result!.nextAttemptAt, null);
  assert.doesNotMatch(JSON.stringify(result), /test-token/);
});
test("confirmed 429 delays retry, prevents early send, and caps attempts", async () => {
  const fixture = storage();
  let calls = 0;
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, maxAttempts: 2, createClient: () => ({ async sendMessage() { calls++; throw apiError(429, 2); } }) });
  const item = await module.request(draft, "one");
  const before = Date.now();
  await module.processDelivery(item.id, idle);
  let result = await fixture.store.getDelivery(item.id);
  assert.equal(result!.status, "queued");
  assert.ok(Date.parse(result!.nextAttemptAt!) >= before + 2000);
  assert.equal(fixture.outcomes[0]!.status, "retry");
  await module.processDelivery(item.id, idle);
  assert.equal(calls, 1);
  fixture.records.get(item.id)!.nextAttemptAt = new Date(0).toISOString();
  await module.processDelivery(item.id, idle);
  await module.processDelivery(item.id, idle);
  result = await fixture.store.getDelivery(item.id);
  assert.equal(result!.status, "rejected");
  assert.equal(result!.attempts, 2);
  assert.equal(calls, 2);
});
test("429 without retry_after and excessive delay are terminal rejections", async () => {
  for (const retryAfter of [undefined, 0, 3601]) {
    const adapter = createTelegramAdapter({ resolveSecret: secrets, createClient: () => ({ async sendMessage() { throw apiError(429, retryAfter); } }) });
    const result = await adapter.send(destination, "text", idle);
    assert.equal(result.status, "rejected");
  }
});
test("bounded timeout marks uncertain acceptance unknown", async () => {
  const adapter = createTelegramAdapter({ resolveSecret: secrets, timeoutMs: 5, createClient: () => ({ async sendMessage() { await delay(25); return receipt; } }) });
  const result = await adapter.send(destination, "text", idle);
  assert.equal(result.status, "unknown");
});
test("abort before send prevents transmission; abort during send is unknown", async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  const adapter = createTelegramAdapter({ resolveSecret: secrets, createClient: () => ({ async sendMessage() { calls++; return receipt; } }) });
  assert.equal((await adapter.send(destination, "text", before.signal)).status, "rejected");
  assert.equal(calls, 0);
  const during = new AbortController();
  const interrupted = createTelegramAdapter({ resolveSecret: secrets, createClient: () => ({ async sendMessage() { calls++; during.abort(); await delay(1); return receipt; } }) });
  assert.equal((await interrupted.send(destination, "text", during.signal)).status, "unknown");
  assert.equal(calls, 1);
});
test("valid provider receipt survives a host abort before app receipt commit", async () => {
  const fixture = storage();
  const controller = new AbortController();
  const finish = fixture.store.finishDelivery.bind(fixture.store);
  fixture.store.finishDelivery = async (id, result) => { controller.abort(); return finish(id, result); };
  const client: TelegramClient = { async sendMessage() { return receipt; } };
  const module = createDeliveryModule({ store: fixture.store, resolveSecret: secrets, createClient: () => client });
  const item = await module.request(draft, "one");
  await module.processDelivery(item.id, controller.signal);
  const result = await fixture.store.getDelivery(item.id);
  assert.equal(controller.signal.aborted, true);
  assert.equal(result!.status, "sent");
  assert.deepEqual(result!.receipt, { provider: "telegram", messageId: "42", chatId: "-10042", providerTimestamp: receipt.date });
});
test("malformed provider receipt is unknown rather than falsely sent", async () => {
  const adapter = createTelegramAdapter({ resolveSecret: secrets, createClient: () => ({ async sendMessage() { return { ...receipt, message_id: NaN }; } }) });
  assert.equal((await adapter.send(destination, "text", idle)).status, "unknown");
});
