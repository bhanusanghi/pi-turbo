import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SQL } from 'bun';
import { Type } from 'typebox';
import { createSourceCatalog } from '../src/sources/catalog.js';
import type { InputDraft } from '../src/contracts.js';
import { createStore } from '../src/storage/index.js';
import { createSourceStore } from '../src/sources/store.js';
const url=process.env.TEST_DATABASE_URL;
const key=()=>randomUUID();
// Deliberately test-authored policy: core behavior must not require leaf imports.
const catalog=(acceptsRevision?:(previous:InputDraft,incoming:InputDraft)=>boolean)=>createSourceCatalog([{
  id:'test-source',connectionSchema:Type.Object({label:Type.String(),enabled:Type.Boolean(),adapter:Type.Literal('test-source')},{additionalProperties:false}),
  validateWatch(_connection,watch){if(watch.target==='forbidden')throw new Error('Target unavailable');},
  acceptsRevision:acceptsRevision ?? ((previous,incoming)=>{
    const latestTime=previous.provenance?.editedAt ?? previous.publishedAt;
    const incomingTime=incoming.provenance?.editedAt ?? incoming.publishedAt;
    return !(previous.deleted===true && incoming.deleted!==true) && !(incoming.deleted!==true && latestTime && (!incomingTime || Date.parse(incomingTime)<Date.parse(latestTime)));
  }),
}]);
test.skipIf(!url)('source store: migration, coalescing, checkpoint guards, per-connection serialization, pause and recovery',async()=>{
  const admin=new SQL(url!); const schema=`source_test_${key().replaceAll('-','')}`; await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const isolated=new URL(url!);isolated.searchParams.set('options',`-c search_path=${schema}`);
  const store=createStore(isolated.toString(),catalog()),sources=createSourceStore(isolated.toString(),store);
  try {
    await store.migrate();await store.migrate();
    const c=await store.createResource('connections',{label:'Test feed',enabled:true,adapter:'test-source'},key());
    const make=()=>store.createResource('sources',{name:key(),enabled:true,kind:'adapter',watch:{connectionId:c.id,target:'@news',pollIntervalMs:10000}},key());
    const s=await make(),s2=await make();
    await assert.rejects(store.createResource('sources',{name:'Denied',enabled:true,kind:'adapter',watch:{connectionId:c.id,target:'forbidden',pollIntervalMs:10000}},key()));
    const pushed=await store.createResource('sources',{name:'Push',enabled:true,kind:'adapter',watch:{connectionId:c.id,target:'inbound',mode:'push',pollIntervalMs:10000}},key());
    await assert.rejects(sources.requestSync(pushed.id,key()),{code:'source_disabled'});
    await sources.scheduleDue();
    for(const dispatch of await store.pendingDispatches(1000)) if(dispatch.queue==='source.sync') assert.notEqual((await sources.getSync(dispatch.recordId))!.sourceId,pushed.id,'push source has no poll dispatch');
    await assert.rejects(store.createResource('connections',{label:'Test',enabled:true,adapter:'test-source',unknown:'forbidden'} as never,key()));
    await assert.rejects(store.updateResource('sources',s.id,{watch:{...s.watch!,target:'@different'}},key()),{code:'immutable_source'});
    await assert.rejects(store.updateResource('connections',c.id,{adapter:'other-source'} as never,key()));
    const [a,b]=await Promise.all([sources.requestSync(s.id,key()),sources.requestSync(s.id,key())]);assert.equal(a.id,b.id);
    const work=await sources.beginSync(a.id);assert.ok(work);assert.equal(work.state.checkpoint,null);assert.equal(await sources.beginSync(a.id),null);
    const other=await sources.requestSync(s2.id,key());assert.equal(await sources.beginSync(other.id),null,'same connection cannot collect in parallel');
    assert.ok(Number((await admin.unsafe<{count:string}[]>(`SELECT count(*)::text AS count FROM ${schema}.pm_dispatches WHERE queue='source.sync' AND record_id=$1`,[other.id]))[0]!.count)>=2,'busy request is re-dispatched');
    await store.acceptInput(s.id,{sourceItemId:'1',kind:'message',publishedAt:null,text:'a'},key(),{sourceRevision:s.revision,connectionId:c.id,connectionRevision:c.revision});
    await sources.finishSync(a.id,{ok:true,checkpoint:{lastId:'1'},count:1,gap:false});assert.deepEqual((await sources.status(s.id)).checkpoint,{lastId:'1'});
    await sources.beginSync(other.id);await sources.finishSync(other.id,{ok:false,code:'authentication',message:'Authentication required'});
    assert.equal((await sources.status(s.id)).status,'auth_required');
    const before=(await store.pendingDispatches(1000)).length;await sources.scheduleDue();assert.equal((await store.pendingDispatches(1000)).length,before);
    const retried=await sources.requestSync(s.id,key());assert.ok(await sources.beginSync(retried.id));
    await sources.finishSync(retried.id,{ok:false,code:'rate_limit',message:'Wait',retryAfterMs:172800000});
    assert.ok(Date.parse((await sources.status(s.id)).nextRunAt!)>Date.now()+86400000);
    const duringBackoff=await sources.requestSync(s.id,key());assert.equal(await sources.beginSync(duringBackoff.id),null,'manual sync respects provider backoff');
    const updatedConnection=await store.updateResource('connections',c.id,{label:'credential revision'},key());
    const run=await sources.requestSync(s.id,key());assert.ok(await sources.beginSync(run.id));
    const updatedSource=await store.updateResource('sources',s.id,{name:'new config'},key());
    await assert.rejects(store.acceptInput(s.id,{sourceItemId:'2',kind:'message',publishedAt:null,text:'late'},key(),{sourceRevision:s.revision,connectionId:c.id,connectionRevision:updatedConnection.revision}),{code:'source_changed'});
    await sources.finishSync(run.id,{ok:true,checkpoint:{lastId:'old-config'},count:1,gap:false});assert.deepEqual((await sources.status(s.id)).checkpoint,{lastId:'1'});
    const followup=(await store.pendingDispatches(1000)).filter(d=>d.queue==='source.sync'); let active;
    for(const d of followup){const r=await sources.getSync(d.recordId);if(r?.sourceId===s.id && r.status==='queued')active=r;}
    assert.ok(active);const next=await sources.beginSync(active.id);assert.equal(next!.source.revision,updatedSource.revision);
    await sources.recoverRunning();assert.equal((await sources.getSync(active.id))!.status,'queued');assert.ok(await sources.beginSync(active.id));
    await sources.finishSync(active.id,{ok:true,checkpoint:{lastId:'3'},count:2,gap:true});assert.equal((await sources.status(s.id)).status,'gap');
    await store.updateResource('sources',s.id,{enabled:false},key());
    await assert.rejects(store.acceptInput(s.id,{sourceItemId:'late',kind:'message',publishedAt:null,text:'late'},key(),{sourceRevision:updatedSource.revision,connectionId:c.id,connectionRevision:updatedConnection.revision}),{code:'disabled'});
    assert.equal((await sources.status(s.id)).status,'disabled');
    const deleted=await store.acceptInput(s2.id,{sourceItemId:'d',kind:'message',publishedAt:null,text:'',deleted:true,provenance:{provider:'test-source',targetId:'peer',messageId:'d'}},key());assert.equal((await store.getInput(deleted.inputId))!.revisions[0]!.deleted,true);
    await assert.rejects(store.acceptInput(s2.id,{sourceItemId:'d2',kind:'message',publishedAt:null,text:'text',provenance:{provider:'test-source',targetId:'peer',messageId:'d',secret:'forbidden'}} as never,key()));
  } finally {await sources.close();await store.close();await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);await admin.close();}
},30000);

test.skipIf(!url)('source history/live ordering, registered revision ordering and queued-dispatch recovery',async()=>{
  const {createSourceModule}=await import('../src/sources/index.js');
  const admin=new SQL(url!);const schema=`source_order_${key().replaceAll('-','')}`;await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const isolated=new URL(url!);isolated.searchParams.set('options',`-c search_path=${schema}`);
  const store=createStore(isolated.toString(),catalog()),sources=createSourceStore(isolated.toString(),store);
  let module:ReturnType<typeof createSourceModule>|undefined;
  try {
    await store.migrate();
    const c=await store.createResource('connections',{label:'Test feed',enabled:true,adapter:'test-source'},key());
    const s=await store.createResource('sources',{name:'News',enabled:true,kind:'adapter',watch:{connectionId:c.id,target:'@news',pollIntervalMs:10000}},key());
    const p=await store.createResource('portfolios',{name:'Positions',enabled:true,accountIds:[]},key());
    const monitor=await store.createResource('monitors',{name:'Watch',enabled:true,portfolioId:p.id,sourceIds:[s.id],destinationIds:[]},key());
    type Draft=import('../src/contracts.js').InputDraft;
    type Batch=import('../src/sources/contracts.js').SourceBatch;
    let live:((input:Draft)=>Promise<void>)|undefined;
    let invalidate:((error:import('../src/sources/contracts.js').SourceFailure)=>void)|undefined;
    let deliver!:(batch:Batch)=>void,fail!:(error:Error)=>void,entered!:()=>void;
    let enteredPromise=Promise.resolve();
    function deferred(){enteredPromise=new Promise<void>(r=>{entered=r;});return new Promise<Batch>((r,j)=>{deliver=r;fail=j;});}
    let collection=deferred();
    const client:import('../src/sources/contracts.js').SourceClient={async probe(){return {identity:'me'};},async collect(){entered();return collection;},async watch(_c,_s,p,_signal,onFailure){live=p;invalidate=onFailure;return async()=>{};},async close(){}};
    const bootstrap=await sources.requestSync(s.id,key());await sources.beginSync(bootstrap.id);await sources.finishSync(bootstrap.id,{ok:true,checkpoint:{targetId:'1'},count:0,gap:false});
    module=createSourceModule({store,sourceStore:sources,clients:{'test-source':client},intervalMs:10000});
    await module.start();
    for(let i=0;i<100 && !live;i++) await new Promise(r=>setTimeout(r,5));assert.ok(live);
    const message=(id:string,text:string,revision:string,editedAt?:string):Draft=>({sourceItemId:id,kind:'message',text,publishedAt:'2026-01-01T00:00:00Z',sourceRevision:revision,provenance:{provider:'test-source',targetId:'1',messageId:id,...(editedAt ? {editedAt}:{})}});
    const history=message('1','history','history','2026-01-01T00:00:01Z');
    const edit=message('1','live edit same second','edit','2026-01-01T00:00:01Z');
    const r=await sources.requestSync(s.id,key());const running=module.processSync(r.id,new AbortController().signal);await enteredPromise;
    const edited=live!(edit);await Promise.resolve();assert.equal((await store.listInputs({sourceId:s.id})).items.length,0,'live publication waits while history is outstanding');
    deliver({items:[history],checkpoint:{last:'1',targetId:'1'},gap:false});await running;await edited;
    let inputs=(await store.listInputs({sourceId:s.id})).items;assert.deepEqual(inputs.map(i=>i.text),['history','live edit same second']);
    let evaluations=(await store.listEvaluations({monitorId:monitor.id})).items;assert.deepEqual(evaluations.map(e=>e.trigger.kind==='input' ? e.trigger.revisionId:null),inputs.map(i=>i.id));
    const stale=await store.acceptInput(s.id,message('1','older history','older','2026-01-01T00:00:00Z'),key());assert.equal(stale.duplicate,true);assert.deepEqual(stale.evaluationIds,[]);assert.equal((await store.listInputs({sourceId:s.id})).items.length,2);
    collection=deferred();const r2=await sources.requestSync(s.id,key());const running2=module.processSync(r2.id,new AbortController().signal);await enteredPromise;
    const deletion:Draft={sourceItemId:'2',kind:'message',text:'',deleted:true,publishedAt:null,sourceRevision:'deleted',provenance:{provider:'test-source',targetId:'1',messageId:'2'}};
    const deleted=live!(deletion);deliver({items:[message('2','history before deletion','before-delete')],checkpoint:{last:'2',targetId:'1'},gap:false});await running2;await deleted;
    inputs=(await store.listInputs({sourceId:s.id})).items;assert.deepEqual(inputs.slice(-2).map(i=>[i.text,i.deleted===true]),[['history before deletion',false],['',true]]);
    const resurrection=await store.acceptInput(s.id,message('2','impossible resurrection','resurrection','2026-01-02T00:00:00Z'),key());assert.equal(resurrection.duplicate,true);assert.deepEqual(resurrection.evaluationIds,[]);assert.equal((await store.getInput(resurrection.inputId))!.revisions.at(-1)!.deleted,true);
    collection=deferred();const r3=await sources.requestSync(s.id,key());const running3=module.processSync(r3.id,new AbortController().signal);await enteredPromise;
    const afterFailure=live!(message('3','live survives failed history','survives'));
    const {SourceFailure}=await import('../src/sources/contracts.js');invalidate!(new SourceFailure('transport','session invalidated'));fail(new Error('history unavailable'));await running3;await afterFailure;
    assert.deepEqual((await sources.status(s.id)).checkpoint,{last:'2',targetId:'1'});assert.equal((await store.listInputs({sourceId:s.id})).items.at(-1)!.text,'live survives failed history');
    collection=deferred();const partial=await sources.requestSync(s.id,key());const partialRun=module.processSync(partial.id,new AbortController().signal);await enteredPromise;
    deliver({items:[message('4','accepted prefix','prefix'),{...message('5','rejected suffix','suffix'),text:''}],checkpoint:{last:'5',targetId:'1'},gap:false});await partialRun;
    assert.deepEqual((await sources.status(s.id)).checkpoint,{last:'2',targetId:'1'},'partial admission cannot advance the history checkpoint');
    assert.equal((await store.listInputs({sourceId:s.id})).items.at(-1)!.text,'accepted prefix');
    const queued=await sources.requestSync(s.id,key());
    for(const d of await store.pendingDispatches(1000)) if(d.queue==='source.sync' && d.recordId===queued.id) await store.markDispatched(d.id);
    assert.equal((await store.pendingDispatches(1000)).filter(d=>d.recordId===queued.id).length,0);
    await sources.recoverRunning();await sources.recoverRunning();assert.equal((await store.pendingDispatches(1000)).filter(d=>d.recordId===queued.id).length,1,'startup republishes stranded queued work once');
    assert.ok(await sources.beginSync(queued.id));await sources.finishSync(queued.id,{ok:true,checkpoint:{last:'3'},count:0,gap:false});
  }finally{await module?.close();await sources.close();await store.close();await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);await admin.close();}
},30000);

test.skipIf(!url)('registered revision policy runs after acquiring the canonical item transaction lock',async()=>{
  const admin=new SQL(url!);const schema=`source_lock_${key().replaceAll('-','')}`;await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const isolated=new URL(url!);isolated.searchParams.set('options',`-c search_path=${schema}`);
  const calls:[InputDraft,InputDraft][]=[];
  const store=createStore(isolated.toString(),catalog((previous,incoming)=>{calls.push([previous,incoming]);return false;}));
  const blocker=new SQL(isolated.toString());
  let unlock!:()=>void,locked!:()=>void;const released=new Promise<void>(r=>{unlock=r;}),held=new Promise<void>(r=>{locked=r;});
  let holding:Promise<unknown>|undefined;
  try {
    await store.migrate();const c=await store.createResource('connections',{label:'Test',enabled:true,adapter:'test-source'},key());
    const source=await store.createResource('sources',{name:'Policy',enabled:true,kind:'adapter',watch:{connectionId:c.id,target:'topic',pollIntervalMs:10000}},key());
    const original:InputDraft={sourceItemId:'locked',kind:'message',text:'current',publishedAt:null,sourceRevision:'current',provenance:{provider:'arbitrary-metadata',targetId:'topic',messageId:'locked'}};
    const receipt=await store.acceptInput(source.id,original,key());
    holding=blocker.begin(async tx=>{await tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`input:${source.id}:locked`]);locked();await released;});await held;
    let settled=false;const pending=store.acceptInput(source.id,{...original,text:'stale',sourceRevision:'stale'},key()).finally(()=>{settled=true;});
    await new Promise(r=>setTimeout(r,40));assert.equal(settled,false);assert.equal(calls.length,0,'policy must wait for the item lock');
    unlock();await holding;const stale=await pending;
    assert.equal(calls.length,1);assert.equal(calls[0]![0].text,'current');assert.equal(calls[0]![1].text,'stale');
    assert.equal(stale.revisionId,receipt.revisionId);assert.equal(stale.duplicate,true);assert.deepEqual(stale.evaluationIds,[]);assert.equal((await store.getInput(receipt.inputId))!.revisions.length,1);
  } finally {unlock();await holding;await blocker.close();await store.close();await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);await admin.close();}
},30000);
