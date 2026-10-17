import { expect, test } from "bun:test";
import { createTradingViewClient, normalizeTradingViewHeadline } from "../src/providers/tradingview/client.js";
import { SourceFailure, type Connection, type WatchedSource } from "../src/sources/contracts.js";

const createdAt = "2026-10-16T00:00:00.000Z";
const start = Date.parse(createdAt);
const meta = { id: "tv-connection", revision: 1, createdAt, updatedAt: createdAt, label: "My TradingView", enabled: true };
const direct: Connection = { ...meta, adapter: "tradingview-headlines" };
const hosted: Connection = { ...meta, adapter: "tradingview-api", secretRef: "MY_NEWS_KEY" };
const source: WatchedSource = { id: "tv-source", revision: 1, createdAt, updatedAt: createdAt, name: "Bitcoin", kind: "adapter", enabled: true,
  watch: { connectionId: direct.id, target: "CRYPTO:BTCUSD", pollIntervalMs: 60_000 } };
const signal = new AbortController().signal;
const headline = (id: string, seconds = 60, extra: Record<string, unknown> = {}) => ({ id, title: `Synthetic headline ${id}`, published: start / 1000 + seconds,
  provider: "fixture", source: "Fixture Publisher", storyPath: `/news/fixture:${id}/`, ...extra });
function testClient(options: { resolveSecret(name: string): Promise<string>; fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response> }) {
  return createTradingViewClient({ ...options, fetch: options.fetch as typeof fetch });
}
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers });

test("direct and hosted headlines retain provenance without treating full text as available", () => {
  const raw = headline("one", 60, { permission: "headline", relatedSymbols: [{ symbol: "CRYPTO:BTCUSD" }, { symbol: "BINANCE:BTCUSDT" }, { symbol: "CRYPTO:BTCUSD" }], body: "Full article must not be inferred" });
  const item = normalizeTradingViewHeadline(raw, source.watch.target);
  expect(item).toMatchObject({ sourceItemId: "tv:one", kind: "article", title: "Synthetic headline one", text: "Synthetic headline one",
    publishedAt: "2026-10-16T00:01:00.000Z", url: "https://www.tradingview.com/news/fixture:one/",
    provenance: { provider: "tradingview", targetId: "CRYPTO:BTCUSD", messageId: "one", authorId: "fixture", authorName: "Fixture Publisher",
      contentKind: "headline", permission: "headline", relatedSymbols: ["BINANCE:BTCUSDT", "CRYPTO:BTCUSD"] } });
  expect(normalizeTradingViewHeadline(headline("two", 90, { provider: { id: "wire", name: "Synthetic Wire" }, link: "https://example.com/news/two" }), source.watch.target))
    .toMatchObject({ url: "https://example.com/news/two", provenance: { authorId: "wire", authorName: "Synthetic Wire" } });
});

test("normalization rejects malformed headlines and unsafe links", () => {
  for (const extra of [{ id: "" }, { title: "" }, { published: NaN }, { published: -1 }, { provider: {} }, { relatedSymbols: ["BTC"] },
    { permission: 4 }, { link: "javascript:alert(1)" }, { link: "https://user:pass@example.com/article" }, { storyPath: "https://example.com/news" }]) {
    expect(() => normalizeTradingViewHeadline(headline("bad", 60, extra), source.watch.target)).toThrow(SourceFailure);
  }
});

test("public headlines use the fixed origin without requiring a user secret", async () => {
  let calls = 0;
  const client = testClient({ resolveSecret: async () => { throw new Error("No secret should be requested"); }, fetch: async (input, init) => {
    calls++; const url = new URL(String(input));
    expect(url.origin).toBe("https://news-headlines.tradingview.com");
    expect(url.pathname).toBe("/v2/view/headlines/symbol");
    expect(url.searchParams.get("symbol")).toBe("CRYPTO:BTCUSD");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    return json({ sections: [], items: [headline("one")] });
  } });
  expect((await client.collect(direct, source, null, signal)).items).toHaveLength(1);
  expect(calls).toBe(1); await client.close();
});

test("user-owned session references send only allowed TradingView cookies", async () => {
  for (const secret of ['sessionid=fixture-session; sessionid_sign=fixture-sign; unrelated=must-not-send',
    JSON.stringify({ sessionid: "fixture-session", sessionid_sign: "fixture-sign", authorization: "must-not-send" })]) {
    const refs: string[] = [];
    const client = testClient({ resolveSecret: async name => { refs.push(name); return secret; }, fetch: async (_url, init) => {
      expect(new Headers(init?.headers).get("cookie")).toBe("sessionid=fixture-session; sessionid_sign=fixture-sign");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return json({ items: [] });
    } });
    await client.probe({ ...direct, secretRef: "MY_TV_SESSION" }, signal);
    expect(refs).toEqual(["MY_TV_SESSION"]); await client.close();
  }
});

test("invalid imported sessions fail before contacting the provider", async () => {
  for (const secret of ["unrelated=secret", "sessionid=a\r\nb", '{"sessionid":"secret;injected=x"}', '{"sessionid":"x","sessionid_sign":42}']) {
    let calls = 0;
    const client = testClient({ resolveSecret: async () => secret, fetch: async () => { calls++; return json({ items: [] }); } });
    await expect(client.probe({ ...direct, secretRef: "MY_TV_SESSION" }, signal)).rejects.toMatchObject({ code: "configuration" });
    expect(calls).toBe(0); await client.close();
  }
});

test("independent hosted API resolves the user's key and unwraps its response", async () => {
  const refs: string[] = [];
  const client = testClient({ resolveSecret: async name => { refs.push(name); return "fixture-key"; }, fetch: async (input, init) => {
    const url = new URL(String(input)); expect(url.origin).toBe("https://api.tradingviewapi.com"); expect(url.pathname).toBe("/api/news");
    expect(url.searchParams.get("symbol")).toBe(source.watch.target); expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-key"); expect(new Headers(init?.headers).has("cookie")).toBe(false);
    return json({ success: true, data: { items: [headline("hosted", 90, { provider: { id: "fixture", name: "Fixture" } })] } });
  } });
  expect((await client.collect(hosted, source, null, signal)).items[0]?.sourceItemId).toBe("tv:hosted");
  expect(refs).toEqual(["MY_NEWS_KEY"]); await client.close();
});

test("wrong adapter, invalid target and missing or injected hosted credentials fail locally", async () => {
  let calls = 0;
  const client = testClient({ resolveSecret: async () => "bad\r\ncredential", fetch: async () => { calls++; return json({ items: [] }); } });
  await expect(client.probe({ ...meta, adapter: "x-api", secretRef: "X" }, signal)).rejects.toMatchObject({ code: "configuration" });
  await expect(client.collect(direct, { ...source, watch: { ...source.watch, target: "https://evil.example/" } }, null, signal)).rejects.toMatchObject({ code: "configuration" });
  await expect(client.probe({ ...hosted, secretRef: "" }, signal)).rejects.toMatchObject({ code: "configuration" });
  await expect(client.probe(hosted, signal)).rejects.toMatchObject({ code: "configuration" });
  expect(calls).toBe(0); await client.close();
});

test("provider errors use bounded safe categories without exposing response secrets", async () => {
  for (const [status, code] of [[401, "authentication"], [403, "access"], [400, "configuration"], [503, "transport"]] as const) {
    const client = testClient({ resolveSecret: async () => "fixture", fetch: async () => json({ message: "PRIVATE_PROVIDER_DETAIL" }, status) });
    try { await client.probe(direct, signal); throw new Error("Expected rejection"); }
    catch (error) { expect(error).toBeInstanceOf(SourceFailure); expect(error).toMatchObject({ code }); expect(String(error)).not.toContain("PRIVATE_PROVIDER_DETAIL"); }
    await client.close();
  }
});

test("429 retry delays honor seconds and clamp invalid or extreme values", async () => {
  for (const [retry, expected] of [["120", 120_000], ["0", 1000], ["999999999", 86_400_000], ["nonsense", 60_000]] as const) {
    const client = testClient({ resolveSecret: async () => "", fetch: async () => json({}, 429, { "retry-after": retry }) });
    await expect(client.probe(direct, signal)).rejects.toMatchObject({ code: "rate_limit", retryAfterMs: expected }); await client.close();
  }
  const date = new Date(Date.now() + 120_000).toUTCString();
  const client = testClient({ resolveSecret: async () => "", fetch: async () => json({}, 429, { "retry-after": date }) });
  try { await client.probe(direct, signal); throw new Error("Expected rejection"); }
  catch (error) { expect(error).toBeInstanceOf(SourceFailure); expect((error as SourceFailure).retryAfterMs).toBeGreaterThan(117_000); expect((error as SourceFailure).retryAfterMs).toBeLessThanOrEqual(120_000); }
  await client.close();
});

test("malformed, partial hosted, too many and oversized bodies cannot be accepted as empty feeds", async () => {
  const responses = [() => new Response("not json"), () => json({}), () => json({ items: [headline("bad", 60, { published: "today" })] }),
    () => json({ items: Array.from({ length: 1001 }, (_, n) => headline(String(n))) }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_000_001)); controller.enqueue(new Uint8Array(1_000_001)); controller.close(); } }))];
  for (const response of responses) {
    const client = testClient({ resolveSecret: async () => "", fetch: async () => response() });
    await expect(client.probe(direct, signal)).rejects.toMatchObject({ code: "contract" }); await client.close();
  }
  for (const body of [{ success: false, data: { items: [] } }, { success: true }, { success: true, data: { items: null } }]) {
    const client = testClient({ resolveSecret: async () => "fixture", fetch: async () => json(body) });
    await expect(client.probe(hosted, signal)).rejects.toMatchObject({ code: "contract" }); await client.close();
  }
});

test("overlapping snapshots return corrections with stable identity and preserve source start time", async () => {
  let round = 0;
  const client = testClient({ resolveSecret: async () => "", fetch: async () => json({ items: ++round === 1
    ? [headline("later", 120), headline("before", -60), headline("one", 60)]
    : [headline("later", 120), headline("one", 60, { title: "Corrected synthetic headline" }), headline("new", 180)] }) });
  const first = await client.collect(direct, source, null, signal);
  expect(first.items.map(item => item.sourceItemId)).toEqual(["tv:one", "tv:later"]);
  expect(first.gap).toBe(false); expect(first.checkpoint.newest).toBe(start + 120_000);
  const second = await client.collect(direct, source, first.checkpoint, signal);
  expect(second.items.map(item => item.sourceItemId)).toEqual(["tv:one", "tv:later", "tv:new"]);
  expect(second.items[0]?.text).toBe("Corrected synthetic headline"); expect(second.items[0]?.sourceRevision).toBeUndefined();
  expect(second.checkpoint.newest).toBe(start + 180_000); expect(second.gap).toBe(false); await client.close();
});

test("explicit startAt filters history and missing overlap latches a possible gap", async () => {
  const client = testClient({ resolveSecret: async () => "", fetch: async () => json({ items: [headline("one", 60), headline("two", 120)] }) });
  const later = { ...source, watch: { ...source.watch, startAt: new Date(start + 90_000).toISOString() } };
  expect((await client.collect(direct, later, null, signal)).items.map(item => item.sourceItemId)).toEqual(["tv:two"]);
  const missing = await client.collect(direct, source, { newest: start + 1, gap: false }, signal);
  expect(missing.gap).toBe(true); expect(missing.checkpoint.gap).toBe(true);
  expect((await client.collect(direct, source, { newest: start + 120_000, gap: true }, signal)).gap).toBe(true);
  await expect(client.collect(direct, source, { newest: NaN }, signal)).rejects.toMatchObject({ code: "configuration" });
  await expect(client.collect(direct, { ...source, watch: { ...source.watch, mode: "push" } }, null, signal)).rejects.toMatchObject({ code: "configuration" });
  await client.close();
});

test("empty snapshots preserve checkpoint and probe makes no account identity claim", async () => {
  const client = testClient({ resolveSecret: async () => "", fetch: async () => json({ items: [] }) });
  expect(await client.collect(direct, source, { newest: start + 120_000, gap: false }, signal)).toEqual({ items: [], checkpoint: { newest: start + 120_000, gap: false }, gap: false });
  expect(await client.probe(direct, signal)).toMatchObject({ identity: "tradingview-headlines", label: expect.stringContaining("not an account identity check") }); await client.close();
});

test("transport exceptions are sanitized and request cancellation propagates", async () => {
  const failed = testClient({ resolveSecret: async () => "", fetch: async () => { throw new Error("SECRET transport detail"); } });
  await expect(failed.probe(direct, signal)).rejects.toMatchObject({ code: "transport", message: "TradingView request failed" }); await failed.close();
  let calls = 0;
  const pre = new AbortController(); pre.abort();
  const preClient = testClient({ resolveSecret: async () => "", fetch: async () => { calls++; return json({ items: [] }); } });
  await expect(preClient.probe(direct, pre.signal)).rejects.toMatchObject({ name: "AbortError" }); expect(calls).toBe(0); await preClient.close();
  const controller = new AbortController(); let observed: AbortSignal | undefined; let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const client = testClient({ resolveSecret: async () => "", fetch: (_url, init) => new Promise((_resolve, reject) => {
    observed = init?.signal as AbortSignal; observed.addEventListener("abort", () => reject(new Error("SECRET")), { once: true }); ready();
  }) });
  const pending = client.probe(direct, controller.signal); await started; controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(observed?.aborted).toBe(true); await client.close();
});


test("second-precision publication times include the source boundary second", async () => {
  const client = testClient({ resolveSecret: async () => "", fetch: async () => json({ items: [headline("before", -1), headline("boundary", 0)] }) });
  const boundary = new Date(start + 500).toISOString();
  for (const watched of [{ ...source, createdAt: boundary }, { ...source, watch: { ...source.watch, startAt: boundary } }]) {
    expect((await client.collect(direct, watched, null, signal)).items.map(item => item.sourceItemId)).toEqual(["tv:boundary"]);
  }
  await client.close();
});
