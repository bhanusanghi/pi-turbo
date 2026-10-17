import { expect, test } from "bun:test";
import { BaseType, CursoredData, Rettiwt, UserRequests, type IRawTweet } from "rettiwt-api";
import { createXApiClient } from "../src/providers/x/api.js";
import { createXSessionClient, parseXSessionAuth, type SessionCall } from "../src/providers/x/session.js";
import { sessionTweet, validateSessionTimeline } from "../src/providers/x/session-worker.js";
import { normalizeXPost, xFailure, type XFetch, type XPost } from "../src/providers/x/common.js";
import { SourceFailure, type Connection, type SourceCheckpoint, type WatchedSource } from "../src/sources/contracts.js";

const meta = { id: "connection", revision: 1, createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z", label: "X", enabled: true };
const api: Connection = { ...meta, adapter: "x-api", secretRef: "X_TOKEN" };
const session: Connection = { ...meta, adapter: "x-session", secretRef: "X_COOKIE" };
const source: WatchedSource = { id: "source", revision: 1, createdAt: meta.createdAt, updatedAt: meta.updatedAt, name: "Account", enabled: true, kind: "adapter", watch: { connectionId: meta.id, target: "@market", pollIntervalMs: 60_000, maxPages: 1 } };
const signal = new AbortController().signal;
const cookie = 'auth_token=fixture-not-real; ct0=fixture-csrf; twid="u=77";';
const post = (id: string, extra: Partial<XPost> = {}): XPost => ({ id, authorId: "77", authorName: "market", createdAt: "2026-10-16T01:00:00Z", text: `Post ${id}`, ...extra });
function json(body: unknown, status = 200, headers: HeadersInit = {}): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }); }

test("official SDK sends bearer auth, field/expansion requests and resumes a bounded scan", async () => {
  const requests: URL[] = [];
  const transport: XFetch = async (url, init) => {
    const u = new URL(url); requests.push(u);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer official-fixture");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (u.pathname.endsWith("/by/username/market")) return json({ data: { id: "77", username: "market" } });
    expect(u.pathname).toBe("/2/users/77/tweets");
    expect(u.searchParams.get("max_results")).toBe("100");
    expect(u.searchParams.get("post.fields")).toContain("created_at");
    expect(u.searchParams.get("expansions")).toContain("edit_history_post_ids");
    if (!u.searchParams.has("pagination_token")) return json({ data: [{ id: "103", text: "Updated", author_id: "77", created_at: "2026-10-16T01:00:00Z", edit_history_post_ids: ["100", "103"], referenced_posts: [{ type: "quoted", id: "90" }] }], includes: { users: [{ id: "77", username: "market" }] }, meta: { result_count: 1, next_token: "page2" } });
    expect(u.searchParams.get("pagination_token")).toBe("page2");
    return json({ data: [{ id: "102", text: "Earlier", created_at: "2026-10-16T00:30:00Z" }], meta: { result_count: 1 } });
  };
  const client = createXApiClient({ resolveSecret: async () => "official-fixture", fetch: transport });
  const first = await client.collect(api, source, null, signal);
  expect(first.gap).toBe(true); expect(first.checkpoint.cursor).toBe("page2");
  expect(first.checkpoint.highWaterId).toBe("0");
  expect(first.items[0]).toMatchObject({ sourceItemId: "x:100", sourceRevision: expect.stringMatching(/^103:[a-f0-9]{24}$/), text: "Updated", relatesTo: [{ sourceItemId: "x:90", relation: "quote" }] });
  const second = await client.collect(api, source, first.checkpoint, signal);
  expect(second.gap).toBe(false); expect(second.checkpoint.highWaterId).toBe("103");
  expect(second.items[0]?.sourceItemId).toBe("x:102");
  expect(requests).toHaveLength(3); await client.close();
});

test("official probe performs a request and rejects missing entitlement or expired credentials", async () => {
  for (const [status, code] of [[401, "authentication"], [403, "access"], [402, "access"]] as const) {
    let calls = 0;
    const client = createXApiClient({ resolveSecret: async () => "token", fetch: async () => { calls++; return json({ detail: "provider secret must not escape" }, status); } });
    await expect(client.probe(api, signal)).rejects.toMatchObject({ code });
    expect(calls).toBe(1); await client.close();
  }
  const client = createXApiClient({ resolveSecret: async () => '{"bearerToken":"token"}', fetch: async () => json({ data: { id: "1", username: "X" } }) });
  expect(await client.probe(api, signal)).toMatchObject({ identity: "x-api" }); await client.close();
});

test("official 429 preserves retry delay while sanitizing provider details", async () => {
  const client = createXApiClient({ resolveSecret: async () => "token", fetch: async () => json({ detail: "SECRET" }, 429, { "retry-after": "120" }) });
  await expect(client.probe(api, signal)).rejects.toMatchObject({ code: "rate_limit", retryAfterMs: 120_000 });
  await client.close();
});

test("empty official timeline is distinct from malformed and partial responses", async () => {
  for (const [body, allowed] of [[{ meta: { result_count: 0 } }, true], [{}, false], [{ data: [], errors: [{ detail: "partial" }], meta: { result_count: 0 } }, false]] as const) {
    const client = createXApiClient({ resolveSecret: async () => "token", fetch: async () => json(body) });
    const checkpoint: SourceCheckpoint = { targetId: "77", targetUsername: "market" };
    if (allowed) expect((await client.collect(api, source, checkpoint, signal)).items).toEqual([]);
    else await expect(client.collect(api, source, checkpoint, signal)).rejects.toBeInstanceOf(SourceFailure);
    await client.close();
  }
});

test("official transport receives cancellation and close aborts pending work", async () => {
  let observed: AbortSignal | undefined;
  const client = createXApiClient({ resolveSecret: async () => "token", fetch: (_url, init) => new Promise((_resolve, reject) => {
    observed = init?.signal as AbortSignal; observed.addEventListener("abort", () => reject(new Error("credential-leaking SDK exception")), { once: true });
  }) });
  const pending = client.probe(api, signal);
  while (!observed) await new Promise(resolve => setTimeout(resolve, 1));
  await client.close();
  await expect(pending).rejects.toMatchObject({ code: "transport", message: "X request failed or was cancelled. No checkpoint was advanced." });
  expect(observed.aborted).toBe(true);
});

test("cookie imports accept headers, structured fields, browser exports and explicit encoded keys only", () => {
  const variants = [cookie, JSON.stringify({ auth_token: "fixture-not-real", ct0: "fixture-csrf", twid: "u%3D77" }),
    JSON.stringify([{ name: "auth_token", value: "fixture-not-real" }, { name: "ct0", value: "fixture-csrf" }, { name: "twid", value: "u%3D77" }]),
    JSON.stringify({ encodedApiKey: Buffer.from(cookie).toString("base64") }), JSON.stringify({ headers: { Cookie: cookie, "User-Agent": "fixture-agent", Authorization: "ignored" } })];
  for (const value of variants) {
    const parsed = parseXSessionAuth(value);
    expect(parsed.userId).toBe("77");
    expect(new Rettiwt({ apiKey: parsed.apiKey }).apiKey).toBe(parsed.apiKey);
    expect(Buffer.from(parsed.apiKey, "base64").toString()).toContain('twid="u=77"');
    expect(parsed.headers).not.toHaveProperty("Authorization");
  }
  for (const value of ["guest_token=guest", "auth_token=secret; ct0=csrf", Buffer.from(cookie).toString("base64"), "auth_token=a; auth_token=b; ct0=c; twid=u%3D77", "auth_token=x\r\ny"]) expect(() => parseXSessionAuth(value)).toThrow(SourceFailure);
});

function rawTweet(id: string, overrides: Record<string, unknown> = {}): IRawTweet {
  return { __typename: "Tweet", rest_id: id, edit_control: { edit_tweet_ids: [id] }, core: { user_results: { result: {
    __typename: "User", rest_id: "77", core: { screen_name: "market", name: "Market", created_at: "2020-01-01T00:00:00Z" },
    legacy: { description: "", pinned_tweet_ids_str: ["1"] },
  } } }, legacy: { conversation_id_str: id, created_at: "Fri Oct 16 01:00:00 +0000 2026", full_text: `Post ${id}`, lang: "en", entities: { hashtags: [], user_mentions: [], urls: [] }, ...overrides }, ...overrides } as unknown as IRawTweet;
}
function rawTimeline(tweets: IRawTweet[], cursor?: string): Record<string, unknown> {
  return { data: { user: { result: { timeline_v2: { timeline: { instructions: [{ type: "TimelineAddEntries", entries: [
    ...tweets.map(t => ({ content: { itemContent: { __typename: "TimelineTweet", tweet_results: { result: t } } } })),
    ...(cursor ? [{ content: { cursorType: "Bottom", value: cursor } }] : []),
  ] }] } } } } } };
}

test("stock Rettiwt request factories and deserializers preserve stable content and edit metadata", () => {
  const raw = rawTimeline([rawTweet("103", { edit_control: { edit_tweet_ids: ["100", "103"] }, note_tweet: { note_tweet_results: { result: { text: "Long original content" } } } })], "cursor-2");
  validateSessionTimeline(raw);
  const parsed = new CursoredData(raw, BaseType.TWEET);
  expect(parsed.next).toBe("cursor-2");
  const normalized = normalizeXPost(sessionTweet(parsed.list[0] as import("rettiwt-api").Tweet), { id: "77" });
  expect(normalized).toMatchObject({ sourceItemId: "x:100", sourceRevision: expect.stringMatching(/^103:[a-f0-9]{24}$/), text: "Long original content", provenance: { authorId: "77" } });
  const request = UserRequests.tweetsAndReplies("77", 20, parsed.next);
  expect(request.url).toContain("/UserTweetsAndReplies");
  expect(JSON.parse(request.params.variables)).toMatchObject({ userId: "77", count: 20, cursor: "cursor-2" });
  expect(() => validateSessionTimeline({ data: {} })).toThrow(SourceFailure);
  expect(() => validateSessionTimeline(rawTimeline([]))).not.toThrow();
});

test("session pagination survives pinned and reordered old posts and resumes before advancing high water", async () => {
  const calls: SessionCall[] = [];
  const client = createXSessionClient({ resolveSecret: async () => cookie, sessionCall: async request => {
    calls.push(request);
    if (request.method === "identity") return { identity: { id: "77", username: "market", pinnedIds: ["1"] } };
    if (!request.cursor) return { page: { posts: [post("1", { createdAt: "2020-01-01T00:00:00Z" }), post("105"), post("99"), post("104")], next: "p2" } };
    expect(request.cursor).toBe("p2"); return { page: { posts: [post("103")], next: undefined } };
  } });
  const first = await client.collect(session, source, { targetId: "77", targetUsername: "market", highWaterId: "100", pinnedIds: ["1"] }, signal);
  expect(first.items.map(p => p.provenance?.messageId)).toEqual(["99", "104", "105"]);
  expect(first.checkpoint.highWaterId).toBe("100"); expect(first.gap).toBe(true);
  const second = await client.collect(session, source, first.checkpoint, signal);
  expect(second.items.map(p => p.provenance?.messageId)).toEqual(["103"]);
  expect(second.checkpoint.highWaterId).toBe("105"); expect(second.gap).toBe(false);
  expect(calls).toHaveLength(2); await client.close();
});

test("session probe validates response identity and filters reply/repost settings", async () => {
  const client = createXSessionClient({ resolveSecret: async () => cookie, sessionCall: async request => request.method === "identity"
    ? { identity: { id: "77", username: "market" } }
    : { page: { posts: [post("105"), post("104", { replyTo: "10" }), post("103", { reposted: "20" })] } } });
  expect(await client.probe(session, signal)).toMatchObject({ identity: "77" });
  const batch = await client.collect(session, { ...source, watch: { ...source.watch, includeReplies: false, includeReposts: false } }, null, signal);
  expect(batch.items.map(p => p.provenance?.messageId)).toEqual(["105"]); await client.close();
  const wrong = createXSessionClient({ resolveSecret: async () => cookie, sessionCall: async () => ({ identity: { id: "999" } }) });
  await expect(wrong.probe(session, signal)).rejects.toMatchObject({ code: "authentication" }); await wrong.close();
});

test("engagement changes never create new normalized content", () => {
  const before = rawTimeline([rawTweet("100", { favorite_count: 1 })]);
  const after = rawTimeline([rawTweet("100", { favorite_count: 900 })]);
  const normalize = (raw: Record<string, unknown>) => normalizeXPost(sessionTweet(new CursoredData(raw, BaseType.TWEET).list[0] as import("rettiwt-api").Tweet), { id: "77" });
  expect(normalize(before)).toEqual(normalize(after));
});

test("actual Bun worker imports the SDK, returns only sanitized failures and terminates", async () => {
  const worker = new Worker(new URL("../src/providers/x/session-worker.ts", import.meta.url));
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker import failed")), 5000);
      worker.addEventListener("message", event => { clearTimeout(timer); resolve(event.data); }, { once: true });
      worker.addEventListener("error", () => { clearTimeout(timer); reject(new Error("worker failed")); }, { once: true });
      // Invalid input fails before any network call; it exercises worker import/dispatch and exception redaction.
      worker.postMessage({ method: "identity", auth: null, providerSecret: "SHOULD_NOT_ESCAPE" });
    });
    expect(result).toEqual({ ok: false, error: { code: "transport", retryAfterMs: undefined } });
    expect(JSON.stringify(result)).not.toContain("SHOULD_NOT_ESCAPE");
  } finally { worker.terminate(); }
});

test("stock Rettiwt runs homepage bootstrap, real transaction generation and authenticated HTTP through the production client", async () => {
  const diagnostics: { homeRequests: number; scriptRequests: number; apiRequests: number; authenticated: boolean; transactionId: boolean }[] = [];
  const client = createXSessionClient({ resolveSecret: async () => cookie, workerFactory() {
    const worker = new Worker(new URL("./fixtures/x-session-http-worker.ts", import.meta.url));
    worker.addEventListener("message", event => diagnostics.push(event.data.diagnostics));
    return worker;
  } });
  const identity = await client.probe(session, signal);
  expect(identity.identity).toBe("77");
  const batch = await client.collect(session, source, null, signal);
  expect(batch.items[0]).toMatchObject({ sourceItemId: "x:100", sourceRevision: expect.stringMatching(/^103:[a-f0-9]{24}$/), text: "SDK HTTP fixture" });
  expect(diagnostics).toHaveLength(3);
  for (const entry of diagnostics) expect(entry).toMatchObject({ homeRequests: 1, scriptRequests: 1, apiRequests: 1, authenticated: true, transactionId: true });
  await client.close();
});

test("stock Rettiwt preserves HTTP rate-limit headers through the worker error boundary", async () => {
  const client = createXSessionClient({ resolveSecret: async () => JSON.stringify({ cookie, headers: { "user-agent": "rate-limit-fixture" } }),
    workerFactory: () => new Worker(new URL("./fixtures/x-session-http-worker.ts", import.meta.url)) });
  await expect(client.probe(session, signal)).rejects.toMatchObject({ code: "rate_limit", retryAfterMs: 120_000 });
  await client.close();
});

test("stock SDK partial-data errors and skipped unrecognized tweets cannot complete or advance a scan", async () => {
  for (const [agent, code] of [["partial-error-fixture", "authentication"], ["malformed-tweet-fixture", "contract"]] as const) {
    const client = createXSessionClient({ resolveSecret: async () => JSON.stringify({ cookie, headers: { "user-agent": agent } }),
      workerFactory: () => new Worker(new URL("./fixtures/x-session-http-worker.ts", import.meta.url)) });
    const saved = { targetId: "77", targetUsername: "market", highWaterId: "50" };
    await expect(client.collect(session, source, saved, signal)).rejects.toMatchObject({ code });
    expect(saved).toEqual({ targetId: "77", targetUsername: "market", highWaterId: "50" });
    await client.close();
  }
});

test("session deadline and cancellation terminate the real worker before underlying work can continue", async () => {
  for (const cancel of [false, true]) {
    const control = new AbortController(); let terminated = false;
    const client = createXSessionClient({ resolveSecret: async () => cookie, timeoutMs: 20, workerFactory(url) {
      const worker = new Worker(url);
      return { addEventListener: worker.addEventListener.bind(worker), removeEventListener: worker.removeEventListener.bind(worker),
        // An unresponsive transport does not respond to the request. The real worker must still be terminated.
        postMessage() { if (cancel) queueMicrotask(() => control.abort()); }, terminate() { terminated = true; worker.terminate(); } };
    } });
    await expect(client.probe(session, control.signal)).rejects.toMatchObject({ code: "transport" });
    expect(terminated).toBe(true); await client.close();
  }
});

test("provider exception strings and raw credentials are never included in failures", () => {
  for (const error of [new Error(cookie), { status: 401, message: cookie }, { response: { status: 429, data: { errors: [{ code: 88, message: cookie }] }, headers: { "retry-after": "5" } } }]) {
    const failure = xFailure(error); expect(failure.message).not.toContain("fixture-not-real");
    expect(failure).toBeInstanceOf(SourceFailure);
  }
});

test("mutable author identity produces a distinct content revision without changing canonical post identity", () => {
  const first = normalizeXPost(post("103", { authorName: "old_name", editIds: ["100", "103"] }), { id: "77" });
  const second = normalizeXPost(post("103", { authorName: "new_name", editIds: ["100", "103"] }), { id: "77" });
  expect(first.sourceItemId).toBe(second.sourceItemId);
  expect(first.sourceRevision).not.toBe(second.sourceRevision);
  expect(first.provenance?.messageId).toBe(second.provenance?.messageId);
});

test("provider retry-after dates and long delays are never shortened to a daily cap", () => {
  expect(xFailure({ status: 429, headers: new Headers({ "retry-after": "172800" }) }).retryAfterMs).toBe(172_800_000);
  const date = new Date(Date.now() + 172_800_000).toUTCString();
  expect(xFailure({ status: 429, headers: new Headers({ "retry-after": date }) }).retryAfterMs).toBeGreaterThan(172_798_000);
});

test("partial GraphQL data errors and unknown tweet entries fail instead of accepting an empty timeline", () => {
  const valid = rawTimeline([]);
  expect(() => validateSessionTimeline({ ...valid, errors: [{ code: 89, message: "expired" }] })).toThrow(SourceFailure);
  try { validateSessionTimeline({ ...valid, errors: [{ code: 89, message: "expired" }] }); } catch (error) { expect(error).toMatchObject({ code: "authentication" }); }
  const invalid = rawTimeline([{ __typename: "UnknownTweet", rest_id: "103" } as IRawTweet]);
  expect(() => validateSessionTimeline(invalid)).toThrow(SourceFailure);
});

test("X clients reject malformed credential references before resolving secrets or calling SDKs", async () => {
  let secrets = 0, calls = 0;
  const official = createXApiClient({ resolveSecret: async () => { secrets++; return "unused"; }, fetch: async () => { calls++; return json({}); } });
  const personal = createXSessionClient({ resolveSecret: async () => { secrets++; return cookie; }, sessionCall: async () => { calls++; return { identity: { id: "77" } }; } });
  try {
    for (const secretRef of [true, 123, null, "bad-ref"]) {
      await expect(official.probe({ ...api, secretRef }, signal)).rejects.toMatchObject({ code: "configuration" });
      await expect(personal.probe({ ...session, secretRef }, signal)).rejects.toMatchObject({ code: "configuration" });
    }
    expect(secrets).toBe(0); expect(calls).toBe(0);
  } finally { await official.close(); await personal.close(); }
});
