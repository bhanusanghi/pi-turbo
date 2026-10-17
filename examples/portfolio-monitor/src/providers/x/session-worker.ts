import { isMainThread } from "node:worker_threads";
import { Rettiwt, type Tweet } from "rettiwt-api";
import { SourceFailure } from "../../sources/contracts.js";
import { record, xFailure, xId, type XIdentity, type XPage, type XPost } from "./common.js";
import type { SessionCall, SessionResult } from "./session.js";

function timelineInstructions(raw: unknown): unknown[] {
  const result = record(record(record(raw).data).user).result;
  const user = record(result);
  if (user.__typename === "UserUnavailable" || user.__typename === "UserTombstone") throw new SourceFailure("access", "The X target is unavailable.");
  const timeline = record(record(user.timeline_v2 ?? user.timeline).timeline);
  if (!Array.isArray(timeline.instructions)) throw new SourceFailure("contract", "The X session response has no recognized timeline.");
  return timeline.instructions;
}
export function validateSessionTimeline(raw: unknown): void {
  const errors = record(raw).errors;
  if (errors !== undefined && !Array.isArray(errors)) throw new SourceFailure("contract", "X returned an invalid error envelope.");
  if (Array.isArray(errors) && errors.length) throw xFailure({ status: 200, data: { errors } });
  const instructions = timelineInstructions(raw);
  for (const instruction of instructions) {
    const entry = record(instruction);
    if (!["TimelineAddEntries", "TimelinePinEntry", "TimelineReplaceEntry", "TimelineTerminateTimeline", "TimelineClearCache", "TimelineShowAlert"].includes(String(entry.type))) throw new SourceFailure("contract", "The X session timeline uses an unsupported instruction.");
    if (entry.type === "TimelineAddEntries" && !Array.isArray(entry.entries)) throw new SourceFailure("contract", "The X session timeline entries are invalid.");
  }
  let remaining = 20_000;
  function inspect(value: unknown, depth: number) {
    if (--remaining < 0 || depth > 40) throw new SourceFailure("contract", "The X timeline response exceeded its structural limit.");
    if (Array.isArray(value)) { for (const child of value) inspect(child, depth + 1); return; }
    if (!value || typeof value !== "object") return;
    const item = record(value);
    if (item.__typename === "TimelineTweet") {
      let result = record(record(item.tweet_results).result);
      if (["TweetTombstone", "TweetUnavailable"].includes(String(result.__typename))) throw new SourceFailure("access", "X returned unavailable posts. Their content could not be retrieved.");
      if (result.__typename === "TweetWithVisibilityResults") result = record(result.tweet);
      const legacy = record(result.legacy), note = record(record(record(result.note_tweet).note_tweet_results).result);
      if (!result.rest_id || !result.core || typeof (note.text ?? legacy.full_text) !== "string" || typeof legacy.created_at !== "string" || !Number.isFinite(Date.parse(legacy.created_at))) {
        throw new SourceFailure("contract", "X returned a post payload the SDK cannot interpret. No checkpoint was advanced.");
      }
      xId(result.rest_id);
    }
    for (const child of Object.values(item)) inspect(child, depth + 1);
  }
  inspect(instructions, 0);
}

/** The SDK deserializes text/author/quotes; only stable content enters ingress. */
export function sessionTweet(tweet: Tweet): XPost {
  const raw = record(tweet.raw), edits = record(raw.edit_control).edit_tweet_ids;
  return { id: xId(tweet.id), text: tweet.fullText, createdAt: tweet.createdAt, authorId: xId(tweet.tweetBy.id), authorName: tweet.tweetBy.userName,
    ...(tweet.conversationId ? { conversationId: xId(tweet.conversationId) } : {}),
    ...(Array.isArray(edits) ? { editIds: edits.map(xId) } : {}),
    ...(tweet.replyTo ? { replyTo: xId(tweet.replyTo) } : {}), ...(tweet.quoted ? { quoted: xId(tweet.quoted.id) } : {}),
    ...(tweet.retweetedTweet ? { reposted: xId(tweet.retweetedTweet.id) } : {}) };
}

export async function runXSessionCall(request: SessionCall): Promise<SessionResult> {
  const sdk = new Rettiwt({ apiKey: request.auth.apiKey, headers: request.auth.headers, logging: false, timeout: 20_000, maxRetries: 0,
    errorHandler: { handle(error) { throw xFailure(error); } },
    responseMiddleware(response) {
      if (/\/UserTweets(?:AndReplies)?(?:\?|$)/.test(response.config.url ?? "")) validateSessionTimeline(response.data);
    },
  });
  if (request.method === "identity") {
    const user = await sdk.user.details(request.target ?? request.auth.userId);
    if (!user) throw new SourceFailure("access", "X did not return the requested account.");
    const identity: XIdentity = { id: xId(user.id), username: user.userName, pinnedIds: user.pinnedTweets?.map(xId) ?? [] };
    return { identity };
  }
  const result = request.includeReplies
    ? await sdk.user.replies(request.target, 20, request.cursor)
    : await sdk.user.timeline(request.target, 20, request.cursor);
  const page: XPage = { posts: result.list.map(sessionTweet), ...(result.next ? { next: result.next } : {}) };
  return { page };
}

if (!isMainThread) {
  globalThis.onmessage = async (event: MessageEvent<SessionCall>) => {
    try { globalThis.postMessage({ ok: true, result: await runXSessionCall(event.data) }); }
    catch (error) {
      const failure = xFailure(error);
      globalThis.postMessage({ ok: false, error: { code: failure.code, retryAfterMs: failure.retryAfterMs } });
    }
  };
}
