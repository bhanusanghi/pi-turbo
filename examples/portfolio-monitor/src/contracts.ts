/** Application contracts. No model context, questions, turns or evaluation policy. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Network = "mainnet" | "testnet";
export type ResourceMeta = { id: string; revision: number; createdAt: string; updatedAt: string };
import type { ConnectionDraft, SourceWatch } from "./sources/contracts.js";
export type SourceDraft = { name: string; kind: "manual" | "adapter"; enabled: boolean; watch?: SourceWatch };
export type AccountDraft = { label: string; address: string; network: Network; perpDexs: "all" | string[]; enabled: boolean };
export type PortfolioDraft = { name: string; accountIds: string[]; enabled: boolean };
export type MonitorDraft = { name: string; portfolioId: string; sourceIds: string[]; destinationIds: string[]; enabled: boolean };
export type DestinationDraft = { label: string; enabled: boolean } & (
  { adapter: "preview" } | { adapter: "telegram"; chatId: string; secretRef: string }
);
export interface ResourceDrafts { connections: ConnectionDraft; sources: SourceDraft; accounts: AccountDraft; portfolios: PortfolioDraft; monitors: MonitorDraft; destinations: DestinationDraft }
export type ResourceKind = keyof ResourceDrafts;
export type Resource<K extends ResourceKind> = ResourceDrafts[K] & ResourceMeta;
export type Account = Resource<"accounts">;
export type Portfolio = Resource<"portfolios">;
export type Destination = Resource<"destinations">;
export type Page<T> = { items: T[]; nextCursor: string | null };
export type ListOptions = { limit?: number; cursor?: string };

export type InputDraft = {
  sourceItemId: string; kind: "article" | "message"; sourceRevision?: string;
  publishedAt: string | null; text: string; title?: string; url?: string;
  relatesTo?: { sourceItemId: string; relation: "reply" | "correction" | "quote" | "repost" }[];
  deleted?: boolean;
  provenance?: { provider: string; targetId: string; messageId: string; authorId?: string; authorName?: string; threadId?: string; forwardedFrom?: string; editedAt?: string; contentKind?: "headline" | "alert"; permission?: string; relatedSymbols?: string[] };
};
export type InputRevision = InputDraft & {
  id: string; inputId: string; sourceId: string; sequence: string; contentHash: string;
  receivedAt: string; chronology: "provider_revision" | "unspecified";
};
export type InputRecord = { id: string; sourceId: string; sourceItemId: string; revisions: InputRevision[] };
export type InputReceipt = { inputId: string; revisionId: string; duplicate: boolean; evaluationIds: string[] };

export type Money = { amount: string; currency: string; priceRef?: string };
export type Position = {
  accountId: string; instrumentId: string;
} & (
  { kind: "perp"; dex: string; venueCoin: string; signedSize: string; side: "long" | "short";
    entryPrice: string | null; notional: Money | null; unrealizedPnl: Money | null;
    marginMode: "cross" | "isolated" | "unknown"; leverage: string | null; liquidationPrice: string | null }
  | { kind: "spot"; tokenId: number; venueSymbol: string; total: string; hold: string;
      spotHold: string | null; value: Money | null }
);
export type CoveragePart = { part: string; status: "complete" | "failed" | "unsupported"; receivedAt: string; issue?: string };
export type AccountObservation = {
  accountId: string; network: Network; address: string; startedAt: string; completedAt: string;
  positions: Position[]; accountMode: string | null; accountFacts: Json;
  coverage: CoveragePart[]; issues: string[]; exposureHash: string; raw: Json;
};
export type AccountSnapshot = AccountObservation & { id: string; accountRevision: number; createdAt: string };
export type PortfolioSnapshot = {
  id: string; portfolioId: string; portfolioRevision: number; accountSnapshots: AccountSnapshot[];
  positions: Position[]; exposureRevision: string; createdAt: string; oldestObservationAt: string | null;
  coverage: "complete" | "partial" | "empty"; issues: string[];
};
export type RefreshRequest = {
  id: string; accountId: string; reason: string; status: "queued" | "running" | "completed" | "failed";
  dirty: boolean; createdAt: string; updatedAt: string; snapshotId: string | null; error: string | null;
};
export interface PortfolioProvider {
  read(account: Account, signal: AbortSignal): Promise<AccountObservation>;
  subscribe(account: Account, onChange: () => void, signal: AbortSignal): Promise<() => Promise<void>>;
  subAccounts(account: Account, signal: AbortSignal): Promise<{ address: string; name: string }[]>;
  close(): Promise<void>;
}
export type EvaluationTrigger = { kind: "input"; revisionId: string } | { kind: "portfolio"; snapshotId: string } | { kind: "manual" };
export type EvaluationRequest = {
  id: string; sequence: string; monitorId: string; monitorRevision: number;
  trigger: EvaluationTrigger; cutoffSequence: string; status: "awaiting_evaluator"; createdAt: string;
};

export type NotificationContent = { title: string; body: string; links?: { label: string; url: string }[] };
export type NotificationDraft = {
  destinationId: string; content: NotificationContent; origin: "operator_test" | "application";
  evidenceRevisionIds?: string[];
};
export type DeliveryStatus = "queued" | "sending" | "previewed" | "sent" | "rejected" | "unknown";
export type Delivery = NotificationDraft & {
  id: string; status: DeliveryStatus; renderedText: string | null; receipt: Json | null;
  error: string | null; attempts: number; nextAttemptAt: string | null; createdAt: string; updatedAt: string;
};
export type DeliveryResult =
  | { status: "sent" | "previewed"; receipt: Json }
  | { status: "rejected" | "unknown"; error: string }
  | { status: "retry"; error: string; retryAfterMs: number };
/** Explicit operator evidence; never authorizes another transmission. */
export type DeliveryResolution = { outcome: "sent" | "not_sent"; evidence: string };
export interface DeliveryAdapter { send(destination: Destination, text: string, signal: AbortSignal): Promise<DeliveryResult> }
export type QueueName = "portfolio.refresh" | "evaluation.run" | "notification.deliver" | "source.sync";
export type Dispatch = { id: string; sequence: string; queue: QueueName; recordId: string; availableAt: string; attempts: number; error: string | null };

/** PostgreSQL owns accepted work and business identity; Redis carries IDs. */
export interface AppStore {
  migrate(): Promise<void>;
  /** Single-owner startup only, before HTTP, producers or workers start. */
  recoverWork(): Promise<void>;
  health(): Promise<void>;
  close(): Promise<void>;
  createResource<K extends ResourceKind>(kind: K, draft: ResourceDrafts[K], key: string): Promise<Resource<K>>;
  updateResource<K extends ResourceKind>(kind: K, id: string, patch: Partial<ResourceDrafts[K]>, key: string): Promise<Resource<K>>;
  getResource<K extends ResourceKind>(kind: K, id: string): Promise<Resource<K> | null>;
  listResources<K extends ResourceKind>(kind: K, options?: ListOptions): Promise<Page<Resource<K>>>;
  acceptInput(sourceId: string, draft: InputDraft, key: string, guard?: { sourceRevision: number; connectionId: string; connectionRevision: number }): Promise<InputReceipt>;
  getInput(id: string): Promise<InputRecord | null>;
  listInputs(options?: ListOptions & { sourceId?: string }): Promise<Page<InputRevision>>;
  requestEvaluation(monitorId: string, trigger: EvaluationTrigger, key: string): Promise<EvaluationRequest>;
  getEvaluation(id: string): Promise<EvaluationRequest | null>;
  listEvaluations(options?: ListOptions & { monitorId?: string }): Promise<Page<EvaluationRequest>>;
  requestRefresh(accountId: string, reason: string, key: string): Promise<RefreshRequest>;
  requestPortfolioRefresh(portfolioId: string, key: string): Promise<RefreshRequest[]>;
  getRefresh(id: string): Promise<RefreshRequest | null>;
  beginRefresh(id: string): Promise<RefreshRequest | null>;
  finishRefresh(id: string, observation: AccountObservation | null, error?: string): Promise<void>;
  latestAccountSnapshot(accountId: string): Promise<AccountSnapshot | null>;
  latestPortfolioSnapshot(portfolioId: string): Promise<PortfolioSnapshot | null>;
  requestNotification(draft: NotificationDraft, key: string): Promise<Delivery>;
  getDelivery(id: string): Promise<Delivery | null>;
  listDeliveries(options?: ListOptions): Promise<Page<Delivery>>;
  beginDelivery(id: string, renderedText: string): Promise<Delivery | null>;
  finishDelivery(id: string, result: DeliveryResult): Promise<Delivery>;
  reconcileDelivery(id: string, resolution: DeliveryResolution, key: string): Promise<Delivery>;
  pendingDispatches(limit?: number): Promise<Dispatch[]>;
  markDispatched(id: string): Promise<void>;
  failDispatch(id: string, error: string): Promise<void>;
}

export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) { super(message); this.name = "AppError"; }
}
