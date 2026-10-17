import { test } from "bun:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createSourceModule } from "../src/sources/index.js";
import { SourceFailure, type SourceClient, type SourceClients, type SourceOutcome, type SourceStore, type WatchedSource, type Connection } from "../src/sources/contracts.js";
import type { AppStore, InputDraft } from "../src/contracts.js";
const connection:Connection={id:'c',revision:1,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',enabled:true,label:'Test feed',adapter:'test-source'};
const source:WatchedSource={id:'s',revision:1,createdAt:connection.createdAt,updatedAt:connection.updatedAt,enabled:true,name:'News',kind:'adapter',watch:{connectionId:'c',target:'@news',pollIntervalMs:10_000}};
const input:InputDraft={sourceItemId:'1',kind:'message',text:'News',publishedAt:null};
function fixture(overrides:Partial<SourceClient>={}) {
  const events:string[]=[],outcomes:SourceOutcome[]=[],admissions:unknown[][]=[];
  const sourceStore={async beginSync(){return {request:{id:'r',sourceId:'s',status:'running',createdAt:source.createdAt,error:null},source,connection,state:{sourceId:'s',checkpoint:{id:'old'},status:'running',nextRunAt:null,lastSuccessAt:null,lastError:null,lastCount:0,gap:false}};},async finishSync(_id:string,o:SourceOutcome){events.push('finish');outcomes.push(o);},async scheduleDue(){events.push('schedule');},async status(){return {status:'idle',checkpoint:{targetId:'1'}};}} as unknown as SourceStore;
  const store={async acceptInput(...args:unknown[]){events.push('admit');admissions.push(args);},async listResources(){return {items:[source],nextCursor:null};},async getResource(){return connection;}} as unknown as AppStore;
  const client:SourceClient={async probe(){return {identity:'me'};},async collect(_c,_s,checkpoint){assert.deepEqual(checkpoint,{id:'old'});events.push('collect');return {items:[input],checkpoint:{id:'new'},gap:false};},async close(){events.push('close');},...overrides};
  const clients:SourceClients={'test-source':client},errors:unknown[]=[];
  const module=createSourceModule({store,sourceStore,clients,intervalMs:100,onError:error=>errors.push(error)});
  return {module,store,sourceStore,client,clients,errors,events,outcomes,admissions};
}
test('source worker admits the full batch with configuration guards before advancing checkpoint',async()=>{
  const f=fixture();await f.module.processSync('r',new AbortController().signal);
  assert.deepEqual(f.events,['collect','admit','finish']);assert.deepEqual(f.outcomes,[{ok:true,checkpoint:{id:'new'},count:1,gap:false}]);
  assert.deepEqual(f.admissions[0]![3],{sourceRevision:1,connectionId:'c',connectionRevision:1});await f.module.close();assert.equal(f.events.filter(e=>e==='close').length,1);
});
test('failed batch admission preserves checkpoint and reports only safe errors',async()=>{
  const f=fixture();f.store.acceptInput=async()=>{throw new Error('secret-cookie-value');};
  await f.module.processSync('r',new AbortController().signal);assert.equal(f.outcomes[0]!.ok,false);assert.ok(!JSON.stringify(f.outcomes).includes('secret-cookie-value'));await f.module.close();
});
test('authentication and rate limits remain typed for store pause/backoff',async()=>{
  for(const code of ['authentication','rate_limit'] as const) { const f=fixture({async collect(){throw new SourceFailure(code,'provider secret',42_000);}});await f.module.processSync('r',new AbortController().signal);assert.deepEqual(f.outcomes,[{ok:false,code,message:`Source collection failed (${code})`,retryAfterMs:42_000}]);await f.module.close(); }
});
test('watchers detach on source disable and late live events retain guarded admission',async()=>{
  let enabled=true, closed=0, publish:((input:InputDraft)=>Promise<void>)|undefined;
  const f=fixture({async watch(_c,_s,p){publish=p;return async()=>{closed++;};}});
  f.store.listResources=async()=>({items:[{...source,enabled}],nextCursor:null}) as never;
  await f.module.start();await delay(20);await publish!(input);assert.equal(f.admissions.length,1);enabled=false;await delay(130);assert.equal(closed,1);await assert.rejects(publish!(input));await f.module.close();
});
test('source reconciliation follows pagination beyond the first 200 sources',async()=>{
  let pages=0,watches=0;const f=fixture({async watch(){watches++;return async()=>{};}});
  f.store.listResources=async(_kind,opts)=>{pages++;return {items:[{...source,id:opts?.cursor ? 's2':'s1'}],nextCursor:opts?.cursor ? null:'next'} as never;};
  await f.module.start();await delay(20);assert.equal(pages,2);assert.equal(watches,2);await f.module.close();
});
test('invalidated live leases detach and reconcile, including a failure during initial setup',async()=>{
  let watchCount=0,closed=0,invalidate:((error:SourceFailure)=>void)|undefined;
  const f=fixture({async watch(_c,_s,_p,_signal,onFailure){watchCount++;invalidate=onFailure;if(watchCount===1)onFailure!(new SourceFailure('transport','session invalidated during setup'));return async()=>{closed++;};}});
  await f.module.start();await delay(20);assert.equal(closed,1,'failed initial setup is not retained');
  await delay(120);assert.equal(watchCount,2);invalidate!(new SourceFailure('transport','session destroyed'));
  await delay(10);assert.equal(closed,2);
  await delay(120);assert.equal(watchCount,3);await f.module.close();assert.equal(closed,3);
});
test('adapter watch preparation defers attachment and rebinds when its key changes',async()=>{
  let checkpoint:null|{targetId:string}=null;const targets:string[]=[];let closed=0;
  const f=fixture({prepareWatch(_c,s,checkpoint){return typeof checkpoint?.targetId==='string' ? {source:{...s,revision:99,watch:{...s.watch,target:checkpoint.targetId}},key:checkpoint.targetId}:null;},async watch(_c,s,p){targets.push(s.watch.target);await p(input);return async()=>{closed++;};}});
  f.sourceStore.status=async()=>({sourceId:'s',checkpoint,status:'idle',nextRunAt:null,lastSuccessAt:null,lastError:null,lastCount:0,gap:false});
  await f.module.start();await delay(20);assert.deepEqual(targets,[],'unresolved alias cannot attach to a possibly reassigned peer');
  checkpoint={targetId:'-100111'};await delay(120);assert.deepEqual(targets,['-100111']);
  checkpoint={targetId:'-100222'};await delay(120);assert.deepEqual(targets,['-100111','-100222']);assert.equal(closed,1);assert.deepEqual(f.admissions[0]![3],{sourceRevision:1,connectionId:'c',connectionRevision:1});
  checkpoint=null;await delay(120);assert.equal(closed,2,'deferred preparation detaches the old lease');await f.module.close();
});
test('reconciliation aborts a collection when its source is disabled',async()=>{
  let enabled=true,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});
  const f=fixture({async collect(_c,_s,_checkpoint,signal){entered();await new Promise<void>((_r,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});throw new Error('unreachable');}});
  f.store.listResources=async()=>({items:[{...source,enabled}],nextCursor:null}) as never;
  await f.module.start();const pending=f.module.processSync('r',new AbortController().signal);await started;enabled=false;await pending;
  assert.equal(f.admissions.length,0);assert.equal(f.outcomes[0]!.ok,false);await f.module.close();
});

test('missing installed clients fail safely without stopping reconciliation of other sources',async()=>{
  let watches=0;const f=fixture({async watch(){watches++;return async()=>{};}});
  f.store.listResources=async()=>({items:[{...source,id:'missing',watch:{...source.watch,connectionId:'missing'}},source],nextCursor:null}) as never;
  f.store.getResource=async(_kind,id)=>({...connection,adapter:id==='missing' ? 'uninstalled':'test-source'}) as never;
  await f.module.start();await delay(20);assert.equal(watches,1);assert.equal((f.errors[0] as SourceFailure).code,'configuration');
  delete f.clients['test-source'];await f.module.processSync('r',new AbortController().signal);
  assert.deepEqual(f.outcomes,[{ok:false,code:'configuration',message:'Source collection failed (configuration)'}]);
  await assert.rejects(f.module.probe('missing'),{code:'configuration'});await assert.rejects(f.module.discover('missing'),{code:'configuration'});await f.module.close();
});
test('push sources do not attach a polling live lease',async()=>{
  let watches=0;const f=fixture({async watch(){watches++;return async()=>{};}});
  f.store.listResources=async()=>({items:[{...source,watch:{...source.watch,mode:'push'}}],nextCursor:null}) as never;
  await f.module.start();await delay(20);assert.equal(watches,0);assert.ok(f.events.includes('schedule'));await f.module.close();
});
test('partial batch admission fails the work without committing the new checkpoint',async()=>{
  const f=fixture({async collect(){return {items:[input,{...input,sourceItemId:'2'}],checkpoint:{id:'new'},gap:false};}});
  let admitted=0;f.store.acceptInput=async()=>{if(++admitted===2)throw new Error('second item rejected');return {} as never;};
  await f.module.processSync('r',new AbortController().signal);assert.equal(admitted,2);assert.equal(f.outcomes[0]!.ok,false);assert.equal('checkpoint' in f.outcomes[0]!,false);await f.module.close();
});
