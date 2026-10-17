import { randomUUID } from "node:crypto";
import { SQL, type TransactionSQL } from "bun";
import { AppError, type AppStore } from "../contracts.js";
import type { Connection, SourceOutcome, SourceStatus, SourceStore, SourceSyncRequest, WatchedSource } from "./contracts.js";
import { string, uuid } from "../storage/validation.js";
type Row=Record<string,any>;
const iso=(v:any):string|null=>v ? new Date(v).toISOString() : null;
const resource=(r:Row)=>({...r.body,id:r.id,revision:r.revision,createdAt:iso(r.created_at)!,updatedAt:iso(r.updated_at)!});
const request=(r:Row):SourceSyncRequest=>({id:r.id,sourceId:r.source_id,status:r.status,createdAt:iso(r.created_at)!,error:r.error});
const state=(r:Row):SourceStatus=>({sourceId:r.source_id,checkpoint:r.checkpoint,status:r.status,nextRunAt:iso(r.next_run_at),lastSuccessAt:iso(r.last_success_at),lastError:r.last_error,lastCount:r.last_count,gap:r.gap});
const fail=(code:string,message:string,status=409):never=>{throw new AppError(code,message,status);};

/** Checkpoints and queue admission belong to the application, never the model. */
export function createSourceStore(databaseUrl:string, _store:AppStore):SourceStore {
  const url=new URL(databaseUrl); url.searchParams.set("statement_timeout","15000");
  const db=new SQL(url,{max:5,connectionTimeout:5,idleTimeout:30});
  const lock=async(tx:TransactionSQL,id:string)=>{await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`source:${id}`]);};
  async function configured(tx:TransactionSQL,sourceId:string) {
    const s=(await tx.unsafe<Row[]>("SELECT * FROM pm_resources WHERE kind='sources' AND id=$1 FOR SHARE",[sourceId]))[0];
    if(!s) return fail("not_found","Source not found",404);
    const source=resource(s) as WatchedSource;
    if(!source.enabled || source.kind!=="adapter" || !source.watch || source.watch.mode==="push") return fail("source_disabled","Source is disabled or has no collector configuration");
    const c=(await tx.unsafe<Row[]>("SELECT * FROM pm_resources WHERE kind='connections' AND id=$1 FOR SHARE",[source.watch.connectionId]))[0];
    if(!c || !c.enabled) return fail("connection_disabled","Source connection is missing or disabled");
    return {source,connection:resource(c) as Connection};
  }
  async function ensure(tx:TransactionSQL,source:WatchedSource,connection:Connection) {
    await tx.unsafe("INSERT INTO pm_source_state(source_id,source_revision,connection_id,connection_revision,status,next_run_at) VALUES($1,$2,$3,$4,'idle',clock_timestamp()) ON CONFLICT(source_id) DO NOTHING",[source.id,source.revision,connection.id,connection.revision]);
    // Credential changes release auth pauses; schedule edits invalidate an old in-flight result.
    await tx.unsafe("UPDATE pm_source_state SET source_revision=$2,connection_revision=$3,status=CASE WHEN status='auth_required' AND connection_revision<>$3 THEN 'idle' ELSE status END,next_run_at=CASE WHEN connection_revision<>$3 THEN clock_timestamp() ELSE next_run_at END,last_error=CASE WHEN connection_revision<>$3 THEN NULL ELSE last_error END WHERE source_id=$1",[source.id,source.revision,connection.revision]);
  }
  async function dispatch(tx:TransactionSQL,id:string,delay=0) {
    await tx.unsafe("INSERT INTO pm_dispatches(id,queue,record_id,available_at) VALUES($1,'source.sync',$2,clock_timestamp()+($3 * interval '1 millisecond'))",[randomUUID(),id,delay]);
  }
  async function enqueue(tx:TransactionSQL,source:WatchedSource,connection:Connection,dirty:boolean) {
    await ensure(tx,source,connection);
    const active=(await tx.unsafe<Row[]>("SELECT * FROM pm_source_sync_requests WHERE source_id=$1 AND status IN ('queued','running') FOR UPDATE",[source.id]))[0];
    if(active) {
      if(dirty && active.status==='running') await tx.unsafe("UPDATE pm_source_sync_requests SET dirty=true WHERE id=$1",[active.id]);
      return request(active);
    }
    const r=(await tx.unsafe<Row[]>("INSERT INTO pm_source_sync_requests(id,source_id,source_revision,connection_id,connection_revision,status) VALUES($1,$2,$3,$4,$5,'queued') RETURNING *",[randomUUID(),source.id,source.revision,connection.id,connection.revision]))[0]!;
    await tx.unsafe("UPDATE pm_source_state SET status=CASE WHEN status='backoff' AND next_run_at>clock_timestamp() THEN status ELSE 'queued' END WHERE source_id=$1",[source.id]);
    await dispatch(tx,r.id); return request(r);
  }
  return {
    async requestSync(sourceId,key) {
      uuid(sourceId); string(key,"idempotency key",200);
      return db.begin(async tx=>{
        await lock(tx,sourceId);
        const old=(await tx.unsafe<Row[]>("SELECT result FROM pm_idempotency WHERE operation=$1 AND key=$2",[`source-sync:${sourceId}`,key]))[0];
        if(old) return old.result as SourceSyncRequest;
        const {source,connection}=await configured(tx,sourceId);
        // Explicit retry can re-test a repaired credential value without changing its reference.
        await tx.unsafe("UPDATE pm_source_state SET status='idle',next_run_at=clock_timestamp(),last_error=NULL WHERE connection_id=$1 AND status='auth_required'",[connection.id]);
        const r=await enqueue(tx,source,connection,true);
        await tx.unsafe("INSERT INTO pm_idempotency(operation,key,payload_hash,result) VALUES($1,$2,$3,$4)",[`source-sync:${sourceId}`,key,sourceId,r]); return r;
      });
    },
    async scheduleDue() {
      const rows=await db.unsafe<Row[]>(`SELECT s.id FROM pm_resources s JOIN pm_resources c ON c.id=(s.body->'watch'->>'connectionId')::uuid AND c.kind='connections' LEFT JOIN pm_source_state st ON st.source_id=s.id
        WHERE s.kind='sources' AND s.enabled AND c.enabled AND s.body->>'kind'='adapter' AND s.body ? 'watch' AND COALESCE(s.body->'watch'->>'mode','poll')<>'push'
        AND (st.source_id IS NULL OR st.source_revision<>s.revision OR st.connection_revision<>c.revision OR (st.status<>'auth_required' AND (st.next_run_at IS NULL OR st.next_run_at<=clock_timestamp())))
        AND NOT EXISTS(SELECT 1 FROM pm_source_sync_requests r WHERE r.source_id=s.id AND r.status IN ('queued','running')) ORDER BY s.id`);
      for(const r of rows) {
        try { await db.begin(async tx=>{ await lock(tx,r.id); const {source,connection}=await configured(tx,r.id); await ensure(tx,source,connection);
          const blocked=(await tx.unsafe<Row[]>("SELECT 1 FROM pm_source_state WHERE connection_id=$1 AND connection_revision=$2 AND (status='auth_required' OR (status='backoff' AND next_run_at>clock_timestamp())) LIMIT 1",[connection.id,connection.revision])).length;
          if(!blocked) await enqueue(tx,source,connection,false);
        }); } catch(e) { if(!(e instanceof AppError && ["source_disabled","connection_disabled"].includes(e.code))) throw e; }
      }
    },
    async beginSync(id) {
      uuid(id); const found=(await db.unsafe<Row[]>("SELECT * FROM pm_source_sync_requests WHERE id=$1",[id]))[0]; if(!found) return null;
      return db.begin(async tx=>{
        await lock(tx,`connection:${found.connection_id}`); await lock(tx,found.source_id);
        const r=(await tx.unsafe<Row[]>("SELECT * FROM pm_source_sync_requests WHERE id=$1 FOR UPDATE",[id]))[0]!; if(r.status!=='queued') return null;
        let config:Awaited<ReturnType<typeof configured>>;
        try { config=await configured(tx,r.source_id); } catch(e) { if(!(e instanceof AppError)) throw e; await tx.unsafe("UPDATE pm_source_sync_requests SET status='failed',error='Source or connection disabled' WHERE id=$1",[id]); await tx.unsafe("UPDATE pm_source_state SET status='disabled' WHERE source_id=$1",[r.source_id]); return null; }
        const {source,connection}=config; await ensure(tx,source,connection);
        const blocked=(await tx.unsafe<Row[]>("SELECT status,next_run_at FROM pm_source_state WHERE connection_id=$1 AND connection_revision=$2 AND (status='auth_required' OR (status='backoff' AND next_run_at>clock_timestamp())) LIMIT 1",[connection.id,connection.revision]))[0];
        if(blocked?.status==='auth_required') { await tx.unsafe("UPDATE pm_source_sync_requests SET status='failed',error='Connection requires authentication' WHERE id=$1",[id]); await tx.unsafe("UPDATE pm_source_state SET status='auth_required',last_error='Connection requires authentication',next_run_at=NULL WHERE source_id=$1",[source.id]); return null; }
        const busy=(await tx.unsafe<Row[]>("SELECT 1 FROM pm_source_sync_requests WHERE connection_id=$1 AND status='running' LIMIT 1",[connection.id])).length;
        if(blocked || busy) { await dispatch(tx,id,blocked?.next_run_at ? Math.max(1000,new Date(blocked.next_run_at).getTime()-Date.now()) : 2000); return null; }
        await tx.unsafe("UPDATE pm_source_sync_requests SET status='running',source_revision=$2,connection_revision=$3,updated_at=clock_timestamp() WHERE id=$1",[id,source.revision,connection.revision]);
        const st=(await tx.unsafe<Row[]>("UPDATE pm_source_state SET status='running' WHERE source_id=$1 RETURNING *",[source.id]))[0]!;
        return {request:{...request(r),status:'running' as const},source,connection,state:state(st)};
      });
    },
    async finishSync(id,outcome) {
      uuid(id); const found=(await db.unsafe<Row[]>("SELECT * FROM pm_source_sync_requests WHERE id=$1",[id]))[0]; if(!found) return;
      await db.begin(async tx=>{
        await lock(tx,`connection:${found.connection_id}`); await lock(tx,found.source_id);
        const r=(await tx.unsafe<Row[]>("SELECT * FROM pm_source_sync_requests WHERE id=$1 FOR UPDATE",[id]))[0]!; if(r.status!=='running') return;
        let config:Awaited<ReturnType<typeof configured>>|null=null;
        try { config=await configured(tx,r.source_id); } catch(e) { if(!(e instanceof AppError)) throw e; }
        const current=config && config.source.revision===r.source_revision && config.connection.revision===r.connection_revision;
        await tx.unsafe("UPDATE pm_source_sync_requests SET status=$2,error=$3,updated_at=clock_timestamp() WHERE id=$1",[id,outcome.ok && current ? 'completed':'failed',!current ? 'Configuration changed during collection' : outcome.ok ? null : outcome.message]);
        if(!current) { if(config) await enqueue(tx,config.source,config.connection,false); else await tx.unsafe("UPDATE pm_source_state SET status='disabled' WHERE source_id=$1",[r.source_id]); return; }
        if(outcome.ok) await tx.unsafe("UPDATE pm_source_state SET checkpoint=$2,status=$3,last_success_at=clock_timestamp(),last_error=NULL,last_count=$4,gap=$5,next_run_at=clock_timestamp()+($6 * interval '1 millisecond') WHERE source_id=$1",[r.source_id,outcome.checkpoint,outcome.gap ? 'gap':'idle',outcome.count,outcome.gap,config!.source.watch.pollIntervalMs]);
        else {
          const delay=Math.max(1000,Number.isFinite(outcome.retryAfterMs) ? outcome.retryAfterMs! : config!.source.watch.pollIntervalMs);
          const status=outcome.code==='authentication' ? 'auth_required' : outcome.code==='rate_limit' ? 'backoff':'error';
          await tx.unsafe("UPDATE pm_source_state SET status=$2,last_error=$3,next_run_at=CASE WHEN $2='auth_required' THEN NULL ELSE clock_timestamp()+($4 * interval '1 millisecond') END WHERE source_id=$1",[r.source_id,status,outcome.message,delay]);
          if(status==='auth_required' || status==='backoff') await tx.unsafe("UPDATE pm_source_state SET status=$3,last_error=$4,next_run_at=CASE WHEN $3='auth_required' THEN NULL ELSE clock_timestamp()+($5 * interval '1 millisecond') END WHERE connection_id=$1 AND connection_revision=$2",[r.connection_id,r.connection_revision,status,outcome.message,delay]);
        }
        if(r.dirty && outcome.ok) await enqueue(tx,config!.source,config!.connection,false);
      });
    },
    async status(sourceId) {
      uuid(sourceId); const source=await _store.getResource("sources",sourceId); if(!source) return fail("not_found","Source not found",404);
      const r=(await db.unsafe<Row[]>("SELECT * FROM pm_source_state WHERE source_id=$1",[sourceId]))[0];
      const connection=source.watch ? await _store.getResource("connections",source.watch.connectionId) : null;
      const disabled=!source.enabled || !source.watch || !connection?.enabled;
      if(r) return {...state(r),...(disabled ? {status:'disabled' as const} : {})};
      return {sourceId,checkpoint:null,status:disabled ? 'disabled':'idle',nextRunAt:null,lastSuccessAt:null,lastError:null,lastCount:0,gap:false};
    },
    async getSync(id) { uuid(id); const r=(await db.unsafe<Row[]>("SELECT * FROM pm_source_sync_requests WHERE id=$1",[id]))[0]; return r ? request(r):null; },
    async recoverRunning() {
      // The host calls this once before queue workers start. Queued work can also
      // have been published to Redis then interrupted before beginSync; republish
      // both states, but retain a single pending outbox dispatch per request.
      await db.begin(async tx=>{
        const rows=await tx.unsafe<Row[]>("UPDATE pm_source_sync_requests SET status='queued',dirty=false,updated_at=clock_timestamp() WHERE status IN ('queued','running') RETURNING id,source_id");
        for(const r of rows) {
          await tx.unsafe("UPDATE pm_source_state SET status=CASE WHEN status IN ('auth_required','backoff') THEN status ELSE 'queued' END WHERE source_id=$1",[r.source_id]);
          const pending=(await tx.unsafe<Row[]>("SELECT 1 FROM pm_dispatches WHERE queue='source.sync' AND record_id=$1 AND dispatched_at IS NULL LIMIT 1",[r.id])).length;
          if(!pending) await dispatch(tx,r.id);
        }
      });
    },
    async close() { await db.close(); },
  };
}
