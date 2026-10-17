import { fixtureSource } from "./fixtures/source.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { Queue } from "bullmq";
import { createApplication } from "../src/application.js";
import { SourceFailure, type SourceClient } from "../src/sources/contracts.js";
const databaseUrl = process.env.TEST_DATABASE_URL, redisUrl = process.env.TEST_REDIS_URL;
async function eventually(read:()=>Promise<any>, accept:(x:any)=>boolean) {
  const end=Date.now()+15000;
  while(Date.now()<end) {const x=await read();if(accept(x))return x;await Bun.sleep(25);}
  assert.fail("Timed out waiting for source processing");
}
test.skipIf(!databaseUrl || !redisUrl)("sources: authenticated API → source queue → ingress/database → pending evaluation", async () => {
  const dbName=`pm_sources_${randomUUID().replaceAll("-","")}`, prefix=`sources-${randomUUID()}`;
  const admin=new SQL(databaseUrl!);await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url=new URL(databaseUrl!);url.pathname=`/${dbName}`;
  let calls=0, mode:"ok"|"auth"="ok";
  const client:SourceClient={
    async probe() {return {identity:"fixture-account"};}, async discover(){return [{id:"-100123",label:"Fixture channel"}];},
    async collect(_connection,source,checkpoint,signal) {
      signal.throwIfAborted();calls++;
      if(mode==="auth") throw new SourceFailure("authentication","fixture credential rejected");
      return {items:[{sourceItemId:"post-1",kind:"message",sourceRevision:"1",text:"Fixture market event",publishedAt:new Date().toISOString(),
        provenance:{provider:"fixture",targetId:source.watch.target,messageId:"post-1"}}], checkpoint:{afterId:"post-1"}, gap:false};
    },async close(){},
  };
  // Published time must remain stable on repeated reads, just as a provider timestamp does.
  const originalCollect=client.collect;let timestamp:string|undefined;
  client.collect=async(...args)=>{const batch=await originalCollect(...args);timestamp ??= batch.items[0]!.publishedAt!;batch.items[0]!.publishedAt=timestamp;return batch;};
  const app=createApplication({databaseUrl:url.href,redisUrl:redisUrl!,apiToken:"fixture-source-api-token-long",host:"127.0.0.1",port:8787,queuePrefix:prefix,refreshIntervalMs:60000,dispatchIntervalMs:25},
    {sourceExtensions:[fixtureSource],sourceClients:{"fixture-source":client},portfolioProvider:{async read(){throw new Error("No account expected");},async subscribe(){return async()=>{};},async subAccounts(){return [];},async close(){}}});
  const request=async(method:"GET"|"POST"|"PATCH",path:string,payload?:object,expected=method==="POST"?201:200)=>{
    const response=await app.http.inject({method,url:path,headers:{authorization:"Bearer fixture-source-api-token-long","idempotency-key":randomUUID()},...(payload?{payload}:{})});
    assert.equal(response.statusCode,expected,`${method} ${path}: ${response.body}`);return response.json();
  };
  try {
    await app.start(false);
    assert.equal((await app.http.inject({url:"/v1/connections"})).statusCode,401);
    const connection=await request("POST","/v1/connections",{label:"Personal",adapter:"fixture-source",secretRef:"X_SESSION",enabled:true});
    assert.deepEqual(await request("POST",`/v1/connections/${connection.id}/probe`,undefined,200),{identity:"fixture-account"});
    const source=await request("POST","/v1/sources",{name:"Fixture feed",kind:"adapter",enabled:false,watch:{connectionId:connection.id,target:"news",pollIntervalMs:60000}});
    const portfolio=await request("POST","/v1/portfolios",{name:"Portfolio",enabled:true,accountIds:[]});
    const monitor=await request("POST","/v1/monitors",{name:"Pending evaluator",enabled:true,portfolioId:portfolio.id,sourceIds:[source.id],destinationIds:[]});
    await request("PATCH",`/v1/sources/${source.id}`,{enabled:true});
    const run=await request("POST",`/v1/sources/${source.id}/sync`,undefined,202);
    await eventually(()=>request("GET",`/v1/source-syncs/${run.id}`),x=>x.status==="completed");
    assert.equal((await request("GET",`/v1/inputs?sourceId=${source.id}`)).items.length,1);
    const state=await request("GET",`/v1/sources/${source.id}/status`);assert.deepEqual(state.checkpoint,{afterId:"post-1"});assert.ok(state.lastSuccessAt);
    const evaluations=await request("GET",`/v1/evaluations?monitorId=${monitor.id}`);assert.equal(evaluations.items.length,1);assert.equal(evaluations.items[0].status,"awaiting_evaluator");
    const second=await request("POST",`/v1/sources/${source.id}/sync`,undefined,202);
    await eventually(()=>request("GET",`/v1/source-syncs/${second.id}`),x=>x.status==="completed");
    assert.equal((await request("GET",`/v1/evaluations?monitorId=${monitor.id}`)).items.length,1,"overlap does not queue duplicate evaluations");
    mode="auth";
    const failed=await request("POST",`/v1/sources/${source.id}/sync`,undefined,202);
    await eventually(()=>request("GET",`/v1/source-syncs/${failed.id}`),x=>x.status==="failed");
    assert.equal((await request("GET",`/v1/sources/${source.id}/status`)).status,"auth_required");
    await request("PATCH",`/v1/connections/${connection.id}`,{enabled:false});
    assert.equal((await request("GET",`/v1/sources/${source.id}/status`)).status,"disabled");
    assert.equal((await app.http.inject({method:"POST",url:`/v1/sources/${source.id}/sync`,headers:{authorization:"Bearer fixture-source-api-token-long","idempotency-key":randomUUID()}})).statusCode,409);
    const qs=await request("GET","/v1/queues");assert.equal(qs.queues.find((q:any)=>q.name==="evaluation.run").paused,true);
    assert.ok(calls>=3);
  } finally {
    await app.close();
    for(const name of ["source.sync","evaluation.run","portfolio.refresh","notification.deliver"]) {const q=new Queue(name,{connection:{url:redisUrl!},prefix});try{await q.obliterate({force:true});}finally{await q.close();}}
    await admin.unsafe(`DROP DATABASE ${dbName} WITH (FORCE)`);await admin.close();
  }
},30000);
