import { Client, HttpClient } from "@xdevplatform/xdk";
import { SourceFailure, type Connection, type SourceClient } from "../../sources/contracts.js";
import { collectXPages, record, xConnection, xFailure, xId, xTarget, type XCredentials, type XFetch, type XIdentity, type XPage, type XPost } from "./common.js";

function bearer(secret: string): string {
  let value: unknown = secret.trim();
  if (secret.trim().startsWith("{")) {
    try { value = record(JSON.parse(secret)).bearerToken; }
    catch { throw new SourceFailure("configuration", "The X API credential JSON is invalid."); }
  }
  if (typeof value !== "string" || !value.trim() || /\s|[\r\n]/.test(value.trim())) throw new SourceFailure("configuration", "Supply an X developer bearer token, or JSON with bearerToken.");
  return value.trim();
}

function identity(response: unknown): XIdentity {
  const body = record(response);
  if (Array.isArray(body.errors) && body.errors.length) throw new SourceFailure("access", "The X account is unavailable to these credentials.");
  const user = record(body.data);
  return { id: xId(user.id), ...(typeof user.username === "string" ? { username: user.username } : {}) };
}

/** Accept SDK camelCase output and the documented legacy tweet aliases during API migration. */
export function parseXApiPage(response: unknown, user: XIdentity): XPage {
  const body = record(response), meta = record(body.meta);
  if (Array.isArray(body.errors) && body.errors.length) throw new SourceFailure("access", "X returned a partial or unavailable timeline. No checkpoint was advanced.");
  const count = meta.resultCount ?? meta.result_count;
  if (!Array.isArray(body.data) && !(body.data === undefined && count === 0)) throw new SourceFailure("contract", "X returned an unsupported timeline response.");
  const users = record(body.includes).users;
  const authorNames = new Map<string, string>();
  if (Array.isArray(users)) for (const entry of users) {
    const u = record(entry); if (typeof u.id === "string" && typeof u.username === "string") authorNames.set(u.id, u.username);
  }
  const posts: XPost[] = ((body.data ?? []) as unknown[]).map(entry => {
    const p = record(entry), note = record(p.notePost ?? p.note_post ?? p.noteTweet ?? p.note_tweet);
    const id = xId(p.id), authorId = xId(p.authorId ?? p.author_id ?? user.id);
    const text = note.text ?? p.text, createdAt = p.createdAt ?? p.created_at;
    if (typeof text !== "string" || typeof createdAt !== "string") throw new SourceFailure("contract", "X omitted required post content or publication time.");
    const refs = p.referencedPosts ?? p.referenced_posts ?? p.referencedTweets ?? p.referenced_tweets;
    if (refs !== undefined && !Array.isArray(refs)) throw new SourceFailure("contract", "X returned invalid post references.");
    const reference = (type: string) => (refs as unknown[] | undefined)?.map(record).find(r => r.type === type)?.id;
    const editIds = p.editHistoryPostIds ?? p.edit_history_post_ids ?? p.editHistoryTweetIds ?? p.edit_history_tweet_ids;
    if (editIds !== undefined && !Array.isArray(editIds)) throw new SourceFailure("contract", "X returned an invalid post edit history.");
    const reply = reference("replied_to"), quote = reference("quoted"), repost = reference("retweeted");
    const thread = p.conversationId ?? p.conversation_id;
    return { id, text, createdAt, authorId, authorName: authorNames.get(authorId) ?? user.username,
      ...(thread ? { conversationId: xId(thread) } : {}),
      ...(editIds ? { editIds: (editIds as unknown[]).map(xId) } : {}),
      ...(reply ? { replyTo: xId(reply) } : {}), ...(quote ? { quoted: xId(quote) } : {}), ...(repost ? { reposted: xId(repost) } : {}) };
  });
  const next = meta.nextToken ?? meta.next_token;
  if (next !== undefined && typeof next !== "string") throw new SourceFailure("contract", "X returned an invalid pagination token.");
  return { posts, ...(next ? { next: next as string } : {}) };
}

export function createXApiClient(options: XCredentials & { fetch?: XFetch; timeoutMs?: number }): SourceClient {
  const active = new Set<AbortController>();
  let closed = false;
  async function withClient<T>(connection: Connection, signal: AbortSignal, operation: (client: Client, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (closed) throw new SourceFailure("transport", "X API client is closed.");
    const configuration = xConnection(connection, "x-api");
    const cancellation = new AbortController(); active.add(cancellation);
    const bounded = AbortSignal.any([signal, cancellation.signal, AbortSignal.timeout(options.timeoutMs ?? 30_000)]);
    try {
      bounded.throwIfAborted();
      const token = bearer(await options.resolveSecret(configuration.secretRef));
      bounded.throwIfAborted();
      const client = new Client({ bearerToken: token, retry: false, maxRetries: 0, timeout: options.timeoutMs ?? 30_000 });
      if (options.fetch) {
        // The SDK exposes a per-client HTTP transport. Do not replace its shared singleton.
        const http = new HttpClient();
        http.request = async (url, init) => options.fetch!(url, init as RequestInit);
        Object.defineProperty(client, "httpClient", { value: http });
      }
      return await operation(client, bounded);
    } catch (error) { throw xFailure(error); }
    finally { active.delete(cancellation); }
  }
  async function resolve(client: Client, target: string, signal: AbortSignal): Promise<XIdentity> {
    const clean = xTarget(target);
    return identity(/^\d+$/.test(clean)
      ? await client.users.getById(clean, { requestOptions: { signal } })
      : await client.users.getByUsername(clean, { requestOptions: { signal } }));
  }
  return {
    probe: (connection, signal) => withClient(connection, signal, async (client, bounded) => {
      // App-only bearer tokens have no /me identity. An authenticated public lookup verifies entitlement.
      await resolve(client, "X", bounded);
      return { identity: "x-api", label: "X API public-account access verified" };
    }),
    collect: (connection, source, checkpoint, signal) => withClient(connection, signal, async (client, bounded) => {
      const user = checkpoint?.targetId
        ? { id: xId(checkpoint.targetId), username: typeof checkpoint.targetUsername === "string" ? checkpoint.targetUsername : undefined }
        : await resolve(client, source.watch.target, bounded);
      return collectXPages(source, checkpoint, user, async cursor => {
        const response = await client.users.getPosts(user.id, {
          maxResults: 100, ...(cursor ? { paginationToken: cursor } : {}),
          startTime: source.watch.startAt ?? source.createdAt,
          exclude: [...(source.watch.includeReplies === false ? ["replies" as const] : []), ...(source.watch.includeReposts === false ? ["retweets" as const] : [])],
          postFields: ["created_at", "conversation_id", "note_post"],
          expansions: ["author_id", "edit_history_post_ids", "referenced_posts"], userFields: ["username"],
          requestOptions: { signal: bounded },
        });
        return parseXApiPage(response, user);
      }, bounded);
    }),
    close: async () => { closed = true; for (const controller of active) controller.abort(); active.clear(); },
  };
}
