import type { JsonRepresentation } from "@earendil-works/chord";
import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable";
import { hash } from "./adapters.js";
import type { NewsState, Portfolio } from "./types.js";

export const exposureRevision = (portfolio: Portfolio) => hash(portfolio.positions.map(p =>
  [p.wallet, p.kind, p.dex, p.coin, p.size, p.entryPrice]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
export const reviewKey = (revision: string, articleId: string, policy: string) => hash([revision, articleId, policy]);

/** Application documents, independent of Turbo. The effect ledger never rewinds with a conversation. */
export const News = defineDocFamily<JsonRepresentation<NewsState>, { scope: string }>({
  kind: "hyperliquid-news.state", version: 1, scope: "session", family: true,
  initial: seed => ({ version: 1, scope: seed.scope, articles: [], reviewed: {}, alerts: {} }),
});
export type CycleState = { portfolio?: Portfolio; revision?: string; newsReady?: boolean; issue?: string };
export const Cycle = defineDoc<JsonRepresentation<CycleState>>({ kind: "hyperliquid-news.cycle", version: 1,
  scope: "conversation", history: "latest", fork: "initial", initial: () => ({}) });
