import { chmod, mkdir, open, readFile, readdir, rm, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { TelegramClient, networkMiddlewares } from "@mtcute/bun";
import type { InputDraft } from "../../contracts.js";
import { SourceFailure, type Connection, type SourceBatch, type SourceCheckpoint, type SourceClient, type SourceProbe, type WatchedSource } from "../../sources/contracts.js";

import { telegramConnection, telegramTarget } from "./config.js";

export type TelegramPeer = { id: number; type: string; chatType?: string; isBot?: boolean; displayName: string; username?: string | null };
export type TelegramMessage = {
  id: number; date: Date; text: string; chat: TelegramPeer; sender?: TelegramPeer;
  editDate?: Date | null; isService?: boolean;
  replyToMessage?: { id: number | null; chat: TelegramPeer | null; threadId: number | null } | null;
  forward?: { sender: TelegramPeer | { type: "anonymous"; displayName: string } } | null;
};
type Events<T> = { add(listener: (value: T) => void): void; remove(listener: (value: T) => void): void };
/** The SDK-shaped boundary permits deterministic transport tests without Telegram credentials. */
export interface TelegramTransport {
  getMe(): Promise<TelegramPeer>;
  getChat(target: string | number): Promise<TelegramPeer>;
  getHistory(target: number, options: { limit: number; offset?: { id: number; date: number } }): Promise<readonly TelegramMessage[]>;
  iterDialogs(options: { limit: number }): AsyncIterable<{ peer: TelegramPeer }>;
  onNewMessage: Events<TelegramMessage>;
  onEditMessage: Events<TelegramMessage>;
  onDeleteMessage: Events<{ channelId: number | null; messageIds: number[] }>;
  start(options: { phone: () => Promise<string>; code: () => Promise<string>; password: () => Promise<string>; codeSentCallback: () => void; abortSignal?: AbortSignal }): Promise<TelegramPeer>;
  logOut(): Promise<unknown>;
  destroy(): Promise<void>;
}
export type TelegramOptions = {
  resolveSecret(name: string): Promise<string>;
  sessionDirectory: string;
  createTransport?: (options: { apiId: number; apiHash: string; storage: string }) => TelegramTransport | Promise<TelegramTransport>;
  onWatchFailure?: (sourceId: string, error: SourceFailure) => void;
};
export type TelegramLoginOptions = TelegramOptions & {
  apiIdRef: string; apiHashRef: string; sessionName: string;
  phone(): Promise<string>; code(): Promise<string>; password(): Promise<string>;
  signal?: AbortSignal;
};

function failure(error: unknown): SourceFailure {
  if (error instanceof SourceFailure) return error;
  const e = error as { errorMessage?: unknown; message?: unknown; text?: unknown; seconds?: unknown; name?: unknown } | null;
  const message = typeof e?.errorMessage === "string" ? e.errorMessage : typeof e?.message === "string" ? e.message : "";
  const wait = /(?:FLOOD_WAIT|FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT)_(\d+)/.exec(message);
  if (wait) return new SourceFailure("rate_limit", "Telegram requested a pause before another request.", Number(wait[1]) * 1000);
  if (typeof e?.text === "string" && /FLOOD_WAIT|SLOWMODE_WAIT/.test(e.text) && typeof e.seconds === "number" && Number.isFinite(e.seconds) && e.seconds > 0) return new SourceFailure("rate_limit", "Telegram requested a pause before another request.", e.seconds * 1000);
  if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|SESSION_PASSWORD|PHONE_CODE|PHONE_NUMBER|API_ID_INVALID|PASSWORD_HASH|USER_DEACTIVATED|UNAUTHORIZED/.test(message)) return new SourceFailure("authentication", "Telegram authorization is unavailable. Reconnect this account locally.");
  if (/CHANNEL_PRIVATE|CHANNEL_INVALID|CHAT_ADMIN_REQUIRED|USER_BANNED|PEER_ID_INVALID|USERNAME_(?:INVALID|NOT_OCCUPIED)/.test(message)) return new SourceFailure("access", "The Telegram account cannot access this target.");
  return new SourceFailure("transport", "Telegram collection failed. Check the connection and retry.");
}
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new SourceFailure("transport", "Telegram operation was cancelled."); }
async function cancellable<T>(operation: () => Promise<T>, signal?: AbortSignal, cancel?: () => Promise<void>): Promise<T> {
  abort(signal);
  if (!signal) return operation();
  let listener: () => void = () => {};
  try {
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => reject(new SourceFailure("transport", "Telegram operation was cancelled."));
      signal.addEventListener("abort", listener, { once: true });
    });
    return await Promise.race([Promise.resolve().then(() => { abort(signal); return operation(); }), cancelled]);
  } catch (error) {
    // A Promise.race alone does not cancel MTProto requests. Teardown terminates the
    // underlying sockets and invalidates the shared session before another caller reuses it.
    if (signal.aborted) await cancel?.();
    throw error;
  } finally { signal.removeEventListener("abort", listener); }
}
function assertPeer(peer: TelegramPeer): void {
  if (!peer || !Number.isSafeInteger(peer.id) || typeof peer.type !== "string" || typeof peer.displayName !== "string") throw new SourceFailure("contract", "Telegram returned an invalid peer.");
}
function itemId(chat: number | string, message: number): string { return `${chat}:${message}`; }
function normalize(message: TelegramMessage, targetId: number): InputDraft | null {
  assertPeer(message.chat);
  if (message.chat.id !== targetId || !Number.isSafeInteger(message.id) || message.id < 1 || typeof message.text !== "string" || !(message.date instanceof Date) || !Number.isFinite(message.date.getTime()) || (message.editDate != null && (!(message.editDate instanceof Date) || !Number.isFinite(message.editDate.getTime())))) throw new SourceFailure("contract", "Telegram returned an invalid message.");
  if (message.isService || !message.text.trim()) return null;
  const publishedAt = message.date.toISOString();
  const editedAt = message.editDate?.toISOString();
  const reply = message.replyToMessage;
  const forwarded = message.forward?.sender;
  const id = itemId(targetId, message.id);
  let url: string | undefined;
  if (message.chat.username) url = `https://t.me/${message.chat.username}/${message.id}`;
  else if (["channel", "supergroup"].includes(message.chat.chatType ?? message.chat.type) && String(targetId).startsWith("-100")) url = `https://t.me/c/${String(targetId).slice(4)}/${message.id}`;
  const input: InputDraft = {
    sourceItemId: id, kind: "message", text: message.text, publishedAt,
    ...(url ? { url } : {}),
    ...(reply?.id != null ? { relatesTo: [{ sourceItemId: itemId(reply.chat?.id ?? targetId, reply.id), relation: "reply" as const }] } : {}),
    provenance: { provider: "telegram", targetId: String(targetId), messageId: String(message.id),
      ...(message.sender ? { authorId: String(message.sender.id), authorName: message.sender.displayName } : {}),
      ...(reply?.threadId != null ? { threadId: String(reply.threadId) } : {}),
      ...(forwarded ? { forwardedFrom: "id" in forwarded ? String(forwarded.id) : forwarded.displayName } : {}),
      ...(editedAt ? { editedAt } : {}) },
  };
  // Telegram edit dates have one-second granularity. Hash all admitted content so same-second
  // edits and changing peer metadata cannot reuse a provider revision with a different body.
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
  return { ...input, sourceRevision: `${editedAt ?? publishedAt}:${hash}` };
}

type Session = { client: TelegramTransport; release(): Promise<void> };
async function session(options: TelegramOptions & { apiIdRef: string; apiHashRef: string; sessionName: string }): Promise<Session> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(options.sessionName)) throw new SourceFailure("configuration", "Telegram session name must contain only letters, digits, underscores or hyphens.");
  let apiId: number, apiHash: string;
  try { apiId = Number(await options.resolveSecret(options.apiIdRef)); apiHash = (await options.resolveSecret(options.apiHashRef)).trim(); }
  catch { throw new SourceFailure("configuration", "Telegram API credentials are unavailable."); }
  if (!Number.isSafeInteger(apiId) || apiId <= 0 || !/^[a-fA-F0-9]{32}$/.test(apiHash)) throw new SourceFailure("configuration", "Telegram API credentials are invalid.");
  const base = resolve(options.sessionDirectory);
  const directory = join(base, options.sessionName);
  await mkdir(base, { recursive: true, mode: 0o700 });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(base)).isSymbolicLink() || (await lstat(directory)).isSymbolicLink()) throw new SourceFailure("configuration", "Telegram session directories must not be symbolic links.");
  await chmod(base, 0o700); await chmod(directory, 0o700);
  const lock = join(directory, "owner.lock");
  try {
    try { const owner = Number(await readFile(lock, "utf8")); if (Number.isSafeInteger(owner) && owner > 0) { try { process.kill(owner, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") await rm(lock); } } } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const handle = await open(lock, "wx", 0o600);
    await handle.writeFile(String(process.pid)); await handle.close();
  } catch { throw new SourceFailure("configuration", "This Telegram session is already owned by another client. Stop it before reconnecting."); }
  let released = false;
  const secure = async () => { for (const file of await readdir(directory)) if (file.startsWith("session.sqlite")) { const path = join(directory, file); if ((await lstat(path)).isSymbolicLink()) throw new SourceFailure("configuration", "Telegram session files must not be symbolic links."); await chmod(path, 0o600); } };
  const unlock = async () => { if (!released) { released = true; await secure(); await rm(lock, { force: true }); } };
  try {
    const storage = join(directory, "session.sqlite");
    await secure();
    const client = options.createTransport
      ? await options.createTransport({ apiId, apiHash, storage })
      : new TelegramClient({ apiId, apiHash, storage, logLevel: 0, network: { middlewares: networkMiddlewares.basic({ floodWaiter: { maxWait: 0, onBeforeWait: () => {} } }) } });
    await secure();
    let releasing: Promise<void> | undefined;
    return { client, release: () => releasing ??= (async () => { try { await client.destroy(); } finally { await unlock(); } })() };
  } catch (error) { await unlock(); throw failure(error); }
}

/** Interactive setup only. Runtime clients call getMe(), never start()/request login codes. */
export async function loginTelegram(options: TelegramLoginOptions): Promise<SourceProbe> {
  let current: Session | undefined;
  try {
    abort(options.signal); current = await session(options);
    const active = current;
    const user = await cancellable(() => active.client.start({ phone: options.phone, code: options.code, password: options.password, codeSentCallback: () => {}, ...(options.signal ? { abortSignal: options.signal } : {}) }), options.signal, () => active.release());
    assertPeer(user);
    if (user.type === "bot" || user.isBot) throw new SourceFailure("authentication", "Telegram inputs require a personal account session.");
    return { identity: String(user.id), label: user.displayName };
  } catch (error) { throw failure(error); } finally { await current?.release(); }
}
export async function logoutTelegram(options: TelegramOptions & { apiIdRef: string; apiHashRef: string; sessionName: string }): Promise<void> {
  let current: Session | undefined;
  try { current = await session(options); await current.client.logOut(); }
  catch (error) { throw failure(error); } finally { await current?.release(); }
}

type Checkpoint = { version: 1; targetId: string; afterId: number; scanHead?: number; offsetId?: number };
function checkpointValue(value: SourceCheckpoint | null, targetId: number): Checkpoint {
  if (!value) return { version: 1, targetId: String(targetId), afterId: 0 };
  const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
  if (value.version !== 1 || value.targetId !== String(targetId) || !integer(value.afterId) || (value.scanHead !== undefined && !integer(value.scanHead)) || (value.offsetId !== undefined && !integer(value.offsetId)) || ((value.scanHead === undefined) !== (value.offsetId === undefined))) throw new SourceFailure("contract", "Telegram checkpoint is invalid for this source.");
  return value as Checkpoint;
}

export function createTelegramSourceClient(options: TelegramOptions): SourceClient {
  type Entry = { connectionId: string; revision: number; ready: Promise<Session> };
  const sessions = new Map<string, Entry>();
  const leases = new WeakMap<TelegramTransport, { key: string; entry: Entry; session: Session }>();
  const operations = new Map<string, Promise<unknown>>();
  const stops = new Set<() => Promise<void>>();
  const watchFailures = new WeakMap<TelegramTransport, Set<(error: SourceFailure) => void>>();
  let closed = false;
  async function invalidate(client: TelegramTransport): Promise<void> {
    const lease = leases.get(client);
    if (!lease) return;
    if (sessions.get(lease.key) === lease.entry) sessions.delete(lease.key);
    for (const notify of watchFailures.get(client) ?? []) notify(new SourceFailure("transport", "Telegram session was interrupted. Reconnect its live sources."));
    const releasing = lease.session.release();
    // New operations wait for SQLite and the process lock to be released before reconnecting.
    const previous = operations.get(lease.key) ?? Promise.resolve();
    operations.set(lease.key, previous.catch(() => {}).then(() => releasing));
    await releasing;
  }
  function request<T>(client: TelegramTransport, operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return cancellable(operation, signal, () => invalidate(client));
  }
  async function use(connection: Connection, signal: AbortSignal): Promise<TelegramTransport> {
    abort(signal);
    if (closed) throw new SourceFailure("transport", "Telegram source client is closed.");
    const configuration = telegramConnection(connection);
    if (!connection.enabled) throw new SourceFailure("configuration", "Telegram connection is disabled.");
    const key = configuration.sessionName;
    const previous = operations.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      let entry = sessions.get(key);
      if (entry && entry.connectionId !== connection.id) throw new SourceFailure("configuration", "A Telegram session cannot be shared by separate connection profiles.");
      if (entry && entry.revision !== connection.revision) { await (await entry.ready).release(); sessions.delete(key); entry = undefined; }
      if (!entry) {
        entry = { connectionId: connection.id, revision: connection.revision, ready: session({ ...options, ...configuration }) };
        sessions.set(key, entry);
        entry.ready.catch(() => { if (sessions.get(key) === entry) sessions.delete(key); });
      }
      const current = await entry.ready;
      leases.set(current.client, { key, entry, session: current });
      abort(signal); return current.client;
    });
    operations.set(key, operation);
    try { return await operation; } catch (error) { throw failure(error); }
  }
  async function authorized(connection: Connection, signal: AbortSignal): Promise<TelegramTransport> {
    const client = await use(connection, signal);
    const user = await request(client, () => client.getMe(), signal); assertPeer(user);
    if (user.type === "bot" || user.isBot) throw new SourceFailure("authentication", "Telegram inputs require a personal account session.");
    return client;
  }
  async function peerFor(client: TelegramTransport, source: WatchedSource, signal: AbortSignal): Promise<TelegramPeer> {
    const peer = await request(client, () => client.getChat(telegramTarget(source.watch.target)), signal); assertPeer(peer);
    if (!["group", "supergroup", "channel"].includes(peer.chatType ?? peer.type)) throw new SourceFailure("access", "Telegram source targets must be accessible groups or channels.");
    return peer;
  }
  return {
    prepareWatch(connection, source, checkpoint) {
      telegramConnection(connection);
      if (!checkpoint?.targetId) return null;
      if (typeof checkpoint.targetId !== "string" || !/^-?\d+$/.test(checkpoint.targetId) || !Number.isSafeInteger(Number(checkpoint.targetId))) throw new SourceFailure("contract", "Telegram checkpoint target ID is invalid.");
      return { source: { ...source, watch: { ...source.watch, target: checkpoint.targetId } }, key: checkpoint.targetId };
    },
    async probe(connection, signal) {
      try {
        const client = await use(connection, signal); const user = await request(client, () => client.getMe(), signal); assertPeer(user);
        if (user.type === "bot" || user.isBot) throw new SourceFailure("authentication", "Telegram inputs require a personal account session.");
        return { identity: String(user.id), label: user.displayName };
      }
      catch (error) { throw failure(error); }
    },
    async discover(connection, signal, limit = 100) {
      try {
        const client = await authorized(connection, signal); const targets = [];
        const maximum = Math.max(1, Math.min(1000, Math.floor(limit)));
        const iterator = client.iterDialogs({ limit: maximum })[Symbol.asyncIterator]();
        try { while (targets.length < maximum) { const result = await request(client, () => iterator.next(), signal); if (result.done) break; const peer = result.value.peer; assertPeer(peer); if (["group", "supergroup", "channel"].includes(peer.chatType ?? peer.type)) targets.push({ id: String(peer.id), label: peer.displayName, ...(peer.username ? { username: peer.username } : {}) }); } }
        finally {
          // Async generator return() queues behind an outstanding next(). After cancellation
          // teardown owns network cleanup; waiting here would defeat the discovery deadline.
          if (signal.aborted) void iterator.return?.().catch(() => {});
          else await iterator.return?.();
        }
        return targets;
      } catch (error) { throw failure(error); }
    },
    async collect(connection, source, saved, signal): Promise<SourceBatch> {
      try {
        const client = await authorized(connection, signal); const peer = await peerFor(client, source, signal);
        const state = checkpointValue(saved, peer.id);
        const startAt = Date.parse(source.watch.startAt ?? source.createdAt);
        if (!Number.isFinite(startAt)) throw new SourceFailure("configuration", "Telegram source start time is invalid.");
        const maxPages = Math.max(1, Math.min(100, source.watch.maxPages ?? 5));
        const items: InputDraft[] = [];
        let offsetId = state.offsetId ?? 0, headId = state.scanHead ?? state.afterId, done = false;
        for (let page = 0; page < maxPages; page++) {
          abort(signal);
          const messages = await request(client, () => client.getHistory(peer.id, { limit: 100, ...(offsetId ? { offset: { id: offsetId, date: 0 } } : {}) }), signal);
          if (!Array.isArray(messages) || messages.length > 100) throw new SourceFailure("contract", "Telegram returned an invalid history page.");
          if (!messages.length) { done = true; break; }
          let previousId = offsetId || Infinity;
          for (const message of messages) {
            const item = normalize(message, peer.id);
            if (message.id >= previousId) throw new SourceFailure("contract", "Telegram history pagination did not advance.");
            previousId = message.id;
            headId = Math.max(headId, message.id);
            if (message.date.getTime() >= startAt && item && (source.watch.includeReplies !== false || !message.replyToMessage) && (source.watch.includeReposts !== false || !message.forward)) items.push(item);
            if (message.id <= state.afterId || message.date.getTime() < startAt) done = true;
          }
          const last = messages.at(-1)!; offsetId = last.id;
          // mtcute filters Telegram messageEmpty records; a short page does not prove exhaustion.
          // Continue until an empty page or the previously committed/time boundary is reached.
          if (done) break;
        }
        abort(signal);
        // Advance the high-water only after the entire interval has been collected.
        const checkpoint: SourceCheckpoint = done
          ? { version: 1, targetId: String(peer.id), afterId: headId }
          : { version: 1, targetId: String(peer.id), afterId: state.afterId, scanHead: headId, offsetId };
        return { items: items.reverse(), checkpoint, gap: !done };
      } catch (error) { throw failure(error); }
    },
    async watch(connection, source, publish, signal, onFailure) {
      try {
        const client = await authorized(connection, signal); const peer = await peerFor(client, source, signal);
        let active = true; let chain = Promise.resolve();
        const startAt = Date.parse(source.watch.startAt ?? source.createdAt);
        const report = (error: unknown) => {
          const safe = failure(error);
          try { options.onWatchFailure?.(source.id, safe); } catch { /* Diagnostics must not escape SDK event handlers. */ }
          try { onFailure?.(safe); } catch { /* Host failure handlers are isolated from SDK dispatch. */ }
        };
        const enqueue = (input: InputDraft) => { chain = chain.then(async () => { if (active && !signal.aborted) await publish(input); }).catch(report); };
        const message = (value: TelegramMessage) => {
          if (!active || signal.aborted || value.chat.id !== peer.id || value.date.getTime() < startAt) return;
          try { const input = normalize(value, peer.id); if (input && (source.watch.includeReplies !== false || !value.replyToMessage) && (source.watch.includeReposts !== false || !value.forward)) enqueue(input); } catch (error) { report(error); }
        };
        const deletion = (value: { channelId: number | null; messageIds: number[] }) => {
          // Non-channel deletions have no peer ID; never guess which group's message was deleted.
          if (value.channelId !== peer.id) return;
          for (const id of value.messageIds) if (Number.isSafeInteger(id) && id > 0) enqueue({ sourceItemId: itemId(peer.id, id), sourceRevision: "deleted", kind: "message", text: "", publishedAt: null, deleted: true, provenance: { provider: "telegram", targetId: String(peer.id), messageId: String(id) } });
        };
        const stop = async () => { if (!active) return; active = false; client.onNewMessage.remove(message); client.onEditMessage.remove(message); client.onDeleteMessage.remove(deletion); signal.removeEventListener("abort", onAbort); stops.delete(stop); watchFailures.get(client)?.delete(interrupted); await chain; };
        const interrupted = (error: SourceFailure) => { report(error); void stop(); };
        const onAbort = () => { void stop(); };
        client.onNewMessage.add(message); client.onEditMessage.add(message); client.onDeleteMessage.add(deletion); stops.add(stop);
        let handlers = watchFailures.get(client); if (!handlers) { handlers = new Set(); watchFailures.set(client, handlers); } handlers.add(interrupted);
        signal.addEventListener("abort", onAbort, { once: true }); if (signal.aborted) await stop();
        return stop;
      } catch (error) { throw failure(error); }
    },
    async close() {
      closed = true;
      await Promise.all([...stops].map(stop => stop()));
      await Promise.all([...operations.values()].map(operation => operation.catch(() => {})));
      await Promise.all([...sessions.values()].map(async entry => { try { await (await entry.ready).release(); } catch { /* Already reported at the operation boundary. */ } }));
      sessions.clear(); operations.clear();
    },
  };
}
