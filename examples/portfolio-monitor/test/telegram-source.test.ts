import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelegramClient, Message, PeersIndex, Long } from "@mtcute/bun";
import type { tl } from "@mtcute/bun";
import { createTelegramSourceClient, loginTelegram, logoutTelegram, type TelegramMessage, type TelegramOptions, type TelegramPeer, type TelegramTransport } from "../src/providers/telegram/client.js";
import type { InputDraft } from "../src/contracts.js";
import { SourceFailure, type Connection, type WatchedSource } from "../src/sources/contracts.js";

class Emitter<T> {
  readonly handlers = new Set<(value: T) => void>();
  add(fn: (value: T) => void) { this.handlers.add(fn); }
  remove(fn: (value: T) => void) { this.handlers.delete(fn); }
  emit(value: T) { for (const fn of this.handlers) fn(value); }
}
const peer: TelegramPeer = { id: -1001234567890, type: "chat", chatType: "channel", displayName: "Market", username: "market_news" };
const user: TelegramPeer = { id: 77, type: "user", displayName: "Reader" };
const connection: Connection = { id: "tg", revision: 1, createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z", label: "Telegram", enabled: true, adapter: "telegram-user", apiIdRef: "TG_ID", apiHashRef: "TG_HASH", sessionName: "test" };
const source: WatchedSource = { id: "source", revision: 1, createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z", name: "News", kind: "adapter", enabled: true, watch: { connectionId: "tg", target: "@market_news", pollIntervalMs: 60_000, maxPages: 3 } };
const signal = new AbortController().signal;
const msg = (id: number, changes: Partial<TelegramMessage> = {}): TelegramMessage => ({ id, date: new Date("2026-10-16T01:00:00Z"), text: `News ${id}`, chat: peer, sender: user, ...changes });
class Transport implements TelegramTransport {
  onNewMessage = new Emitter<TelegramMessage>();
  onEditMessage = new Emitter<TelegramMessage>();
  onDeleteMessage = new Emitter<{ channelId: number | null; messageIds: number[] }>();
  pages: TelegramMessage[][] = [[]];
  offsets: (number | undefined)[] = [];
  me = user; destroyed = 0; loggedOut = 0; starts = 0; error: Error | null = null;
  async getMe() { if (this.error) throw this.error; return this.me; }
  async getChat() { return peer; }
  async getHistory(_target: number, options: { limit: number; offset?: { id: number; date: number } }) { this.offsets.push(options.offset?.id); return this.pages.shift() ?? []; }
  async *iterDialogs() { yield { peer: user }; yield { peer }; }
  async start(options: Parameters<TelegramTransport["start"]>[0]) { this.starts++; await options.phone(); await options.code(); await options.password(); return this.getMe(); }
  async logOut() { this.loggedOut++; }
  async destroy() { this.destroyed++; }
}
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function fixture(transport = new Transport()) {
  const directory = await mkdtemp(join(tmpdir(), "turbo-telegram-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const options: TelegramOptions = { sessionDirectory: directory, resolveSecret: async name => name === "TG_ID" ? "123" : "a".repeat(32), createTransport: async ({ storage }) => { await writeFile(storage, "session"); return transport; } };
  const client = createTelegramSourceClient(options); cleanups.push(() => client.close());
  return { directory, transport, client, options };
}
test("normalizes SDK Message objects, text/caption provenance, reply, forward and same-second edits", async () => {
  const { transport, client } = await fixture();
  const raw = { _: "message", id: 10, peerId: { _: "peerChannel", channelId: 1234567890 }, fromId: { _: "peerUser", userId: 77 }, date: Date.parse("2026-10-16T01:00:00Z") / 1000, message: "BTC update", editDate: Date.parse("2026-10-16T01:02:00Z") / 1000,
    replyTo: { _: "messageReplyHeader", replyToMsgId: 9, replyToTopId: 8 }, fwdFrom: { _: "messageFwdHeader", date: 1, fromName: "Analyst" } } as tl.RawMessage;
  const index = PeersIndex.from({ users: [{ _: "user", id: 77, firstName: "Reader" }], chats: [{ _: "channel", id: 1234567890, accessHash: Long.ONE, title: "Market", username: "market_news", broadcast: true, photo: { _: "chatPhotoEmpty" }, date: 0 }] });
  transport.pages = [[new Message(raw, index)]];
  const first = await client.collect(connection, source, null, signal);
  expect(first.items).toHaveLength(1);
  const item = first.items[0]!;
  expect(item.sourceItemId).toBe(`${peer.id}:10`);
  expect(item.url).toBe("https://t.me/market_news/10");
  expect(item.relatesTo).toEqual([{ sourceItemId: `${peer.id}:9`, relation: "reply" }]);
  expect(item.provenance).toMatchObject({ provider: "telegram", targetId: String(peer.id), messageId: "10", authorId: "77", forwardedFrom: "Analyst", editedAt: "2026-10-16T01:02:00.000Z" });
  transport.pages = [[new Message({ ...raw, message: "BTC correction" }, index)]];
  const second = await client.collect(connection, source, first.checkpoint, signal);
  expect(second.items[0]!.sourceRevision).not.toBe(item.sourceRevision);
  transport.pages = [[new Message({ ...raw, message: "BTC correction" }, index)]];
  const duplicate = await client.collect(connection, source, second.checkpoint, signal);
  expect(duplicate.items[0]!.sourceRevision).toBe(second.items[0]!.sourceRevision);
});
test("bounded scans retain cursor and do not advance high-water until missing pages are fetched", async () => {
  const { transport, client } = await fixture();
  transport.pages = [Array.from({ length: 100 }, (_, i) => msg(300 - i)), Array.from({ length: 100 }, (_, i) => msg(200 - i)), [msg(100)]];
  const bounded = { ...source, watch: { ...source.watch, maxPages: 1 } };
  const first = await client.collect(connection, bounded, null, signal);
  expect(first.gap).toBe(true); expect(first.checkpoint).toEqual({ version: 1, targetId: String(peer.id), afterId: 0, scanHead: 300, offsetId: 201 });
  const second = await client.collect(connection, bounded, first.checkpoint, signal);
  expect(second.gap).toBe(true); expect(second.checkpoint.afterId).toBe(0);
  const third = await client.collect(connection, source, second.checkpoint, signal);
  expect(third.gap).toBe(false); expect(third.checkpoint).toEqual({ version: 1, targetId: String(peer.id), afterId: 300 });
  expect(transport.offsets).toEqual([undefined, 201, 101, 100]);
  expect([...first.items, ...second.items, ...third.items].map(item => item.sourceItemId)).toHaveLength(201);
  transport.pages = [[msg(302), msg(301), msg(300)]];
  const next = await client.collect(connection, source, third.checkpoint, signal);
  expect(next.checkpoint.afterId).toBe(302); expect(transport.offsets.at(-1)).toBeUndefined();
});
test("start-from-now boundary ignores earlier history; skips service/media-only messages and filters replies/forwards", async () => {
  const { transport, client } = await fixture();
  transport.pages = [[msg(5), msg(4, { text: "", isService: true }), msg(3, { replyToMessage: { id: 2, chat: null, threadId: null } }), msg(2, { forward: { sender: user } }), msg(1, { date: new Date("2026-10-15T23:59:59Z") })]];
  const result = await client.collect(connection, { ...source, watch: { ...source.watch, includeReplies: false, includeReposts: false } }, null, signal);
  expect(result.items.map(item => item.sourceItemId)).toEqual([`${peer.id}:5`]);
  expect(result.gap).toBe(false);
});
test("rejects wrong-target checkpoint, malformed messages and non-advancing pagination", async () => {
  const { transport, client } = await fixture();
  await expect(client.collect(connection, source, { version: 1, targetId: "other", afterId: 0 }, signal)).rejects.toMatchObject({ code: "contract" });
  transport.pages = [[msg(1, { date: new Date("invalid") })]];
  await expect(client.collect(connection, source, null, signal)).rejects.toMatchObject({ code: "contract" });
  transport.pages = [[msg(1), msg(1)]];
  await expect(client.collect(connection, source, null, signal)).rejects.toMatchObject({ code: "contract" });
});
test("maps auth/flood errors to safe diagnostics and never logs secret-bearing exceptions", async () => {
  const { transport, client } = await fixture();
  transport.error = new Error("AUTH_KEY_UNREGISTERED cookie=super-secret");
  await expect(client.probe(connection, signal)).rejects.toMatchObject({ code: "authentication", message: "Telegram authorization is unavailable. Reconnect this account locally." });
  transport.error = new Error("Telegram API error 420: FLOOD_WAIT_32 cookie=super-secret");
  await expect(client.probe(connection, signal)).rejects.toMatchObject({ code: "rate_limit", retryAfterMs: 32_000 });
  transport.error = new Error("session=super-secret");
  try { await client.probe(connection, signal); throw new Error("expected rejection"); } catch (error) { expect(error).toBeInstanceOf(SourceFailure); expect(String(error)).not.toContain("super-secret"); }
  expect(transport.starts).toBe(0);
});
test("one account client serves multiple targets, session locks prevent concurrent owners, revision replaces client", async () => {
  const { directory, transport, client, options } = await fixture();
  expect(await client.probe(connection, signal)).toEqual({ identity: "77", label: "Reader" });
  expect(await client.discover!(connection, signal)).toEqual([{ id: String(peer.id), label: "Market", username: "market_news" }]);
  const other = createTelegramSourceClient(options); cleanups.push(() => other.close());
  await expect(other.probe(connection, signal)).rejects.toMatchObject({ code: "configuration" });
  expect((await stat(join(directory, "test"))).mode & 0o777).toBe(0o700);
  expect((await stat(join(directory, "test", "session.sqlite"))).mode & 0o777).toBe(0o600);
  expect(await readFile(join(directory, "test", "owner.lock"), "utf8")).toBe(String(process.pid));
  await client.probe({ ...connection, revision: 2 }, signal);
  expect(transport.destroyed).toBe(1);
});
test("live filtering publishes edits and identifiable channel deletions and removes listeners on cancellation", async () => {
  const { transport, client } = await fixture(); const controller = new AbortController(); const received: InputDraft[] = [];
  const stop = await client.watch!(connection, source, async input => { received.push(input); }, controller.signal);
  transport.onNewMessage.emit(msg(1, { chat: { ...peer, id: -100999 } }));
  transport.onNewMessage.emit(msg(2));
  transport.onEditMessage.emit(msg(2, { text: "Changed", editDate: new Date("2026-10-16T03:00:00Z") }));
  transport.onDeleteMessage.emit({ channelId: null, messageIds: [2] });
  transport.onDeleteMessage.emit({ channelId: peer.id, messageIds: [2] });
  // drain the serialized publication chain before cancellation
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(received.map(item => [item.sourceItemId, item.deleted ?? false])).toEqual([[`${peer.id}:2`, false], [`${peer.id}:2`, false], [`${peer.id}:2`, true]]);
  controller.abort(); await stop();
  expect(transport.onNewMessage.handlers.size).toBe(0);
  expect(transport.onEditMessage.handlers.size).toBe(0);
  expect(transport.onDeleteMessage.handlers.size).toBe(0);
});
test("interactive login uses callbacks, closes persisted session; logout revokes authorization", async () => {
  const { transport, options } = await fixture(); const calls: string[] = [];
  const result = await loginTelegram({ ...options, apiIdRef: "TG_ID", apiHashRef: "TG_HASH", sessionName: "login", phone: async () => { calls.push("phone"); return "+1000"; }, code: async () => { calls.push("code"); return "12345"; }, password: async () => { calls.push("password"); return "password"; } });
  expect(result.identity).toBe("77"); expect(calls).toEqual(["phone", "code", "password"]); expect(transport.destroyed).toBe(1);
  await logoutTelegram({ ...options, apiIdRef: "TG_ID", apiHashRef: "TG_HASH", sessionName: "login" });
  expect(transport.loggedOut).toBe(1); expect(transport.destroyed).toBe(2);
});
test("rejects path traversal, bot sessions and pre-cancelled work", async () => {
  const { transport, client } = await fixture();
  await expect(client.probe({ ...connection, sessionName: "../escape" }, signal)).rejects.toMatchObject({ code: "configuration" });
  transport.me = { ...user, type: "bot" };
  await expect(client.probe(connection, signal)).rejects.toMatchObject({ code: "authentication" });
  const controller = new AbortController(); controller.abort();
  await expect(client.probe(connection, controller.signal)).rejects.toMatchObject({ code: "transport" });
});
test("real mtcute Bun SDK initializes and reopens its SQLite session without making a network connection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "turbo-mtcute-smoke-")); cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const storage = join(directory, "session.sqlite");
  for (let i = 0; i < 2; i++) { const client = new TelegramClient({ apiId: 123, apiHash: "a".repeat(32), storage, logLevel: 0 }); try { await client.prepare(); } finally { await client.destroy(); } }
  expect((await stat(storage)).size).toBeGreaterThan(0);
});
test("aborted discovery destroys its blocked transport, releases the session and notifies live leases", async () => {
  let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
  class BlockedDialogs extends Transport {
    async *iterDialogs() { entered(); await new Promise<never>(() => {}); yield { peer }; }
  }
  const blocked = new BlockedDialogs(); const next = new Transport();
  const { directory, client, options } = await fixture(blocked);
  let creations = 0;
  // A real async generator's return() stays blocked behind next(), even after transport teardown.
  // The adapter must close the transport without awaiting the queued generator return.
  const reconnecting = createTelegramSourceClient({ ...options, createTransport: async ({ storage }) => { await writeFile(storage, "session"); return creations++ === 0 ? blocked : next; } });
  cleanups.push(() => reconnecting.close());
  const interrupted: SourceFailure[] = [];
  const stop = await reconnecting.watch!(connection, source, async () => {}, signal, error => { interrupted.push(error); });
  const controller = new AbortController();
  const pending = reconnecting.discover!(connection, controller.signal);
  await waiting; controller.abort();
  const outcome = await Promise.race([pending.then(() => "unexpected", () => "cancelled"), new Promise<string>(resolve => setTimeout(() => resolve("hung"), 250))]);
  expect(outcome).toBe("cancelled"); expect(blocked.destroyed).toBe(1);
  expect(interrupted).toHaveLength(1); expect(interrupted[0]!.code).toBe("transport");
  expect(blocked.onNewMessage.handlers.size).toBe(0);
  await stop();
  expect(await reconnecting.probe(connection, signal)).toEqual({ identity: "77", label: "Reader" });
  expect(creations).toBe(2);
  expect(await readFile(join(directory, "test", "owner.lock"), "utf8")).toBe(String(process.pid));
  await client.close();
});
test("history cancellation terminates the in-flight request and next collection recreates the session", async () => {
  let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
  let rejectRequest!: (error: Error) => void;
  let settled = false;
  class BlockedHistory extends Transport {
    override async getHistory() { entered(); try { return await new Promise<TelegramMessage[]>((_, reject) => { rejectRequest = reject; }); } finally { settled = true; } }
    override async destroy() { await super.destroy(); rejectRequest(new Error("Transport stopped")); }
  }
  const blocked = new BlockedHistory(), next = new Transport();
  const { options } = await fixture(blocked); let creations = 0;
  const client = createTelegramSourceClient({ ...options, createTransport: async () => creations++ === 0 ? blocked : next }); cleanups.push(() => client.close());
  const controller = new AbortController(); const pending = client.collect(connection, source, null, controller.signal);
  await waiting; controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "transport" });
  expect(blocked.destroyed).toBe(1); expect(settled).toBe(true);
  next.pages = [[msg(1)], []];
  const batch = await client.collect(connection, source, null, signal);
  expect(batch.items).toHaveLength(1); expect(creations).toBe(2);
});
test("private message links require channel/supergroup type rather than a basic-group ID prefix", async () => {
  const { transport, client } = await fixture();
  const basicGroup = { ...peer, id: -100123, chatType: "group", username: null };
  transport.getChat = async () => basicGroup;
  transport.pages = [[msg(1, { chat: basicGroup })], []];
  const batch = await client.collect(connection, source, null, signal);
  expect(batch.items[0]!.url).toBeUndefined();
  const privateChannel = { ...peer, username: null }; transport.getChat = async () => privateChannel;
  transport.pages = [[msg(1, { chat: privateChannel })], []];
  const channelBatch = await client.collect(connection, source, null, signal);
  expect(channelBatch.items[0]!.url).toBe("https://t.me/c/1234567890/1");
});

test("live watch preparation waits for a resolved checkpoint and pins the numeric target", async () => {
  const { client, transport } = await fixture();
  expect(client.prepareWatch?.(connection, source, null)).toBeNull();
  const checkpoint = { version: 1, targetId: String(peer.id), afterId: 0 };
  const prepared = client.prepareWatch?.(connection, source, checkpoint);
  expect(prepared?.key).toBe(String(peer.id));
  expect(prepared?.source.watch.target).toBe(String(peer.id));
  expect(source.watch.target).toBe("@market_news");
  const targets: (string | number)[] = [];
  transport.getChat = async (target?: string | number) => { targets.push(target!); return peer; };
  const stop = await client.watch!(connection, prepared!.source, async () => {}, signal);
  expect(targets).toEqual([peer.id]);
  await stop();
  for (const targetId of ["@market_news", "9007199254740992", 77]) expect(() => client.prepareWatch?.(connection, source, { targetId })).toThrow(SourceFailure);
});

test("Telegram rejects malformed provider fields before secret resolution or SDK session creation", async () => {
  let secrets = 0, transports = 0;
  const client = createTelegramSourceClient({ sessionDirectory: "/unused", resolveSecret: async () => { secrets++; return "unused"; }, createTransport() { transports++; return new Transport(); } });
  try {
    for (const fields of [{ sessionName: true }, { apiIdRef: 7 }, { apiHashRef: null }]) await expect(client.probe({ ...connection, ...fields }, signal)).rejects.toMatchObject({ code: "configuration" });
    expect(secrets).toBe(0); expect(transports).toBe(0);
  } finally { await client.close(); }
});
