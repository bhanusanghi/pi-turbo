import { createHash } from "node:crypto";
import Parser from "rss-parser";
import type { Article, NewsConfig, Portfolio, Ports, Position } from "./types.js";
export const hash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 24);
export function publicUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost"
    || /^\d+\./.test(url.hostname) || url.hostname.includes(":")) throw new Error("Use a public HTTPS URL without credentials");
  return url.href;
}
async function fetchText(url: string, init: RequestInit, signal: AbortSignal, maxBytes = 2_000_000): Promise<string> {
  const response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body?.getReader(); if (!reader) throw new Error("Empty response body");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break;
      bytes += item.value.length; if (bytes > maxBytes) throw new Error("Source response exceeds the author's byte limit"); chunks.push(item.value); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
const info = async (body: unknown, signal: AbortSignal): Promise<any> => JSON.parse(await fetchText("https://api.hyperliquid.xyz/info",
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, signal));
const decimal = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`Invalid ${label}`);
  return value;
};
export async function readPortfolio(config: NewsConfig, signal: AbortSignal): Promise<Portfolio> {
  const fetchedAt = Date.now();
  let dexs: string[];
  if (config.perpDexs === "all") {
    const list = await info({ type: "perpDexs" }, signal);
    if (!Array.isArray(list)) throw new Error("Invalid perpetual DEX response");
    dexs = [...new Set(["", ...list.filter(Boolean).map(d => {
      if (typeof d.name !== "string") throw new Error("Invalid DEX name"); return d.name as string;
    })])];
  } else dexs = config.perpDexs;
  const positions: Position[] = []; const coverage: string[] = [];
  // Sequential requests keep polling pressure bounded; any partial failure rejects the snapshot.
  for (const wallet of config.wallets) {
    for (const dex of dexs) {
      const state = await info({ type: "clearinghouseState", user: wallet, dex }, signal);
      if (!Array.isArray(state.assetPositions)) throw new Error("Invalid perpetual positions response");
      coverage.push(`${wallet}:perp:${dex || "native"}`);
      for (const row of state.assetPositions) {
        const p = row.position; const size = decimal(p.szi, "position size");
        if (Number(size) === 0) continue;
        if (typeof p.coin !== "string") throw new Error("Missing coin");
        positions.push({ wallet, kind: "perp", dex, coin: p.coin, size, side: Number(size) < 0 ? "short" : "long",
          entryPrice: p.entryPx == null ? null : decimal(p.entryPx, "entry price"),
          positionValue: decimal(p.positionValue, "position value"), unrealizedPnl: decimal(p.unrealizedPnl, "unrealized PnL") });
      }
    }
    if (config.includeSpot) {
      const state = await info({ type: "spotClearinghouseState", user: wallet }, signal);
      if (!Array.isArray(state.balances)) throw new Error("Invalid spot balances response");
      coverage.push(`${wallet}:spot`);
      for (const p of state.balances) {
        const size = decimal(p.total, "spot total"); if (Number(size) === 0) continue;
        if (typeof p.coin !== "string") throw new Error("Missing spot coin");
        positions.push({ wallet, kind: "spot", dex: "", coin: p.coin, size, side: Number(size) < 0 ? "short" : "long", entryPrice: null, positionValue: null, unrealizedPnl: null });
      }
    }
  }
  return { fetchedAt, positions, coverage };
}
export const plain = (html: string) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
export async function readNews(config: NewsConfig, signal: AbortSignal): Promise<Article[]> {
  const articles: Article[] = []; const parser = new Parser();
  for (const source of config.feeds) {
    const feed = await parser.parseString(await fetchText(publicUrl(source), {}, signal));
    for (const item of feed.items) {
      if (!item.title || !item.link) continue;
      const url = publicUrl(item.link); const title = plain(item.title);
      const body = plain(item.contentSnippet ?? item.content ?? item.summary ?? "");
      const sourceId = item.guid ?? url;
      const date = Date.parse(item.isoDate ?? item.pubDate ?? "");
      articles.push({ id: hash([source, sourceId, url, title, body, Number.isFinite(date) ? date : null]), source, sourceId, title, url,
        publishedAt: Number.isFinite(date) ? date : null, observedAt: Date.now(),
        excerpt: body.slice(0, config.excerptChars), excerptTruncated: body.length > config.excerptChars });
    }
  }
  return articles;
}
export class DeliveryRejected extends Error {}
export const ports: Ports = {
  portfolio: readPortfolio, news: readNews,
  article: async (article, signal) => {
    const text = plain(await fetchText(publicUrl(article.url), {}, signal, 1_000_000));
    return JSON.stringify({ url: article.url, text: text.slice(0, 20_000), truncated: text.length > 20_000 });
  },
  async telegram(text, config, signal) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !config.telegramChatId) throw new DeliveryRejected("Set TELEGRAM_BOT_TOKEN and telegramChatId before Telegram mode");
    // Never place the credential-bearing URL in an error or transcript.
    let response: Response;
    try { response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.telegramChatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: "error",
    }); } catch { throw new Error("Telegram transport failed; delivery is unknown"); }
    let body: any;
    try { body = await response.json(); } catch { throw new Error("Telegram response unreadable; delivery is unknown"); }
    if (body.ok === false) throw new DeliveryRejected(`Telegram rejected the request (HTTP ${response.status})`);
    if (!response.ok || body.ok !== true || !Number.isSafeInteger(body.result?.message_id)) throw new Error("No valid Telegram receipt; delivery is unknown");
    return String(body.result.message_id);
  },
};
