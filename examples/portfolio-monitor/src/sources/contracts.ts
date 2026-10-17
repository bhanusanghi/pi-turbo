import type { InputDraft, Json, Resource } from "../contracts.js";

export type SourceProvider = string;
/** Provider definitions validate the fields they explicitly declare. */
export type ConnectionDraft = { label: string; enabled: boolean; adapter: string; [field: string]: unknown };
export type SourceWatch = {
  connectionId: string;
  /** Provider-defined target identity. */
  target: string;
  mode?: "poll" | "push";
  pollIntervalMs: number;
  /** Omit to start at the source's creation time. */
  startAt?: string;
  maxPages?: number;
  includeReplies?: boolean;
  includeReposts?: boolean;
};
export type Connection = Resource<"connections">;
export type WatchedSource = Resource<"sources"> & { watch: SourceWatch };
export type SourceCheckpoint = { [key: string]: Json };
export type SourceBatch = { items: InputDraft[]; checkpoint: SourceCheckpoint; gap: boolean };
export type SourceTarget = { id: string; label: string; username?: string };
export type SourceProbe = { identity: string; label?: string };

/** Clients own protocol/pagination; the host owns admission and checkpoint commits. */
export interface SourceClient {
  probe(connection: Connection, signal: AbortSignal): Promise<SourceProbe>;
  discover?(connection: Connection, signal: AbortSignal, limit?: number): Promise<SourceTarget[]>;
  collect(connection: Connection, source: WatchedSource, checkpoint: SourceCheckpoint | null, signal: AbortSignal): Promise<SourceBatch>;
  /** Resolve the effective live source and key; null defers subscription until ready. */
  prepareWatch?(connection: Connection, source: WatchedSource, checkpoint: SourceCheckpoint | null): { source: WatchedSource; key: string } | null;
  /** Optional live updates; one underlying session per account, filtered per source. */
  watch?(connection: Connection, source: WatchedSource, publish: (input: InputDraft) => Promise<void>, signal: AbortSignal, onFailure?: (error: SourceFailure) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}
export class SourceFailure extends Error {
  constructor(public readonly code: "authentication" | "rate_limit" | "access" | "contract" | "transport" | "configuration", message: string, public readonly retryAfterMs?: number) {
    super(message); this.name = "SourceFailure";
  }
}
export type SourceClients = Record<SourceProvider, SourceClient>;
export type SourceStatus = {
  sourceId: string; checkpoint: SourceCheckpoint | null; status: "idle" | "queued" | "running" | "backoff" | "auth_required" | "error" | "disabled" | "gap";
  nextRunAt: string | null; lastSuccessAt: string | null; lastError: string | null; lastCount: number; gap: boolean;
};
export type SourceSyncRequest = { id: string; sourceId: string; status: "queued" | "running" | "completed" | "failed"; createdAt: string; error: string | null };
export type SourceWork = { request: SourceSyncRequest; source: WatchedSource; connection: Connection; state: SourceStatus };
export type SourceOutcome =
  | { ok: true; checkpoint: SourceCheckpoint; count: number; gap: boolean }
  | { ok: false; code: SourceFailure["code"]; message: string; retryAfterMs?: number };
export interface SourceStore {
  recoverRunning(): Promise<void>;
  requestSync(sourceId: string, key: string): Promise<SourceSyncRequest>;
  scheduleDue(): Promise<void>;
  beginSync(id: string): Promise<SourceWork | null>;
  finishSync(id: string, outcome: SourceOutcome): Promise<void>;
  status(sourceId: string): Promise<SourceStatus>;
  getSync(id: string): Promise<SourceSyncRequest | null>;
  close(): Promise<void>;
}
