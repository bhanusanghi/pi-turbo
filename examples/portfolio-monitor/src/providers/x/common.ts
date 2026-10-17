import { createHash } from "node:crypto";
import type { InputDraft } from "../../contracts.js";
import { SourceFailure, type Connection, type SourceBatch, type SourceCheckpoint, type WatchedSource } from "../../sources/contracts.js";

export type XCredentials = { resolveSecret(name: string): Promise<string> };
export type XPost = {
  id: string; text: string; createdAt: string; authorId: string; authorName?: string;
  conversationId?: string; editIds?: string[]; replyTo?: string; quoted?: string; reposted?: string;
};
export type XPage = { posts: XPost[]; next?: string };
export type XIdentity = { id: string; username?: string; pinnedIds?: string[] };
export type XFetch = (url: string, init?: RequestInit) => Promise<Response>;

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export { record };
export function xId(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,30}$/.test(value)) throw new SourceFailure("contract", "X returned an invalid identifier.");
  return value;
}
export function xTarget(target: string): string {
  const clean = target.replace(/^@/, "");
  if (!/^(\d{1,30}|[A-Za-z0-9_]{1,15})$/.test(clean)) throw new SourceFailure("configuration", "Use an X account username or numeric account ID.");
  return clean;
}
export function xFailure(error: unknown): SourceFailure {
  if (error instanceof SourceFailure) return error;
  const e = record(error), response = record(e.response), data = record(e.data ?? response.data);
  const status = Number(e.status ?? response.status ?? 0);
  const details = Array.isArray(e.details) ? e.details : Array.isArray(data.errors) ? data.errors : [];
  const codes = details.map(d => Number(record(d).code));
  if (status === 401 || codes.some(c => [32, 89, 215, 239].includes(c))) return new SourceFailure("authentication", "X authentication expired or was rejected. Reconnect the account.");
  if (status === 429 || codes.includes(88)) {
    const headers = e.headers ?? response.headers;
    const get = (name: string) => headers instanceof Headers ? headers.get(name) : record(headers)[name];
    const retryRaw = get("retry-after"), retry = Number(retryRaw), reset = Number(get("x-rate-limit-reset"));
    const retryDate = typeof retryRaw === "string" ? Date.parse(retryRaw) : NaN;
    const delay = retry > 0 ? retry * 1000 : Number.isFinite(retryDate) ? retryDate - Date.now() : reset > 0 ? reset * 1000 - Date.now() : 60_000;
    return new SourceFailure("rate_limit", "X rate limit reached. Collection will retry after the provider's delay.", Math.max(delay, 1000));
  }
  if ([402, 403, 404].includes(status) || codes.some(c => [63, 64, 179, 200].includes(c))) return new SourceFailure("access", "X account, target, or API entitlement is unavailable.");
  if (status === 400 || codes.length) return new SourceFailure("contract", "X rejected the request or pagination cursor. Check source configuration.");
  if (error instanceof SyntaxError || error instanceof TypeError && status !== 0) return new SourceFailure("contract", "X returned an unsupported response.");
  return new SourceFailure("transport", "X request failed or was cancelled. No checkpoint was advanced.");
}

export function normalizeXPost(post: XPost, identity: XIdentity): InputDraft {
  const id = xId(post.id), authorId = xId(post.authorId);
  if (typeof post.text !== "string" || !Number.isFinite(Date.parse(post.createdAt))) throw new SourceFailure("contract", "X returned an invalid post.");
  const editIds = post.editIds?.map(xId);
  const canonicalId = editIds?.[0] ?? id;
  const relatesTo: NonNullable<InputDraft["relatesTo"]> = [];
  for (const [value, relation] of [[post.replyTo, "reply"], [post.quoted, "quote"], [post.reposted, "repost"]] as const) {
    if (value) relatesTo.push({ sourceItemId: `x:${xId(value)}`, relation });
  }
  const input: InputDraft = {
    sourceItemId: `x:${canonicalId}`, kind: "message",
    publishedAt: new Date(post.createdAt).toISOString(), text: post.text,
    url: `https://x.com/i/status/${id}`,
    ...(relatesTo.length ? { relatesTo } : {}),
    provenance: { provider: "x", targetId: identity.id, messageId: id, authorId,
      ...(post.authorName ? { authorName: post.authorName } : {}),
      ...(post.conversationId ? { threadId: xId(post.conversationId) } : {}) },
  };
  // A post ID alone is not an immutable revision of provider metadata (usernames/available references can change).
  input.sourceRevision = `${id}:${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
  return input;
}

/** Save the cursor and unfinished scan boundary together: a page budget never skips the remainder. */
export async function collectXPages(
  source: WatchedSource, saved: SourceCheckpoint | null, identity: XIdentity,
  readPage: (cursor: string | undefined) => Promise<XPage>, signal: AbortSignal,
): Promise<SourceBatch> {
  const startAt = source.watch.startAt ?? source.createdAt;
  if (!Number.isFinite(Date.parse(startAt))) throw new SourceFailure("configuration", "The X source start time is invalid.");
  if (saved?.targetId && saved.targetId !== identity.id) throw new SourceFailure("configuration", "The watched X account changed identity. Create a new source.");
  const string = (v: unknown) => typeof v === "string" ? v : undefined;
  let cursor = string(saved?.cursor), highWaterId = string(saved?.highWaterId);
  const boundary = string(saved?.scanBoundaryId) ?? highWaterId;
  let maximum = string(saved?.scanHighWaterId) ?? highWaterId;
  let oldPages = typeof saved?.oldPages === "number" ? saved.oldPages : 0;
  const items = new Map<string, InputDraft>();
  const visited = new Set<string>();
  const maxPages = Math.min(100, Math.max(1, source.watch.maxPages ?? 5));
  let complete = false;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    signal.throwIfAborted();
    const page = await readPage(cursor);
    signal.throwIfAborted();
    if (!Array.isArray(page.posts)) throw new SourceFailure("contract", "X returned an unsupported timeline.");
    const regular = page.posts.filter(p => !identity.pinnedIds?.includes(p.id));
    let allOld = regular.length > 0;
    let allBeforeStart = regular.length > 0;
    for (const post of page.posts) {
      const normalized = normalizeXPost(post, identity);
      if (!maximum || BigInt(post.id) > BigInt(maximum)) maximum = post.id;
      if (!identity.pinnedIds?.includes(post.id)) {
        if (!boundary || BigInt(post.id) > BigInt(boundary)) allOld = false;
        if (Date.parse(post.createdAt) >= Date.parse(startAt)) allBeforeStart = false;
      }
      if (Date.parse(post.createdAt) < Date.parse(startAt)) continue;
      if (source.watch.includeReplies === false && post.replyTo) continue;
      if (source.watch.includeReposts === false && post.reposted) continue;
      const previous = items.get(normalized.sourceItemId);
      if (!previous || BigInt(normalized.provenance!.messageId) > BigInt(previous.provenance!.messageId)) items.set(normalized.sourceItemId, normalized);
    }
    // Scan two complete old pages for bounded edit overlap. Never stop on the first pinned/reordered item.
    oldPages = allOld ? oldPages + 1 : 0;
    if (!page.next || allBeforeStart || oldPages >= 2) { complete = true; cursor = undefined; break; }
    if (page.next === cursor || visited.has(page.next)) throw new SourceFailure("contract", "X repeated a pagination cursor. No checkpoint was advanced.");
    visited.add(page.next); cursor = page.next;
  }
  if (complete) highWaterId = maximum;
  const checkpoint: SourceCheckpoint = { targetId: identity.id, targetUsername: identity.username ?? "", highWaterId: highWaterId ?? "0" };
  if (cursor) Object.assign(checkpoint, { cursor, scanBoundaryId: boundary ?? "0", scanHighWaterId: maximum ?? "0", oldPages });
  return { items: [...items.values()].sort((a, b) => BigInt(a.provenance!.messageId) < BigInt(b.provenance!.messageId) ? -1 : 1), checkpoint, gap: !complete };
}

/** Narrow provider-owned fields before resolving secrets, even outside management APIs. */
export function xConnection(connection: Connection, adapter: "x-api" | "x-session"): { secretRef: string } {
  if (connection.adapter !== adapter) throw new SourceFailure("configuration", `This connection is not an ${adapter} connection.`);
  const { secretRef } = connection;
  if (typeof secretRef !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(secretRef)) throw new SourceFailure("configuration", "The X credential reference is invalid.");
  return { secretRef };
}
