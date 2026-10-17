import { randomUUID } from "node:crypto";
import { AppError, type AppStore, type InputDraft } from "../contracts.js";
import { SourceFailure, type Connection, type SourceClients, type SourceStore, type SourceStatus, type WatchedSource } from "./contracts.js";
export { createSourceStore } from "./store.js";
export * from "./contracts.js";
export type SourceModuleOptions={store:AppStore;sourceStore:SourceStore;clients:SourceClients;intervalMs?:number;onError?:(error:unknown)=>void};
const safeFailure=(error:unknown):SourceFailure=>{
  if(error instanceof SourceFailure) return new SourceFailure(error.code,`Source collection failed (${error.code})`,error.retryAfterMs);
  if(error instanceof AppError && ["disabled","source_changed","source_disabled","connection_disabled"].includes(error.code)) return new SourceFailure("configuration","Source configuration changed or was disabled");
  return new SourceFailure("transport","Source collection failed; check the connection and retry");
};
export function createSourceModule(options:SourceModuleOptions) {
  const {store,sourceStore,clients}=options;
  const clientFor=(adapter:string)=>{
    const client=Object.hasOwn(clients,adapter) ? clients[adapter] : undefined;
    if(!client) throw new SourceFailure("configuration","Source adapter client is not installed");
    return client;
  };
  const interval=options.intervalMs ?? 5000;
  if(!Number.isFinite(interval) || interval<100) throw new Error("Source intervalMs must be at least 100");
  const controller=new AbortController();
  const watchers=new Map<string,{revision:string;abort:AbortController;close:()=>Promise<void>}>();
  const jobs=new Set<Promise<void>>();
  const activeCollections=new Map<string,{revision:string;abort:AbortController}>();
  // Hold each source's publication lane while history is fetched/admitted. Live
  // callbacks wait behind it, including after collection fails, preserving edits.
  const publicationTails=new Map<string,Promise<void>>();
  async function serialize(sourceId:string,operation:()=>Promise<void>) {
    const preceding=publicationTails.get(sourceId) ?? Promise.resolve();
    const result=preceding.then(operation);
    const tail=result.catch(()=>{}); publicationTails.set(sourceId,tail);
    try {await result;} finally {if(publicationTails.get(sourceId)===tail) publicationTails.delete(sourceId);}
  }
  let timer:ReturnType<typeof setInterval>|undefined, reconciling:Promise<void>|undefined, started=false;
  const report=(e:unknown)=>options.onError?.(safeFailure(e));
  async function publish(source:WatchedSource,connection:Connection,input:InputDraft,signal:AbortSignal) {
    signal.throwIfAborted();
    await store.acceptInput(source.id,input,randomUUID(),{sourceRevision:source.revision,connectionId:connection.id,connectionRevision:connection.revision});
  }
  async function reconcile() {
    controller.signal.throwIfAborted();
    const current=new Map<string,{source:WatchedSource;connection:Connection;revision:string;status:SourceStatus;watchSource:WatchedSource|null}>();
    let cursor:string|undefined;
    do {
      const page=await store.listResources("sources",{limit:200,...(cursor ? {cursor}:{})});
      for(const source of page.items) if(source.enabled && source.kind==='adapter' && source.watch && source.watch.mode!=='push') {
        const connection=await store.getResource("connections",source.watch.connectionId);
        if(connection?.enabled) {
          const status=await sourceStore.status(source.id);
          try {
            const client=clientFor(connection.adapter);
            const prepared=client.prepareWatch ? client.prepareWatch(connection,source as WatchedSource,status.checkpoint) : {source:source as WatchedSource,key:''};
            current.set(source.id,{source:source as WatchedSource,connection,status,watchSource:prepared?.source ?? null,revision:`${source.revision}:${connection.revision}:${prepared?.key ?? ''}`});
          } catch(error) {report(error);}
        }
      }
      cursor=page.nextCursor ?? undefined;
    } while(cursor && !controller.signal.aborted);
    for(const [id,active] of activeCollections) {
      const config=current.get(id);
      if(!config || `${config.source.revision}:${config.connection.revision}`!==active.revision) active.abort.abort(new Error("Source configuration changed"));
    }
    for(const [id,watcher] of watchers) {
      const status=current.has(id) ? await sourceStore.status(id) : null;
      if(!current.get(id)?.watchSource || current.get(id)?.revision!==watcher.revision || status?.status==='auth_required' || status?.status==='backoff') {
        watchers.delete(id); watcher.abort.abort(); await watcher.close().catch(report);
      }
    }
    await sourceStore.scheduleDue();
    for(const [id,{source,connection,revision,status,watchSource}] of current) {
      if(controller.signal.aborted) return;
      const client=clientFor(connection.adapter);
      if(!client.watch || !watchSource || watchers.has(id)) continue;
      if(status.status==='auth_required' || status.status==='backoff') continue;
      const abort=new AbortController(); const signal=AbortSignal.any([controller.signal,abort.signal]);
      const setupDeadline=setTimeout(()=>abort.abort(new Error("Source watch setup deadline")),30_000);
      const invalidate=(error:SourceFailure)=>{
        abort.abort(error);
        const lease=watchers.get(id);
        if(lease?.abort===abort) {
          watchers.delete(id);
          void lease.close().catch(report);
        }
        report(error);
      };
      try {
        const close=await client.watch(connection,watchSource,async input=>{
          signal.throwIfAborted();
          // An event already received remains valid after its transport lease is
          // invalidated. Host shutdown/configuration guards still reject it.
          await serialize(source.id,()=>publish(source,connection,input,controller.signal));
        },signal,invalidate);
        if(signal.aborted) {await close();continue;}
        watchers.set(id,{revision,abort,close});
      } catch(e) {abort.abort(); report(e);} finally { clearTimeout(setupDeadline); }
    }
  }
  function tick() { if(!reconciling) reconciling=reconcile().finally(()=>{reconciling=undefined;}); return reconciling; }
  async function process(id:string,external:AbortSignal) {
    const abort=new AbortController();
    const signal=AbortSignal.any([external,controller.signal,abort.signal,AbortSignal.timeout(120_000)]);
    signal.throwIfAborted();
    const work=await sourceStore.beginSync(id); if(!work) return;
    const active={revision:`${work.source.revision}:${work.connection.revision}`,abort};
    activeCollections.set(work.source.id,active);
    try {await serialize(work.source.id,async()=>{
    try {
      const batch=await clientFor(work.connection.adapter).collect(work.connection,work.source,work.state.checkpoint,signal);
      signal.throwIfAborted();
      for(const input of batch.items) await publish(work.source,work.connection,input,signal);
      signal.throwIfAborted();
      await sourceStore.finishSync(id,{ok:true,checkpoint:batch.checkpoint,count:batch.items.length,gap:batch.gap});
    } catch(e) {
      const failure=safeFailure(e);
      await sourceStore.finishSync(id,{ok:false,code:failure.code,message:failure.message,...(failure.retryAfterMs!==undefined ? {retryAfterMs:failure.retryAfterMs}:{})});
      report(failure);
    }
    });} finally {if(activeCollections.get(work.source.id)===active) activeCollections.delete(work.source.id);}
  }
  return {
    async start() {
      if(started) return; if(controller.signal.aborted) throw new Error("Source module is closed");
      started=true;
      void tick().catch(report);
      timer=setInterval(()=>{void tick().catch(report);},interval); timer.unref();
    },
    async processSync(id:string,signal:AbortSignal) { const job=process(id,signal); jobs.add(job); try {await job;} finally {jobs.delete(job);} },
    async requestSync(sourceId:string,key:string) {return sourceStore.requestSync(sourceId,key);},
    async probe(connectionId:string,external=controller.signal) {
      const connection=await store.getResource("connections",connectionId);
      if(!connection || !connection.enabled) throw new AppError("connection_disabled","Connection is missing or disabled",409);
      return clientFor(connection.adapter).probe(connection,AbortSignal.any([controller.signal,external,AbortSignal.timeout(30_000)]));
    },
    async discover(connectionId:string,external=controller.signal,limit=100) {
      if(!Number.isInteger(limit)||limit<1||limit>1000) throw new AppError("invalid_input","Discovery limit must be 1–1000",400);
      const connection=await store.getResource("connections",connectionId);
      if(!connection || !connection.enabled) throw new AppError("connection_disabled","Connection is missing or disabled",409);
      const client=clientFor(connection.adapter); if(!client.discover) throw new AppError("unsupported","This adapter does not support discovery",400);
      return client.discover(connection,AbortSignal.any([controller.signal,external,AbortSignal.timeout(30_000)]),limit);
    },
    async close() {
      controller.abort(); if(timer) clearInterval(timer);
      for(const w of watchers.values()) w.abort.abort();
      await reconciling?.catch(report);
      await Promise.allSettled([...watchers.values()].map(w=>w.close())); watchers.clear();
      await Promise.allSettled([...jobs]);
      await Promise.allSettled([...publicationTails.values()]);
      await Promise.allSettled([...new Set(Object.values(clients))].filter(c=>c!==undefined).map(c=>c.close()));
    },
  };
}
