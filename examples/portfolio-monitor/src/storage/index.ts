import { createHash, randomUUID } from "node:crypto";
import { SQL, type TransactionSQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { AppError } from "../contracts.js";
import type { AccountObservation, AccountSnapshot, AppStore, Delivery, DeliveryResult, Dispatch, EvaluationRequest, EvaluationTrigger, InputDraft, InputReceipt, InputRecord, InputRevision, Json, ListOptions, NotificationDraft, Page, PortfolioSnapshot, QueueName, RefreshRequest, Resource, ResourceDrafts, ResourceKind } from "../contracts.js";
import { migration, migrationV2, migrationV3 } from "./migration.js";
import * as schema from "./schema.js";
import * as validate from "./validation.js";
import { emptySourceCatalog, type SourceCatalog } from "../sources/catalog.js";

type Tx = TransactionSQL;
type Row = Record<string, any>;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  const result = JSON.stringify(value); if (result === undefined) return validate.fail("Values must be JSON"); return result;
};
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const iso = (value: Date | string) => new Date(value).toISOString();
const resourceRow = <K extends ResourceKind>(r: Row): Resource<K> => ({ ...r.body, id: r.id, revision: r.revision, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) });
const inputRow = (r: Row): InputRevision => ({ ...r.body, id:r.id, inputId:r.input_id, sourceId:r.source_id, sequence:String(r.sequence), contentHash:r.content_hash, receivedAt:iso(r.received_at), chronology:r.source_revision === null ? "unspecified" : "provider_revision" });
const evaluationRow = (r: Row): EvaluationRequest => ({ id:r.id, sequence:String(r.sequence), monitorId:r.monitor_id, monitorRevision:r.monitor_revision, trigger:r.trigger, cutoffSequence:String(r.cutoff_sequence), status:"awaiting_evaluator", createdAt:iso(r.created_at) });
const refreshRow = (r: Row): RefreshRequest => ({ id:r.id, accountId:r.account_id, reason:r.reason, status:r.status, dirty:r.dirty, snapshotId:r.snapshot_id, error:r.error, createdAt:iso(r.created_at), updatedAt:iso(r.updated_at) });
const accountSnapshotRow = (r: Row): AccountSnapshot => ({ ...r.body, id:r.id, accountRevision:r.account_revision, createdAt:iso(r.created_at) });
const portfolioSnapshotRow = (r: Row): PortfolioSnapshot => ({ ...r.body, id:r.id, portfolioId:r.portfolio_id, portfolioRevision:r.portfolio_revision, exposureRevision:r.exposure_revision, createdAt:iso(r.created_at) });
const deliveryRow = (r: Row): Delivery => ({ ...r.body, id:r.id, status:r.status, renderedText:r.rendered_text, receipt:r.receipt, error:r.error, attempts:r.attempts, nextAttemptAt:r.next_attempt_at ? iso(r.next_attempt_at) : null, createdAt:iso(r.created_at), updatedAt:iso(r.updated_at) });
function pagination(options: ListOptions = {}, sequence = false): { limit: number; cursor: string | null } {
  const limit = options.limit ?? 50; if (!Number.isInteger(limit) || limit < 1 || limit > 200) validate.fail("limit must be 1–200");
  const cursor = options.cursor ?? null;
  if (cursor !== null) { if (sequence) { if (!/^\d+$/.test(cursor)) validate.fail("Invalid sequence cursor"); } else validate.uuid(cursor, "cursor"); }
  return { limit, cursor };
}
function page<T>(items: T[], limit: number, cursor: (item: T) => string): Page<T> {
  const more = items.length > limit; const kept = items.slice(0, limit); return { items: kept, nextCursor: more ? cursor(kept[kept.length - 1]!) : null };
}

export function createStore(databaseUrl: string, catalog: SourceCatalog = emptySourceCatalog): AppStore {
  let connectionFailed = false;
  // Keep URL startup parameters (search_path/application_name) when setting the server deadline.
  const connectionUrl = new URL(databaseUrl);
  connectionUrl.searchParams.set("statement_timeout", "15000");
  const client = new SQL(connectionUrl, { max: 10, connectionTimeout: 5, idleTimeout: 30,
    onclose: error => { if (error) connectionFailed = true; } });
  const db = drizzle(client, { schema });
  function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return client.begin(fn);
  }
  async function locked(tx: Tx, identity: string): Promise<void> { await tx.unsafe<Row[]>("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [identity]); }
  async function idempotent<T>(tx: Tx, operation: string, key: string, payload: unknown, fn: () => Promise<T>): Promise<T> {
    validate.string(key, "idempotency key", 200); const payloadHash = hash(payload);
    await locked(tx, `idempotency:${operation}:${key}`);
    const old = (await tx.unsafe<Row[]>("SELECT * FROM pm_idempotency WHERE operation=$1 AND key=$2", [operation,key]))[0];
    if (old) { if (old.payload_hash !== payloadHash) validate.fail("Idempotency key was already used with a different payload", "idempotency_conflict", 409); return old.result as T; }
    const result = await fn(); await tx.unsafe<Row[]>("INSERT INTO pm_idempotency(operation,key,payload_hash,result) VALUES($1,$2,$3,$4)", [operation,key,payloadHash,result]); return result;
  }
  async function readResource<K extends ResourceKind>(tx: Tx, kind: K, id: string, lock = false): Promise<Resource<K>> {
    // Identity is immutable: serialize body/revision writes without blocking membership FK KEY SHARE.
    validate.uuid(id); const r = (await tx.unsafe<Row[]>(`SELECT * FROM pm_resources WHERE kind=$1 AND id=$2${lock ? " FOR NO KEY UPDATE" : ""}`, [kind,id]))[0];
    if (!r) validate.fail(`${kind} resource not found`, "not_found", 404); return resourceRow<K>(r);
  }
  async function references<K extends ResourceKind>(tx: Tx, kind: K, draft: ResourceDrafts[K]): Promise<void> {
    if (kind === "sources" && (draft as ResourceDrafts["sources"]).watch) {
      const watch=(draft as ResourceDrafts["sources"]).watch!;
      const connection=await readResource(tx,"connections",watch.connectionId);
      catalog.validateWatch(connection,watch);
    }
    if (kind === "portfolios") for (const id of (draft as ResourceDrafts["portfolios"]).accountIds) await readResource(tx,"accounts",id);
    if (kind === "monitors") {
      const d = draft as ResourceDrafts["monitors"]; await readResource(tx,"portfolios",d.portfolioId);
      for (const id of d.sourceIds) await readResource(tx,"sources",id);
      for (const id of d.destinationIds) await readResource(tx,"destinations",id);
    }
  }
  async function memberships<K extends ResourceKind>(tx: Tx, kind: K, id: string, draft: ResourceDrafts[K]): Promise<void> {
    await tx.unsafe<Row[]>("DELETE FROM pm_memberships WHERE owner_id=$1", [id]);
    const relations: [string,string][] = [];
    if (kind === "portfolios") for (const target of (draft as ResourceDrafts["portfolios"]).accountIds) relations.push(["account",target]);
    if (kind === "monitors") { const d = draft as ResourceDrafts["monitors"]; relations.push(["portfolio",d.portfolioId]); for (const target of d.sourceIds) relations.push(["source",target]); for (const target of d.destinationIds) relations.push(["destination",target]); }
    for (const [relation,target] of relations) await tx.unsafe<Row[]>("INSERT INTO pm_memberships(owner_id,relation,target_id) VALUES($1,$2,$3)", [id,relation,target]);
  }
  async function dispatch(tx: Tx, queue: QueueName, recordId: string, delayMs = 0): Promise<void> {
    await locked(tx,"portfolio-monitor:accepted-events");
    await tx.unsafe<Row[]>("INSERT INTO pm_dispatches(id,queue,record_id,available_at) VALUES($1,$2,$3,now()+($4 * interval '1 millisecond'))", [randomUUID(),queue,recordId,delayMs]);
  }
  async function createEvaluation(tx: Tx, monitor: Resource<"monitors">, trigger: EvaluationTrigger): Promise<EvaluationRequest> {
    await locked(tx,"portfolio-monitor:accepted-events");
    const cutoff = (await tx.unsafe<Row[]>("SELECT COALESCE(MAX(sequence),0)::text AS cutoff FROM pm_input_revisions"))[0]!.cutoff;
    const row = (await tx.unsafe<Row[]>("INSERT INTO pm_evaluations(id,monitor_id,monitor_revision,cutoff_sequence,status,trigger) VALUES($1,$2,$3,$4,'awaiting_evaluator',$5) RETURNING *", [randomUUID(),monitor.id,monitor.revision,cutoff,trigger]))[0]!;
    await dispatch(tx,"evaluation.run",row.id); return evaluationRow(row);
  }
  async function newRefresh(tx: Tx, accountId: string, revision: number, reason: string): Promise<RefreshRequest> {
    const row = (await tx.unsafe<Row[]>("INSERT INTO pm_refresh_requests(id,account_id,account_revision,reason,status) VALUES($1,$2,$3,$4,'queued') RETURNING *", [randomUUID(),accountId,revision,reason]))[0]!;
    await dispatch(tx,"portfolio.refresh",row.id); return refreshRow(row);
  }
  /** Caller holds the account refresh lock and has validated current configuration. */
  async function coalesceRefresh(tx: Tx, account: Resource<"accounts">, reason: string): Promise<RefreshRequest> {
    const current = (await tx.unsafe<Row[]>("SELECT * FROM pm_refresh_requests WHERE account_id=$1 AND status IN ('queued','running') FOR UPDATE", [account.id]))[0];
    if (!current) return newRefresh(tx,account.id,account.revision,reason);
    if (current.status === "running") {
      const row = (await tx.unsafe<Row[]>("UPDATE pm_refresh_requests SET dirty=true,updated_at=clock_timestamp() WHERE id=$1 RETURNING *", [current.id]))[0]!;
      return refreshRow(row);
    }
    return refreshRow(current);
  }
  async function latestAccount(tx: Tx, accountId: string): Promise<AccountSnapshot | null> {
    const row = (await tx.unsafe<Row[]>("SELECT s.* FROM pm_account_snapshots s JOIN pm_resources a ON a.id=s.account_id AND a.revision=s.account_revision WHERE s.account_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 1", [accountId]))[0]; return row ? accountSnapshotRow(row) : null;
  }
  async function assemblePortfolio(tx: Tx, portfolioId: string): Promise<void> {
    // Serializes concurrent account completions for one portfolio; each assembly sees the committed preceding state.
    const portfolio = await readResource(tx,"portfolios",portfolioId,true); if (!portfolio.enabled) return;
    const snapshots: AccountSnapshot[] = []; const issues: string[] = [];
    for (const accountId of [...portfolio.accountIds].sort()) {
      const account = await readResource(tx,"accounts",accountId);
      const snapshot = await latestAccount(tx,accountId);
      if (!account.enabled) issues.push(`Account ${accountId} is disabled`);
      if (!snapshot) issues.push(`Account ${accountId} has no snapshot for configuration revision ${account.revision}`);
      else { snapshots.push(snapshot); for (const issue of snapshot.issues) issues.push(`${accountId}: ${issue}`); }
    }
    const complete = snapshots.length === portfolio.accountIds.length && issues.length === 0 && snapshots.every(s => s.coverage.length > 0 && s.coverage.every(p => p.status === "complete"));
    const exposureRevision = hash({ portfolioRevision:portfolio.revision, accounts:snapshots.map(s => [s.accountId,s.accountRevision,s.exposureHash]), missing:portfolio.accountIds.filter(id => !snapshots.some(s => s.accountId === id)) });
    const previous = (await tx.unsafe<Row[]>("SELECT exposure_revision FROM pm_portfolio_snapshots WHERE portfolio_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [portfolioId]))[0];
    const body = { accountSnapshots:snapshots, positions:snapshots.flatMap(s => s.positions), oldestObservationAt:snapshots.length ? snapshots.map(s => s.startedAt).sort()[0] : null, coverage:portfolio.accountIds.length === 0 ? "empty" : complete ? "complete" : "partial", issues };
    const id = randomUUID(); await tx.unsafe<Row[]>("INSERT INTO pm_portfolio_snapshots(id,portfolio_id,portfolio_revision,exposure_revision,body) VALUES($1,$2,$3,$4,$5)", [id,portfolioId,portfolio.revision,exposureRevision,body]);
    if (previous?.exposure_revision !== exposureRevision) {
      const monitors = await tx.unsafe<Row[]>("SELECT m.* FROM pm_resources m JOIN pm_memberships b ON b.owner_id=m.id AND b.relation='portfolio' WHERE m.kind='monitors' AND m.enabled AND b.target_id=$1 ORDER BY m.id", [portfolioId]);
      for (const m of monitors) await createEvaluation(tx,resourceRow<"monitors">(m),{kind:"portfolio",snapshotId:id});
    }
  }
  const store: AppStore = {
    async migrate() {
      await transaction(async tx => {
        await locked(tx,"portfolio-monitor:migrations");
        await tx.unsafe<Row[]>("CREATE TABLE IF NOT EXISTS pm_schema_version(version integer PRIMARY KEY)");
        const versions = (await tx.unsafe<Row[]>("SELECT version FROM pm_schema_version ORDER BY version"));
        if (versions.some((row,index)=>row.version!==index+1) || versions.length>3) validate.fail("Unsupported database schema version", "schema_version", 500);
        if (!versions.length) await tx.unsafe<Row[]>(migration).simple();
        if (versions.length<2) await tx.unsafe<Row[]>(migrationV2).simple();
        if (versions.length<3) await tx.unsafe<Row[]>(migrationV3).simple();
      });
    },
    async health() { await db.execute(sql`select 1`); connectionFailed = false; },
    async recoverWork() {
      // This application has one owner per database/queue namespace. Run before
      // starting workers: reads may restart; interrupted sends must never replay.
      await transaction(async tx => {
        await locked(tx,"portfolio-monitor:startup-recovery");
        const refreshes = await tx.unsafe<Row[]>("SELECT id,account_id FROM pm_refresh_requests WHERE status IN ('queued','running') ORDER BY account_id");
        for (const refresh of refreshes) {
          await locked(tx,`refresh:${refresh.account_id}`);
          const row = (await tx.unsafe<Row[]>("UPDATE pm_refresh_requests SET status='queued',dirty=false,error=NULL,updated_at=clock_timestamp() WHERE id=$1 AND status IN ('queued','running') RETURNING id", [refresh.id]))[0];
          if (row) await redispatch(row.id,"portfolio.refresh",null);
        }
        await tx.unsafe<Row[]>("UPDATE pm_deliveries SET status='unknown',error='Application restarted during delivery; acceptance is uncertain',next_attempt_at=NULL,updated_at=clock_timestamp() WHERE status='sending'");
        const deliveries = await tx.unsafe<Row[]>("SELECT id,next_attempt_at FROM pm_deliveries WHERE status='queued' ORDER BY id");
        for (const delivery of deliveries) await redispatch(delivery.id,"notification.deliver",delivery.next_attempt_at);

        async function redispatch(recordId: string, queue: QueueName, availableAt: Date | null) {
          await locked(tx,"portfolio-monitor:accepted-events");
          // New outbox identity also works if Redis retained an old completed job.
          // Repeated recovery preserves one pending dispatch and any retry deadline.
          await tx.unsafe<Row[]>(`INSERT INTO pm_dispatches(id,queue,record_id,available_at)
            SELECT $1,$2,$3,COALESCE($4::timestamptz,clock_timestamp())
            WHERE NOT EXISTS (SELECT 1 FROM pm_dispatches WHERE queue=$2 AND record_id=$3 AND dispatched_at IS NULL)`,
            [randomUUID(),queue,recordId,availableAt]);
        }
      });
    },
    async close() { await client.close(); },
    async createResource(kind,draft,key) {
      validate.resource(kind,draft,catalog);
      return transaction(tx => idempotent(tx,`create:${kind}`,key,draft,async () => {
        await references(tx,kind,draft); const id = randomUUID();
        const row = (await tx.unsafe<Row[]>("INSERT INTO pm_resources(id,kind,revision,enabled,body) VALUES($1,$2,1,$3,$4) RETURNING *", [id,kind,draft.enabled,draft]))[0]!;
        await memberships(tx,kind,id,draft); return resourceRow<typeof kind>(row);
      }));
    },
    async updateResource(kind,id,patch,key) {
      validate.uuid(id); if (!patch || typeof patch !== "object" || Array.isArray(patch)) validate.fail("Patch must be an object");
      return transaction(tx => idempotent(tx,`update:${kind}:${id}`,key,patch,async () => {
        // Use the same lock order as refresh admission/completion before taking the account row.
        if (kind === "accounts") await locked(tx,`refresh:${id}`);
        const old = await readResource(tx,kind,id,true);
        const { id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...oldDraft } = old;
        const draft = { ...oldDraft, ...patch } as unknown as ResourceDrafts[typeof kind]; validate.resource(kind,draft,catalog); await references(tx,kind,draft);
        if (kind === "connections" && (old as Resource<"connections">).adapter !== (draft as ResourceDrafts["connections"]).adapter) validate.fail("Connection adapter is immutable", "immutable_connection",409);
        if (kind === "sources") {
          const before=(old as Resource<"sources">).watch, after=(draft as ResourceDrafts["sources"]).watch;
          if (JSON.stringify(before && [before.connectionId,before.target,before.startAt ?? null]) !== JSON.stringify(after && [after.connectionId,after.target,after.startAt ?? null])) validate.fail("Source connection, target and startAt are immutable; create a new source", "immutable_source",409);
        }
        const row = (await tx.unsafe<Row[]>("UPDATE pm_resources SET revision=revision+1,enabled=$2,body=$3,updated_at=clock_timestamp() WHERE id=$1 RETURNING *", [id,draft.enabled,draft]))[0]!;
        await memberships(tx,kind,id,draft);
        if (kind === "accounts") await tx.unsafe<Row[]>("UPDATE pm_refresh_requests SET dirty=true WHERE account_id=$1 AND status='running'", [id]);
        return resourceRow<typeof kind>(row);
      }));
    },
    async getResource(kind,id) {
      validate.uuid(id);
      const row = (await db.select().from(schema.resources).where(and(eq(schema.resources.kind,kind),eq(schema.resources.id,id))).limit(1))[0];
      return row ? resourceRow<typeof kind>({...row,created_at:row.createdAt,updated_at:row.updatedAt}) : null;
    },
    async listResources(kind,options) {
      const {limit,cursor} = pagination(options);
      const rows = await db.select().from(schema.resources).where(and(eq(schema.resources.kind,kind),cursor ? gt(schema.resources.id,cursor) : undefined)).orderBy(asc(schema.resources.id)).limit(limit+1);
      return page(rows.map(r => resourceRow<typeof kind>({...r,created_at:r.createdAt,updated_at:r.updatedAt})),limit,r => r.id);
    },
    async acceptInput(sourceId,draft,key,guard) {
      validate.uuid(sourceId); validate.input(draft);
      return transaction(tx => idempotent(tx,`input:${sourceId}`,key,draft,async () => {
        // Freeze resource admission against concurrent disable/configuration writes.
        const source = await readResource(tx,"sources",sourceId,true);
        if (!source.enabled) validate.fail("Source is disabled","disabled",409);
        if (guard) {
          const connection=await readResource(tx,"connections",guard.connectionId,true);
          if (!connection.enabled || connection.revision!==guard.connectionRevision || source.revision!==guard.sourceRevision || source.watch?.connectionId!==connection.id) validate.fail("Source or connection configuration changed","source_changed",409);
        }
        await locked(tx,"portfolio-monitor:accepted-events");
        // The lock scopes the canonical provider item, independently of caller request keys.
        await locked(tx,`input:${sourceId}:${draft.sourceItemId}`);
        let item = (await tx.unsafe<Row[]>("SELECT * FROM pm_input_items WHERE source_id=$1 AND source_item_id=$2", [sourceId,draft.sourceItemId]))[0];
        if (!item) item = (await tx.unsafe<Row[]>("INSERT INTO pm_input_items(id,source_id,source_item_id) VALUES($1,$2,$3) RETURNING *", [randomUUID(),sourceId,draft.sourceItemId]))[0]!;
        const { sourceRevision: _providerRevision, ...content } = draft;
        const contentHash = hash(content);
        if (draft.sourceRevision !== undefined) {
          const same = (await tx.unsafe<Row[]>("SELECT * FROM pm_input_provider_revisions WHERE input_id=$1 AND provider_revision=$2", [item.id,draft.sourceRevision]))[0];
          if (same) { if (same.content_hash !== contentHash) validate.fail("Provider revision already has different content", "revision_conflict", 409); return {inputId:item.id,revisionId:same.revision_id,duplicate:true,evaluationIds:[]}; }
        }
        const latest = (await tx.unsafe<Row[]>("SELECT * FROM pm_input_revisions WHERE input_id=$1 ORDER BY sequence DESC LIMIT 1", [item.id]))[0];
        // The registered adapter decides revision ordering while the canonical
        // item lock is held. Configuration determines policy, never provenance.
        if (latest && source.watch) {
          const connection=await readResource(tx,"connections",source.watch.connectionId);
          if (!catalog.acceptsRevision(connection.adapter,latest.body as InputDraft,draft)) {
            return {inputId:item.id,revisionId:latest.id,duplicate:true,evaluationIds:[]};
          }
        }
        if (latest?.content_hash === contentHash) {
          if (draft.sourceRevision !== undefined) await tx.unsafe<Row[]>("INSERT INTO pm_input_provider_revisions(input_id,provider_revision,content_hash,revision_id) VALUES($1,$2,$3,$4)", [item.id,draft.sourceRevision,contentHash,latest.id]);
          return {inputId:item.id,revisionId:latest.id,duplicate:true,evaluationIds:[]};
        }
        const revision = (await tx.unsafe<Row[]>("INSERT INTO pm_input_revisions(id,input_id,source_id,content_hash,source_revision,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [randomUUID(),item.id,sourceId,contentHash,draft.sourceRevision ?? null,draft]))[0]!;
        if (draft.sourceRevision !== undefined) await tx.unsafe<Row[]>("INSERT INTO pm_input_provider_revisions(input_id,provider_revision,content_hash,revision_id) VALUES($1,$2,$3,$4)", [item.id,draft.sourceRevision,contentHash,revision.id]);
        const evaluationIds: string[] = [];
        const monitors = await tx.unsafe<Row[]>("SELECT m.* FROM pm_resources m JOIN pm_memberships b ON b.owner_id=m.id AND b.relation='source' JOIN pm_resources p ON p.id=(m.body->>'portfolioId')::uuid WHERE m.kind='monitors' AND m.enabled AND p.enabled AND b.target_id=$1 ORDER BY m.id", [sourceId]);
        for (const row of monitors) evaluationIds.push((await createEvaluation(tx,resourceRow<"monitors">(row),{kind:"input",revisionId:revision.id})).id);
        return {inputId:item.id,revisionId:revision.id,duplicate:false,evaluationIds};
      }));
    },
    async getInput(id) {
      validate.uuid(id); const item = (await client.unsafe<Row[]>("SELECT * FROM pm_input_items WHERE id=$1", [id]))[0]; if (!item) return null;
      const revisions = await client.unsafe<Row[]>("SELECT * FROM pm_input_revisions WHERE input_id=$1 ORDER BY sequence", [id]);
      return {id:item.id,sourceId:item.source_id,sourceItemId:item.source_item_id,revisions:revisions.map(inputRow)};
    },
    async listInputs(options = {}) {
      const {limit,cursor} = pagination(options,true); if (options.sourceId) validate.uuid(options.sourceId);
      const rows = await client.unsafe<Row[]>("SELECT * FROM pm_input_revisions WHERE sequence>$1 AND ($2::uuid IS NULL OR source_id=$2) ORDER BY sequence LIMIT $3", [cursor ?? "0",options.sourceId ?? null,limit+1]);
      return page(rows.map(inputRow),limit,r => r.sequence);
    },
    async requestEvaluation(monitorId,trigger,key) {
      validate.uuid(monitorId);
      if (!trigger || !["input","portfolio","manual"].includes(trigger.kind)) validate.fail("Invalid evaluation trigger");
      return transaction(tx => idempotent(tx,`evaluation:${monitorId}`,key,trigger,async () => {
        const monitor = await readResource(tx,"monitors",monitorId); if (!monitor.enabled) validate.fail("Monitor is disabled", "disabled", 409);
        const portfolio = await readResource(tx,"portfolios",monitor.portfolioId); if (!portfolio.enabled) validate.fail("Portfolio is disabled", "disabled", 409);
        if (trigger.kind === "input") { validate.uuid(trigger.revisionId); const revision = (await tx.unsafe<Row[]>("SELECT source_id FROM pm_input_revisions WHERE id=$1", [trigger.revisionId]))[0]; if (!revision || !monitor.sourceIds.includes(revision.source_id)) validate.fail("Input revision is outside monitor sources", "scope", 400); }
        if (trigger.kind === "portfolio") { validate.uuid(trigger.snapshotId); const snapshot = (await tx.unsafe<Row[]>("SELECT portfolio_id FROM pm_portfolio_snapshots WHERE id=$1", [trigger.snapshotId]))[0]; if (!snapshot || snapshot.portfolio_id !== monitor.portfolioId) validate.fail("Snapshot is outside monitor portfolio", "scope", 400); }
        return createEvaluation(tx,monitor,trigger);
      }));
    },
    async getEvaluation(id) { validate.uuid(id); const row = (await client.unsafe<Row[]>("SELECT * FROM pm_evaluations WHERE id=$1", [id]))[0]; return row ? evaluationRow(row) : null; },
    async listEvaluations(options = {}) {
      const {limit,cursor} = pagination(options,true); if (options.monitorId) validate.uuid(options.monitorId);
      const rows = await client.unsafe<Row[]>("SELECT * FROM pm_evaluations WHERE sequence>$1 AND ($2::uuid IS NULL OR monitor_id=$2) ORDER BY sequence LIMIT $3", [cursor ?? "0",options.monitorId ?? null,limit+1]); return page(rows.map(evaluationRow),limit,r => r.sequence);
    },
    async requestRefresh(accountId,reason,key) {
      validate.uuid(accountId); validate.string(reason,"reason",500);
      return transaction(tx => idempotent(tx,`refresh:${accountId}`,key,{reason},async () => {
        await locked(tx,`refresh:${accountId}`); const account = await readResource(tx,"accounts",accountId); if (!account.enabled) validate.fail("Account is disabled", "disabled", 409);
        return coalesceRefresh(tx,account,reason);
      }));
    },
    async requestPortfolioRefresh(portfolioId,key) {
      validate.uuid(portfolioId);
      return transaction(tx => idempotent(tx,`portfolio-refresh:${portfolioId}`,key,{portfolioId},async () => {
        // Freeze this command's accepted scope without holding a portfolio row while waiting for account locks.
        const portfolio = await readResource(tx,"portfolios",portfolioId);
        if (!portfolio.enabled) validate.fail("Portfolio is disabled", "disabled", 409);
        const accountIds=[...portfolio.accountIds].sort();
        for (const accountId of accountIds) await locked(tx,`refresh:${accountId}`);
        const accounts: Resource<"accounts">[] = [];
        for (const accountId of accountIds) {
          const account = await readResource(tx,"accounts",accountId);
          if (!account.enabled) validate.fail(`Account ${accountId} is disabled`, "disabled", 409);
          accounts.push(account);
        }
        const requests: RefreshRequest[] = [];
        for (const account of accounts) requests.push(await coalesceRefresh(tx,account,"portfolio_refresh"));
        return requests;
      }));
    },
    async getRefresh(id) { validate.uuid(id); const row = (await client.unsafe<Row[]>("SELECT * FROM pm_refresh_requests WHERE id=$1", [id]))[0]; return row ? refreshRow(row) : null; },
    async beginRefresh(id) {
      validate.uuid(id); return transaction(async tx => {
        const row = (await tx.unsafe<Row[]>("SELECT * FROM pm_refresh_requests WHERE id=$1", [id]))[0]; if (!row) return null;
        await locked(tx,`refresh:${row.account_id}`);
        const account = await readResource(tx,"accounts",row.account_id,true);
        if (!account.enabled) { await tx.unsafe<Row[]>("UPDATE pm_refresh_requests SET status='failed',error='Account disabled',updated_at=clock_timestamp() WHERE id=$1 AND status='queued'", [id]); return null; }
        const started = (await tx.unsafe<Row[]>("UPDATE pm_refresh_requests SET status='running',account_revision=$2,updated_at=clock_timestamp() WHERE id=$1 AND status='queued' RETURNING *", [id,account.revision]))[0]; return started ? refreshRow(started) : null;
      });
    },
    async finishRefresh(id,observation,error) {
      validate.uuid(id); if (observation) validate.observation(observation);
      await transaction(async tx => {
        const found = (await tx.unsafe<Row[]>("SELECT * FROM pm_refresh_requests WHERE id=$1", [id]))[0]; if (!found) validate.fail("Refresh not found", "not_found", 404);
        await locked(tx,`refresh:${found.account_id}`);
        const row = (await tx.unsafe<Row[]>("SELECT * FROM pm_refresh_requests WHERE id=$1 FOR UPDATE", [id]))[0]!;
        if (row.status !== "running") return;
        const account = await readResource(tx,"accounts",row.account_id,true);
        if (observation && (observation.accountId !== row.account_id || observation.address.toLowerCase() !== account.address.toLowerCase() || observation.network !== account.network)) {
          // Configuration may change while HTTP is outstanding. Discard the old observation and queue current config.
          if (account.revision === row.account_revision) validate.fail("Observation identity does not match requested account", "scope", 400);
          observation = null; error = "Account identity changed during refresh";
        }
        let snapshotId: string | null = null;
        if (observation) { snapshotId = randomUUID(); await tx.unsafe<Row[]>("INSERT INTO pm_account_snapshots(id,account_id,account_revision,body) VALUES($1,$2,$3,$4)", [snapshotId,row.account_id,row.account_revision,observation]); }
        await tx.unsafe<Row[]>("UPDATE pm_refresh_requests SET status=$2,snapshot_id=$3,error=$4,updated_at=clock_timestamp() WHERE id=$1", [id,observation ? "completed" : "failed",snapshotId,observation ? null : error ?? "Provider refresh failed"]);
        if (observation && account.revision === row.account_revision) {
          const portfolios = await tx.unsafe<Row[]>("SELECT owner_id FROM pm_memberships WHERE relation='account' AND target_id=$1 ORDER BY owner_id", [row.account_id]);
          for (const p of portfolios) await assemblePortfolio(tx,p.owner_id);
        }
        if ((row.dirty || account.revision !== row.account_revision) && account.enabled) await newRefresh(tx,row.account_id,account.revision,"changes_during_refresh");
      });
    },
    async latestAccountSnapshot(accountId) { validate.uuid(accountId); return transaction(tx => latestAccount(tx,accountId)); },
    async latestPortfolioSnapshot(portfolioId) {
      validate.uuid(portfolioId); const row = (await client.unsafe<Row[]>("SELECT s.* FROM pm_portfolio_snapshots s JOIN pm_resources p ON p.id=s.portfolio_id AND p.revision=s.portfolio_revision WHERE s.portfolio_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 1", [portfolioId]))[0];
      if (!row) return null; const snapshot = portfolioSnapshotRow(row);
      // Account config changes invalidate eligibility without presenting old holdings as current.
      const revisions = await client.unsafe<Row[]>("SELECT id,revision,enabled FROM pm_resources WHERE id=ANY($1::uuid[])", [client.array(snapshot.accountSnapshots.map(s => s.accountId), "UUID")]);
      for (const account of revisions) { const old = snapshot.accountSnapshots.find(s => s.accountId === account.id)!; if (old.accountRevision !== account.revision || !account.enabled) { snapshot.coverage="partial"; snapshot.issues.push(`Account ${account.id} configuration changed after snapshot`); } }
      return snapshot;
    },
    async requestNotification(draft,key) {
      validate.notification(draft);
      return transaction(tx => idempotent(tx,"notification",key,draft,async () => {
        const destination = await readResource(tx,"destinations",draft.destinationId); if (!destination.enabled) validate.fail("Destination is disabled", "disabled", 409);
        for (const revisionId of draft.evidenceRevisionIds ?? []) if (!(await tx.unsafe<Row[]>("SELECT 1 FROM pm_input_revisions WHERE id=$1", [revisionId])).length) validate.fail("Evidence revision not found", "not_found", 404);
        const row = (await tx.unsafe<Row[]>("INSERT INTO pm_deliveries(id,destination_id,destination_revision,body,status) VALUES($1,$2,$3,$4,'queued') RETURNING *", [randomUUID(),destination.id,destination.revision,draft]))[0]!;
        await dispatch(tx,"notification.deliver",row.id); return deliveryRow(row);
      }));
    },
    async getDelivery(id) { validate.uuid(id); const row = (await client.unsafe<Row[]>("SELECT * FROM pm_deliveries WHERE id=$1", [id]))[0]; return row ? deliveryRow(row) : null; },
    async listDeliveries(options) { const {limit,cursor} = pagination(options); const rows = await client.unsafe<Row[]>("SELECT * FROM pm_deliveries WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2", [cursor,limit+1]); return page(rows.map(deliveryRow),limit,r => r.id); },
    async beginDelivery(id,renderedText) {
      validate.uuid(id); validate.string(renderedText,"renderedText",100_000);
      return transaction(async tx => {
        const row = (await tx.unsafe<Row[]>("SELECT * FROM pm_deliveries WHERE id=$1 FOR UPDATE", [id]))[0]; if (!row || row.status !== "queued" || (row.next_attempt_at && new Date(row.next_attempt_at).getTime() > Date.now())) return null;
        const destination = await readResource(tx,"destinations",row.destination_id);
        if (!destination.enabled || destination.revision !== row.destination_revision) { await tx.unsafe<Row[]>("UPDATE pm_deliveries SET status='rejected',error='Destination disabled or changed after request',updated_at=clock_timestamp() WHERE id=$1", [id]); return null; }
        const started = (await tx.unsafe<Row[]>("UPDATE pm_deliveries SET status='sending',rendered_text=$2,attempts=attempts+1,next_attempt_at=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *", [id,renderedText]))[0]!; return deliveryRow(started);
      });
    },
    async finishDelivery(id,result) {
      validate.uuid(id); if (!result || !["sent","previewed","rejected","unknown","retry"].includes(result.status)) validate.fail("Invalid delivery result");
      if (result.status === "retry" && (!Number.isFinite(result.retryAfterMs) || result.retryAfterMs < 0 || result.retryAfterMs > 86_400_000)) validate.fail("retryAfterMs must be between zero and one day");
      return transaction(async tx => {
        const row = (await tx.unsafe<Row[]>("SELECT * FROM pm_deliveries WHERE id=$1 FOR UPDATE", [id]))[0]; if (!row) validate.fail("Delivery not found", "not_found", 404);
        if (row.status !== "sending") return deliveryRow(row);
        const retry = result.status === "retry"; const receipt: Json | null = "receipt" in result ? result.receipt : null; const error = "error" in result ? result.error : null;
        const updated = (await tx.unsafe<Row[]>("UPDATE pm_deliveries SET status=$2,receipt=$3,error=$4,next_attempt_at=CASE WHEN $5::double precision IS NULL THEN NULL ELSE now()+($5 * interval '1 millisecond') END,updated_at=clock_timestamp() WHERE id=$1 RETURNING *", [id,retry ? "queued" : result.status,receipt,error,retry ? result.retryAfterMs : null]))[0]!;
        if (retry) await dispatch(tx,"notification.deliver",id,result.retryAfterMs); return deliveryRow(updated);
      });
    },
    async reconcileDelivery(id,resolution,key) {
      validate.uuid(id);
      if (!resolution || typeof resolution !== "object" || Object.keys(resolution).some(k => !["outcome","evidence"].includes(k)) || !["sent","not_sent"].includes(resolution.outcome)) validate.fail("Invalid delivery resolution");
      validate.string(resolution.evidence,"reconciliation evidence",2000);
      return transaction(tx => idempotent(tx,`reconcile-delivery:${id}`,key,resolution,async () => {
        const row = (await tx.unsafe<Row[]>("SELECT * FROM pm_deliveries WHERE id=$1 FOR UPDATE",[id]))[0];
        if (!row) validate.fail("Delivery not found","not_found",404);
        if (row.status !== "unknown") validate.fail("Only unknown deliveries can be reconciled","delivery_not_unknown",409);
        const receipt = { kind:"operator_reconciliation", ...resolution, reconciledAt:new Date().toISOString(), previousReceipt:row.receipt, previousError:row.error };
        const updated = (await tx.unsafe<Row[]>("UPDATE pm_deliveries SET status=$2,receipt=$3,error=$4,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [id,resolution.outcome === "sent" ? "sent" : "rejected",receipt,resolution.outcome === "not_sent" ? "Operator confirmed delivery was not sent" : null]))[0]!;
        return deliveryRow(updated);
      }));
    },
    async pendingDispatches(limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) validate.fail("Dispatch limit must be 1–1000");
      const rows = await client.unsafe<Row[]>("SELECT * FROM pm_dispatches WHERE dispatched_at IS NULL AND available_at<=now() ORDER BY sequence LIMIT $1", [limit]);
      return rows.map(r => ({id:r.id,sequence:String(r.sequence),queue:r.queue,recordId:r.record_id,availableAt:iso(r.available_at),attempts:r.attempts,error:r.error}));
    },
    async markDispatched(id) { validate.uuid(id); await client.unsafe<Row[]>("UPDATE pm_dispatches SET dispatched_at=now(),attempts=attempts+1,error=NULL WHERE id=$1 AND dispatched_at IS NULL", [id]); },
    async failDispatch(id,error) { validate.uuid(id); validate.string(error,"dispatch error",10_000); await client.unsafe<Row[]>("UPDATE pm_dispatches SET attempts=attempts+1,error=$2 WHERE id=$1 AND dispatched_at IS NULL", [id,error]); },
  };
  return new Proxy(store, {
    get(target,property,receiver) {
      const value = Reflect.get(target,property,receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try { return await value.apply(target,args); }
        catch (error) {
          let cause: unknown = error;
          for (let depth=0;depth<5 && cause && typeof cause === "object";depth++) {
            const e=cause as {code?:string;errno?:string;message?:string;cause?:unknown};
            if (["ECONNREFUSED","ECONNRESET","ETIMEDOUT","ENOTFOUND","EPIPE","ERR_POSTGRES_CONNECTION_CLOSED","ERR_POSTGRES_CONNECTION_TIMEOUT","ERR_POSTGRES_IDLE_TIMEOUT","ERR_POSTGRES_CONNECTION_REFUSED","57P01","57P02","57P03","53300","57014"].includes(e.errno ?? e.code ?? "") || /connection terminated|connection timeout|timeout exceeded|query read timeout/i.test(e.message ?? "")) {
              throw new AppError("database_unavailable",connectionFailed ? "Database connection was interrupted; request failed" : "Database is unavailable or exceeded its request deadline",503);
            }
            cause=e.cause;
          }
          throw error;
        }
      };
    },
  });
}
