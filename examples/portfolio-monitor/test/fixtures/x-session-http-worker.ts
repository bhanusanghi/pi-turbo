/** Offline HTTP boundary only. The stock Rettiwt client, anti-bot generator and production worker dispatch run unchanged. */
import { createRequire } from "node:module";
import type { AxiosStatic } from "axios";
import { runXSessionCall } from "../../src/providers/x/session-worker.js";
import { xFailure } from "../../src/providers/x/common.js";
import type { SessionCall } from "../../src/providers/x/session.js";
// Rettiwt loads Axios's CommonJS export; patch that exact worker-local transport, not the separate ESM export.
const axios = createRequire(import.meta.url)("axios") as AxiosStatic;
const { AxiosError, AxiosHeaders } = axios;

const user = { __typename: "User", rest_id: "77", core: { screen_name: "market", name: "Market", created_at: "2020-01-01T00:00:00Z" }, legacy: { description: "", pinned_tweet_ids_str: [] } };
const tweet = { __typename: "Tweet", rest_id: "103", edit_control: { edit_tweet_ids: ["100", "103"] }, core: { user_results: { result: user } },
  legacy: { conversation_id_str: "100", created_at: "Fri Oct 16 01:00:00 +0000 2026", full_text: "SDK HTTP fixture", lang: "en", entities: { hashtags: [], user_mentions: [], urls: [] } } };
const timeline = { data: { user: { result: { timeline_v2: { timeline: { instructions: [{ type: "TimelineAddEntries", entries: [{ content: { itemContent: { __typename: "TimelineTweet", tweet_results: { result: tweet } } } }] }] } } } } } };
const html = `<html><head><meta name="twitter-site-verification" content="${Buffer.alloc(32).toString("base64")}"><script>{1:"ondemand.s"})[e]||e)+"."+({1:"fixturehash"})</script></head><body>${[0, 1, 2, 3].map(i => `<svg id="loading-x-anim-${i}"><g><path d="M0 0"/><path d="M 0 0 0 0 1 2 3 4 5 6 7 8 9 10 11"/></g></svg>`).join("")}</body></html>`;

globalThis.onmessage = async (event: MessageEvent<SessionCall>) => {
  const diagnostics = { homeRequests: 0, scriptRequests: 0, apiRequests: 0, authenticated: false, cookieCorrect: false, csrfCorrect: false, transactionId: false, cursor: "" };
  // This worker's globals are isolated from other tests and application clients.
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (!String(url).startsWith("https://abs.twimg.com/responsive-web/client-web/ondemand.s.")) throw new Error("Unexpected SDK bootstrap request");
    diagnostics.scriptRequests++;
    return new Response("parseInt(a[0],16);parseInt(a[1],16)");
  }) as typeof fetch;
  axios.defaults.adapter = async config => {
    const url = String(config.url);
    if (url === "https://x.com/i/jf/") {
      diagnostics.homeRequests++;
      return { data: html, status: 200, statusText: "OK", headers: new AxiosHeaders(), config };
    }
    if (!url.startsWith("https://x.com/i/api/graphql/")) throw new Error("Unexpected SDK API request");
    diagnostics.apiRequests++;
    const headers = new AxiosHeaders(config.headers);
    diagnostics.cookieCorrect = String(headers.get("cookie")).includes("auth_token=fixture-not-real");
    diagnostics.csrfCorrect = headers.get("x-csrf-token") === "fixture-csrf";
    diagnostics.authenticated = diagnostics.cookieCorrect && diagnostics.csrfCorrect;
    diagnostics.transactionId = typeof headers.get("x-client-transaction-id") === "string";
    diagnostics.cursor = JSON.parse(config.params.variables).cursor ?? "";
    if (event.data.auth.headers["user-agent"] === "rate-limit-fixture") throw new AxiosError("provider detail must be hidden", "ERR_BAD_RESPONSE", config, undefined, {
      status: 429, statusText: "Too Many Requests", data: { errors: [{ code: 88, message: "sensitive provider body" }] }, headers: new AxiosHeaders({ "retry-after": "120" }), config,
    });
    let body: unknown = event.data.method === "identity" ? { data: { user: { result: user } } } : timeline;
    if (event.data.method === "timeline" && event.data.auth.headers["user-agent"] === "partial-error-fixture") body = { ...timeline, errors: [{ code: 89, message: "secret provider detail" }] };
    if (event.data.method === "timeline" && event.data.auth.headers["user-agent"] === "malformed-tweet-fixture") body = { data: { user: { result: { timeline_v2: { timeline: {
      instructions: [{ type: "TimelineAddEntries", entries: [{ content: { itemContent: { __typename: "TimelineTweet", tweet_results: { result: { __typename: "ChangedProviderTweet" } } } } }] }],
    } } } } } };
    return { data: body,
      status: 200, statusText: "OK", headers: new AxiosHeaders(), config };
  };
  try { globalThis.postMessage({ ok: true, result: await runXSessionCall(event.data), diagnostics }); }
  catch (error) { const failure = xFailure(error); globalThis.postMessage({ ok: false, error: { code: failure.code, retryAfterMs: failure.retryAfterMs }, diagnostics }); }
};
