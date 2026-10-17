import type { InputDraft } from "../../contracts.js";
import { SourceFailure, type Connection, type SourceClient } from "../../sources/contracts.js";

type Options = { resolveSecret(name: string): Promise<string>; fetch?: typeof fetch };
function fail(): never { throw new SourceFailure("contract", "TradingView returned an invalid headline response"); }
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const text = (v: unknown, max: number): string => typeof v === "string" && v.trim() && v.length <= max ? v : fail();

/** Only allow the user's TradingView session cookies, never arbitrary request headers. */
function sessionCookie(value: string): string {
  try {
    const entries: Record<string, unknown> = value.trim().startsWith("{") ? JSON.parse(value) : Object.fromEntries(value.split(";").map(part => {
      const at = part.indexOf("="); return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    }));
    if (typeof entries.sessionid !== "string" || !entries.sessionid) throw new Error();
    return ["sessionid", "sessionid_sign"].filter(k => entries[k] !== undefined).map(k => {
      const v = entries[k]; if (typeof v !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(v) || /[;,]/.test(v)) throw new Error();
      return `${k}=${v}`;
    }).join("; ");
  } catch { throw new SourceFailure("configuration", "TradingView session must contain valid sessionid/sessionid_sign cookies"); }
}

/** Headline-only normalization. A link or permission marker is not a full article. */
export function normalizeTradingViewHeadline(value: unknown, target: string): InputDraft {
  const item = record(value);
  const id = text(item.id, 450), title = text(item.title, 1000);
  if (typeof item.published !== "number" || !Number.isFinite(item.published) || item.published < 0 || item.published > 253402300799) fail();
  const provider = typeof item.provider === "string" ? { id: item.provider, name: item.source ?? item.provider } : record(item.provider);
  const publisher = text(provider.id, 200), publisherName = text(provider.name ?? publisher, 500);
  let url: string | undefined;
  if (item.link !== undefined) {
    try {
      const parsed = new URL(text(item.link, 4000));
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) fail();
      url = parsed.href;
    } catch { fail(); }
  } else if (item.storyPath !== undefined) {
    const path = text(item.storyPath, 3900); if (!path.startsWith("/news/")) fail();
    url = new URL(path, "https://www.tradingview.com").href;
  }
  let symbols: string[] | undefined;
  if (item.relatedSymbols !== undefined) {
    if (!Array.isArray(item.relatedSymbols) || item.relatedSymbols.length > 100) fail();
    symbols = [...new Set(item.relatedSymbols.map(v => text(record(v).symbol, 200)))].sort();
  }
  return { sourceItemId: `tv:${id}`, kind: "article", title, text: title,
    publishedAt: new Date(item.published * 1000).toISOString(), ...(url ? { url } : {}),
    provenance: { provider: "tradingview", targetId: target, messageId: id, authorId: publisher, authorName: publisherName,
      contentKind: "headline", ...(symbols ? { relatedSymbols: symbols } : {}),
      ...(item.permission === undefined ? {} : { permission: text(item.permission, 100) }) } };
}

/** Two fixed provider transports behind the shared TG/X source interface; no new SDK. */
export function createTradingViewClient(options: Options): SourceClient {
  async function read(connection: Connection, target: string, external: AbortSignal): Promise<InputDraft[]> {
    if (!["tradingview-headlines", "tradingview-api"].includes(connection.adapter)) throw new SourceFailure("configuration", "Wrong TradingView connection type");
    if (!/^[A-Za-z0-9_-]+:[A-Za-z0-9_][A-Za-z0-9_.!/-]*$/.test(target)) throw new SourceFailure("configuration", "TradingView target must be EXCHANGE:TICKER");
    const hosted = connection.adapter === "tradingview-api";
    const url = new URL(hosted ? "https://api.tradingviewapi.com/api/news" : "https://news-headlines.tradingview.com/v2/view/headlines/symbol");
    url.search = new URLSearchParams({ symbol: target, lang: "en", ...(!hosted ? { client: "web", streaming: "false", limit: "200" } : {}) }).toString();
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "pi-turbo-portfolio-monitor" };
    if (typeof connection.secretRef === "string" && connection.secretRef) {
      const secret = await options.resolveSecret(connection.secretRef);
      if (hosted) {
        if (!secret || /[\r\n]/.test(secret)) throw new SourceFailure("configuration", "Invalid API credential");
        headers.authorization = `Bearer ${secret}`;
      } else headers.cookie = sessionCookie(secret);
    } else if (hosted) throw new SourceFailure("configuration", "API credential reference required");
    external.throwIfAborted();
    let response: Response;
    try { response = await (options.fetch ?? fetch)(url, { headers, redirect: "error", signal: AbortSignal.any([external, AbortSignal.timeout(20_000)]) }); }
    catch { external.throwIfAborted(); throw new SourceFailure("transport", "TradingView request failed"); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new SourceFailure("authentication", "TradingView authentication failed");
      if (response.status === 403) throw new SourceFailure("access", "TradingView denied access");
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        const ms = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : NaN;
        throw new SourceFailure("rate_limit", "TradingView rate limit", Number.isFinite(ms) ? Math.max(1000, Math.min(ms, 86_400_000)) : 60_000);
      }
      throw new SourceFailure(response.status >= 500 ? "transport" : "configuration", "TradingView rejected the request");
    }
    // Bound the body before parsing, including chunked responses without Content-Length.
    const reader = response.body?.getReader(); if (!reader) fail();
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 2_000_000) fail(); chunks.push(part.value); }
    } catch (error) { if (error instanceof SourceFailure) throw error; throw new SourceFailure("transport", "TradingView response interrupted"); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    external.throwIfAborted();
    let body: Record<string, unknown>;
    try { body = record(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { return fail(); }
    if (hosted) { if (body.success !== true) fail(); body = record(body.data); }
    if (!Array.isArray(body.items) || body.items.length > 1000) fail();
    return body.items.map(v => normalizeTradingViewHeadline(v, target));
  }
  return {
    async probe(connection, signal) {
      await read(connection, "CRYPTO:BTCUSD", signal);
      return { identity: connection.adapter, label: "Headline endpoint reachable; this is not an account identity check" };
    },
    async collect(connection, source, checkpoint, signal) {
      if (source.watch.mode === "push") throw new SourceFailure("configuration", "Webhook sources cannot be polled");
      const items = await read(connection, source.watch.target, signal);
      // Provider times have second precision; include the boundary second to avoid dropping new arrivals.
      const start = Math.floor(Date.parse(source.watch.startAt ?? source.createdAt) / 1000) * 1000;
      const previous = typeof checkpoint?.newest === "number" ? checkpoint.newest : start;
      if (!Number.isFinite(start) || !Number.isFinite(previous)) throw new SourceFailure("configuration", "Invalid source checkpoint");
      const dates = items.map(item => Date.parse(item.publishedAt!));
      // These transports provide a recent snapshot, not a documented catch-up cursor.
      // Re-read the overlap for corrections; ingress deduplicates unchanged content.
      const gap = checkpoint?.gap === true || (dates.length > 0 && Math.min(...dates) > previous);
      return { items: items.filter(item => Date.parse(item.publishedAt!) >= start).sort((a, b) => a.publishedAt!.localeCompare(b.publishedAt!)),
        checkpoint: { newest: Math.max(previous, ...dates), gap }, gap };
    },
    async close() {},
  };
}
