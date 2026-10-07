export interface NewsConfig {
  wallets: string[];
  feeds: string[];
  perpDexs: "all" | string[];
  includeSpot: boolean;
  stateFile: string;
  mode: "preview" | "telegram";
  telegramChatId?: string;
  contextArticles: number;
  retentionHours: number;
  excerptChars: number;
  positionMaxAgeSeconds: number;
  policy: string;
}
export interface Position {
  wallet: string; kind: "perp" | "spot"; dex: string; coin: string;
  size: string; side: "long" | "short"; entryPrice: string | null;
  positionValue: string | null; unrealizedPnl: string | null;
}
export interface Portfolio { fetchedAt: number; positions: Position[]; coverage: string[] }
export interface Article {
  id: string; source: string; sourceId: string; title: string; url: string;
  publishedAt: number | null; observedAt: number; excerpt: string; excerptTruncated: boolean;
}
export interface Alert {
  status: "pending" | "sent" | "unknown" | "rejected" | "preview";
  text: string; at: number; receipt?: string; error?: string;
  resolution?: { at: number; outcome: string; operator: true };
}
export interface NewsState {
  version: 1; scope: string; articles: Article[]; reviewed: Record<string, string>; alerts: Record<string, Alert>;
}
export interface Ports {
  portfolio(config: NewsConfig, signal: AbortSignal): Promise<Portfolio>;
  news(config: NewsConfig, signal: AbortSignal): Promise<Article[]>;
  article(article: Article, signal: AbortSignal): Promise<string>;
  telegram(text: string, config: NewsConfig, signal: AbortSignal): Promise<string>;
}
