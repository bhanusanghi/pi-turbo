import { test } from "bun:test";
import assert from "node:assert/strict";
import { Type } from "@earendil-works/pi-ai";
import { defineDoc, defineTool } from "@earendil-works/pi-durable";
import { createNativeEvidenceStore, System1EvidenceEntry } from "../dist/index.js";
import { host, context, question, choose, response, finish, helpOptions } from "./host.mjs";

const Count = defineDoc({ kind: "evidence.count", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ n: 0 }) });
const effect = defineTool({ name: "effect", description: "Record an observable effect", parameters: Type.Object({}), replay: "safe",
  async execute(_args, api, ctx) {
    await api.commit(async tx => { (await tx.doc(Count, api.conversationId)).n++; }, ctx);
    return { output: [{ type: "text", text: "effect receipt" }] };
  } });
const recipe = () => ({ id: "test", revision: "evidence-1",
  prepareTurn: ({ messages }) => messages.some(m => m.role === "toolResult")
    ? { kind: "final", status: "completed", text: "Finished" }
    : { request: question({ original: "news input" }), bindings: { exact: "binding" } },
  resolveTurn: () => ({ kind: "tool", name: "effect", args: {} }),
});
const rows = h => h.harness.commit(async tx => (await tx.scanEntries({ conversationId: h.root.id, order: "ascending" }, 100)).items.filter(System1EvidenceEntry.is), context);
async function retained(options = {}) {
  const ready = Promise.withResolvers();
  const h = await host({ integration: recipe(), tools: [effect], ...options,
    evidence: async (record, ctx) => (await ready.promise).write(record, ctx) });
  const store = createNativeEvidenceStore(h.harness);
  ready.resolve(store);
  return { ...h, store };
}

test("native evidence retains exact input, answer and decisions after cleanup, compaction, reset and reopen", async () => {
  let h = await retained({ settings: { compaction: { enabled: true } } });
  const dir = h.dir;
  try {
    assert.equal((await h.run()).status, "done");
    const entries = await rows(h);
    assert.equal(entries.length, 2);
    const first = entries[0].data;
    assert.deepEqual(first.input, { request: question({ original: "news input" }), bindings: { exact: "binding" } });
    assert.equal(first.answer.answers.next.choice, "go");
    assert.deepEqual(first.outcome.decision, { kind: "tool", name: "effect", args: {} });
    assert.equal(entries[1].data.input.kind, "final");
    assert.equal(entries[1].data.answer, undefined);
    assert.equal(entries[1].data.outcome.decision.status, "completed");
    assert.ok(entries.every(e => e.model === undefined));
    const messages = await h.messages();
    assert.equal(messages.filter(m => m.role === "assistant").length, 2);
    assert.ok(!JSON.stringify(messages).includes("original"));
    for (const entry of entries) {
      const task = await h.harness.getTask(entry.data.generationId, context);
      assert.equal(task.state.status, "terminal");
      assert.equal(task.memos, undefined);
      assert.deepEqual((await h.store.read(entry.data, context)).reference.entryId, entry.id);
    }
    const compact = await h.root.compact(undefined, context);
    await h.harness.waitForTask(compact, context);
    assert.deepEqual((await rows(h)).map(e => e.id), entries.map(e => e.id));
    await h.root.reset(undefined, context);
    await h.close();
    h = await retained({ dir });
    for (const entry of entries) {
      const retained = await h.store.read(entry.data, context);
      assert.equal(retained.reference.entryId, entry.id);
      assert.deepEqual(retained.evidence, entry.data);
    }
    assert.deepEqual((await rows(h)).map(e => e.id), entries.map(e => e.id));
    assert.equal(h.seen.classifications.length, 0);
  } finally { await h.close(); await h.cleanup(); }
}, 10000);

test("native transaction deduplicates concurrent identical evidence and rejects conflicts", async () => {
  const h = await retained();
  try {
    await h.run();
    const [entry] = await rows(h);
    const results = await Promise.all(Array.from({ length: 4 }, () => h.store.write(structuredClone(entry.data), context)));
    assert.ok(results.every(r => r.entryId === entry.id));
    const conflicting = structuredClone(entry.data);
    conflicting.outcome.decision.args = { changed: true };
    await assert.rejects(h.store.write(conflicting, context), /Conflicting retained Turbo evidence/);
    assert.equal((await rows(h)).length, 2);
    assert.deepEqual((await h.store.read(entry.data, context)).evidence, entry.data);
    assert.equal(await h.store.read({ ...entry.data, generationId: 999999 }, context), undefined);
  } finally { await h.close(); await h.cleanup(); }
}, 5000);

for (const stopReason of ["error", "aborted"]) {
  test(`classifier ${stopReason} retains actual answer and diagnostic without an effect`, async () => {
    const h = await retained({ classify: req => choose(req, "go", { stopReason, errorMessage: "fixture inference stopped", answers: {} }) });
    try {
      assert.equal((await h.run()).status, "unanswered");
      const [entry] = await rows(h);
      assert.equal(entry.data.answer.stopReason, stopReason);
      assert.equal(entry.data.outcome.diagnostic, "fixture inference stopped");
      assert.equal(entry.data.outcome.decision, undefined);
      assert.equal(await h.harness.snapshot(Count, h.root.id, context), undefined);
      assert.equal(h.seen.classifications.length, 1);
    } finally { await h.close(); await h.cleanup(); }
  }, 5000);
}

test("classifier transport failure retains the native error result and prepared input", async () => {
  const h = await retained({ classify: () => { throw new Error("classifier transport unavailable"); } });
  try {
    assert.equal((await h.run()).status, "unanswered");
    const [entry] = await rows(h);
    assert.equal(entry.data.outcome.diagnostic, "classifier transport unavailable");
    assert.equal(entry.data.answer.stopReason, "error");
    assert.deepEqual(entry.data.answer.answers, {});
    assert.equal(entry.data.input.request.state.original, "news input");
    assert.equal(await h.harness.snapshot(Count, h.root.id, context), undefined);
  } finally { await h.close(); await h.cleanup(); }
}, 5000);

test("recorder failure is reported by Durable but cannot release a signed action", async () => {
  let writes = 0;
  const h = await host({ integration: recipe(), tools: [effect], evidence: async () => { writes++; throw new Error("recorder unavailable"); } });
  try {
    assert.equal((await h.run()).status, "unanswered");
    assert.equal(writes, 1);
    assert.equal(h.seen.classifications.length, 1);
    assert.equal(await h.harness.snapshot(Count, h.root.id, context), undefined);
    assert.ok(h.seen.errors.some(e => String(e).includes("recorder unavailable")));
    assert.ok(!(await h.messages()).some(m => m.role === "assistant" && m.content.some(c => c.type === "toolCall")));
    assert.equal((await h.harness.inspect(context)).tasks.length, 0);
  } finally { await h.close(); await h.cleanup(); }
}, 5000);

test("reopen retries a committed recorder write with the same generation and no repeated inference", async () => {
  const ready = Promise.withResolvers();
  const storeReady = Promise.withResolvers();
  let recorded;
  let h = await host({ integration: recipe(), tools: [effect], evidence: async (record, ctx) => {
    recorded = await (await storeReady.promise).write(record, ctx);
    ready.resolve();
    await new Promise((_resolve, reject) => {
      ctx.abortSignal.throwIfAborted();
      ctx.abortSignal.addEventListener("abort", () => reject(ctx.abortSignal.reason), { once: true });
    });
    return recorded;
  } });
  const dir = h.dir;
  storeReady.resolve(createNativeEvidenceStore(h.harness));
  try {
    const pending = h.run("run", "retained-recovery").catch(() => {});
    await ready.promise;
    assert.equal(await h.harness.snapshot(Count, h.root.id, context), undefined);
    assert.equal(h.seen.classifications.length, 1);
    await h.close();
    await pending;
    h = await retained({ dir });
    assert.equal((await h.run("run", "retained-recovery")).status, "done");
    assert.equal(h.seen.classifications.length, 0);
    assert.equal((await h.harness.snapshot(Count, h.root.id, context)).n, 1);
    const entries = await rows(h);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, recorded.entryId);
    assert.equal(entries[0].data.generationId, recorded.generationId);
  } finally { await h.close(); await h.cleanup(); }
}, 10000);

test("recovery rejects a changed recipe before a recorded action can execute", async () => {
  const ready = Promise.withResolvers();
  let h = await host({ integration: recipe(), tools: [effect], evidence: async (_record, ctx) => {
    ready.resolve();
    await new Promise((_resolve, reject) => ctx.abortSignal.addEventListener("abort", () => reject(ctx.abortSignal.reason), { once: true }));
  } });
  const dir = h.dir;
  try {
    const pending = h.run("run", "recipe-recovery").catch(() => {});
    await ready.promise;
    await h.close(); await pending;
    h = await retained({ dir, integration: { ...recipe(), revision: "evidence-2" } });
    assert.equal((await h.run("run", "recipe-recovery")).status, "unanswered");
    assert.equal(h.seen.classifications.length, 0);
    assert.equal(await h.harness.snapshot(Count, h.root.id, context), undefined);
    assert.ok(h.seen.errors.some(e => String(e).includes("revision changed")));
    assert.equal((await rows(h)).length, 0);
  } finally { await h.close(); await h.cleanup(); }
}, 10000);

test("consultation evidence references the retained native child without copying its transcript", async () => {
  const integration = { ...recipe(), prepareTurn: ({ consultation }) => consultation
    ? { kind: "final", status: "completed", text: consultation.findings }
    : { request: question({ need: "research" }), bindings: {} },
    resolveTurn: () => ({ kind: "consult", request: { goal: "Read", inputs: {}, doneWhen: "Read", tools: [] } }) };
  const h = await retained({ integration, system2: helpOptions, helper: () => response([finish()]) });
  try {
    assert.equal((await h.run()).status, "done");
    const entries = await rows(h);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].data.outcome.decision.kind, "consult");
    const link = entries[1].data.consultation;
    assert.ok(link && link.conversationId !== h.root.id);
    const children = await h.harness.commit(tx => tx.scanConversations({ ownerTaskId: link.taskId }, 10), context);
    assert.equal(children.items[0].id, link.conversationId);
    const childEntries = await h.harness.commit(tx => tx.scanEntries({ conversationId: link.conversationId }, 100), context);
    assert.ok(childEntries.items.some(e => e.kind === "pi.assistant"));
    assert.equal(h.seen.classifications.length, 1);
    assert.deepEqual(h.seen.errors, []);
  } finally { await h.close(); await h.cleanup(); }
}, 5000);
