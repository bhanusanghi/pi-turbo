import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { Queue } from "bullmq";
import { createStore } from "../src/storage/index.js";
import { createApplication } from "../src/application.js";
import { createDeliveryModule } from "../src/delivery/index.js";
import type { Account, AccountObservation } from "../src/contracts.js";

const databaseUrl = process.env.TEST_DATABASE_URL, redisUrl = process.env.TEST_REDIS_URL;
const key = () => randomUUID();
const idle = new AbortController().signal;
const accountDraft = { label:"Recovery",address:`0x${"1".repeat(40)}`,network:"testnet" as const,perpDexs:"all" as const,enabled:true };
const notification = (destinationId: string) => ({ destinationId,origin:"operator_test" as const,content:{title:"Recovery",body:"Substituted external transport"} });
function observation(account: Account): AccountObservation {
  const at = new Date().toISOString();
  return { accountId:account.id,address:account.address,network:account.network,startedAt:at,completedAt:at,
    positions:[],accountMode:"default",accountFacts:{},coverage:[{part:"spot",status:"complete",receivedAt:at}],issues:[],exposureHash:"empty",raw:{} };
}
async function isolated(run: (url: string, sql: SQL) => Promise<void>) {
  const admin = new SQL(databaseUrl!);
  const name = `pm_recovery_${key().replaceAll("-","")}`;
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(databaseUrl!); url.pathname = `/${name}`;
  const sql = new SQL(url.href);
  try { await run(url.href,sql); }
  finally { await sql.close(); await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`); await admin.close(); }
}
async function eventually<T>(read: () => Promise<T>, accept: (x: T) => boolean): Promise<T> {
  const until = Date.now()+10000;
  do { const value = await read(); if (accept(value)) return value; await Bun.sleep(20); } while (Date.now()<until);
  assert.fail("Recovery did not complete before deadline");
}

test.skipIf(!databaseUrl)("startup recovery requeues reads, preserves retry deadlines and never requeues an interrupted send", async () => isolated(async (url,sql) => {
  let store = createStore(url);
  try {
    await store.migrate();
    const account = await store.createResource("accounts",accountDraft,key());
    const run = await store.requestRefresh(account.id,"before shutdown",key());
    await store.beginRefresh(run.id);
    await store.requestRefresh(account.id,"coalesced change",key());
    const disabled = await store.createResource("accounts",{...accountDraft,label:"Disabled"},key());
    const disabledRun = await store.requestRefresh(disabled.id,"before disable",key());
    await store.beginRefresh(disabledRun.id);
    await store.updateResource("accounts",disabled.id,{enabled:false},key());
    const destination = await store.createResource("destinations",{label:"Preview",adapter:"preview",enabled:true},key());
    const interrupted = await store.requestNotification(notification(destination.id),key());
    await store.beginDelivery(interrupted.id,"Text rendered before interruption");
    const retry = await store.requestNotification(notification(destination.id),key());
    await store.beginDelivery(retry.id,"Retry text");
    const delayed = await store.finishDelivery(retry.id,{status:"retry",error:"Confirmed rejection",retryAfterMs:60000});
    const terminal = await store.requestNotification(notification(destination.id),key());
    await store.beginDelivery(terminal.id,"Preview");
    const finished = await store.finishDelivery(terminal.id,{status:"previewed",receipt:{provider:"preview",text:"Preview"}});
    // Simulate publication followed by process loss before its worker settles.
    await sql.unsafe("UPDATE pm_dispatches SET dispatched_at=clock_timestamp()");
    await store.close(); store = createStore(url);
    await store.recoverWork(); await store.recoverWork();
    assert.equal((await store.getRefresh(run.id))!.status,"queued");
    assert.equal((await store.getRefresh(run.id))!.dirty,false);
    const unknown = (await store.getDelivery(interrupted.id))!;
    assert.equal(unknown.status,"unknown"); assert.equal(unknown.attempts,1);
    assert.equal(unknown.renderedText,"Text rendered before interruption");
    assert.equal((await store.getDelivery(retry.id))!.nextAttemptAt,delayed.nextAttemptAt);
    assert.deepEqual(await store.getDelivery(terminal.id),finished);
    const pending = await sql.unsafe<{record_id:string;available_at:Date}[]>("SELECT record_id,available_at FROM pm_dispatches WHERE dispatched_at IS NULL");
    assert.equal(pending.length,3,"one dispatch per active read or known-unattempted send, even after repeat recovery");
    assert.equal(pending.filter(d=>d.record_id===run.id).length,1);
    assert.equal(pending.find(d=>d.record_id===retry.id)!.available_at.toISOString(),delayed.nextAttemptAt);
    assert.ok(!pending.some(d=>d.record_id===interrupted.id));
    const resolved = await store.reconcileDelivery(interrupted.id,{outcome:"not_sent",evidence:"Operator confirmed no message was accepted in the original destination"},key());
    assert.equal(resolved.status,"rejected");
    assert.equal(resolved.attempts,1);
    assert.equal((await sql.unsafe("SELECT id FROM pm_dispatches WHERE record_id=$1 AND dispatched_at IS NULL",[interrupted.id])).length,0);
    assert.equal(await store.beginRefresh(disabledRun.id),null);
    assert.equal((await store.getRefresh(disabledRun.id))!.status,"failed");
    await store.beginRefresh(run.id); await store.finishRefresh(run.id,observation(account));
    assert.equal((await store.getRefresh(run.id))!.status,"completed");
    assert.notEqual((await store.requestRefresh(account.id,"later refresh",key())).id,run.id);
  } finally { await store.close(); }
}),30000);

test.skipIf(!databaseUrl)("receipt commit failures record uncertainty without overwriting a committed receipt or retransmitting", async () => isolated(async url => {
  const store = createStore(url);
  try {
    await store.migrate();
    const destination = await store.createResource("destinations",{label:"Fixture",adapter:"telegram",chatId:"-42",secretRef:"FIXTURE_TOKEN",enabled:true},key());
    for (const committed of [false,true]) {
      let sends = 0, first = true;
      const faulting = new Proxy(store,{ get(target,property) {
        if (property === "finishDelivery") return async (...args: Parameters<typeof store.finishDelivery>) => {
          if (first) { first=false; if (committed) await target.finishDelivery(...args); throw new Error("Receipt connection interrupted"); }
          return target.finishDelivery(...args);
        };
        return Reflect.get(target,property);
      }});
      const deliveries = createDeliveryModule({store:faulting,resolveSecret:()=>"fixture-only",createClient:()=>({async sendMessage(){sends++;return {message_id:7,chat:{id:"-42"}};}})});
      const row = await deliveries.request(notification(destination.id),key());
      await assert.rejects(deliveries.processDelivery(row.id,idle),/Receipt connection interrupted/);
      const result = (await store.getDelivery(row.id))!;
      assert.equal(result.status,committed ? "sent" : "unknown");
      if (committed) assert.deepEqual(result.receipt,{provider:"telegram",messageId:"7",chatId:"-42"});
      await deliveries.processDelivery(row.id,idle);
      assert.equal(sends,1,"no automatic retransmission after an uncertain receipt commit");
    }
  } finally { await store.close(); }
}),30000);

test.skipIf(!databaseUrl || !redisUrl)("application startup resumes portfolio work and exposes authenticated idempotent delivery reconciliation", async () => isolated(async (url,sql) => {
  const seed = createStore(url);
  await seed.migrate();
  const account = await seed.createResource("accounts",accountDraft,key());
  const refresh = await seed.requestRefresh(account.id,"interrupted",key()); await seed.beginRefresh(refresh.id);
  const destination = await seed.createResource("destinations",{label:"Fixture",adapter:"telegram",chatId:"-42",secretRef:"FIXTURE_TOKEN",enabled:true},key());
  const sent = await seed.requestNotification(notification(destination.id),key()); await seed.beginDelivery(sent.id,"Uncertain send");
  const notSent = await seed.requestNotification(notification(destination.id),key()); await seed.beginDelivery(notSent.id,"Uncertain send");
  const queued = await seed.requestNotification(notification(destination.id),key());
  await sql.unsafe("UPDATE pm_dispatches SET dispatched_at=clock_timestamp()");
  await seed.close();
  let sends=0, reads=0;
  const prefix = `recovery-${key()}`;
  const app = createApplication({databaseUrl:url,redisUrl:redisUrl!,apiToken:"fixture-recovery-token",host:"127.0.0.1",port:8787,queuePrefix:prefix,refreshIntervalMs:60000,dispatchIntervalMs:20}, {
    portfolioProvider:{async read(a){reads++;return observation(a);},async subscribe(){return async()=>{};},async subAccounts(){return [];},async close(){}},
    resolveSecret:()=>"fixture-only",telegramClient:()=>({async sendMessage(){sends++;return {message_id:9,chat:{id:"-42"}};}}),
  });
  try {
    await app.start(false);
    await eventually(()=>app.store.getRefresh(refresh.id),r=>r?.status==="completed");
    await eventually(()=>app.store.getDelivery(queued.id),r=>r?.status==="sent");
    assert.ok(reads>0); assert.equal(sends,1,"only the previously unattempted notification is sent");
    assert.equal((await app.store.getDelivery(sent.id))!.status,"unknown");
    assert.equal((await app.store.getDelivery(notSent.id))!.status,"unknown");
    const path = `/v1/deliveries/${sent.id}/reconcile`;
    const payload = {outcome:"sent",evidence:"Operator verified message 42 in original chat -42"};
    const headers = {authorization:"Bearer fixture-recovery-token","idempotency-key":key()};
    assert.equal((await app.http.inject({method:"POST",url:path,payload})).statusCode,401);
    assert.equal((await app.http.inject({method:"POST",url:path,headers,payload:{outcome:"sent"}})).statusCode,400);
    const first = await app.http.inject({method:"POST",url:path,headers,payload});
    assert.equal(first.statusCode,200,first.body);
    assert.equal(first.json().receipt.kind,"operator_reconciliation");
    assert.equal(first.json().receipt.evidence,payload.evidence);
    assert.equal(first.json().attempts,1);
    assert.deepEqual((await app.http.inject({method:"POST",url:path,headers,payload})).json(),first.json());
    assert.equal((await app.http.inject({method:"POST",url:path,headers,payload:{...payload,outcome:"not_sent"}})).statusCode,409);
    assert.equal((await app.http.inject({method:"POST",url:path,headers:{...headers,"idempotency-key":key()},payload})).statusCode,409);
    const decisions = await Promise.all(["not_sent","sent"].map(outcome=>app.http.inject({method:"POST",url:`/v1/deliveries/${notSent.id}/reconcile`,headers:{...headers,"idempotency-key":key()},payload:{outcome,evidence:"Operator checked the original destination"}})));
    assert.deepEqual(decisions.map(r=>r.statusCode).sort(),[200,409],"conflicting resolutions cannot both commit");
    assert.equal((await app.http.inject({method:"POST",url:`/v1/deliveries/${queued.id}/reconcile`,headers:{...headers,"idempotency-key":key()},payload})).statusCode,409);
    for (const id of [sent.id,notSent.id,queued.id]) await app.deliveries.processDelivery(id,idle);
    assert.equal(sends,1,"reconciliation cannot trigger a transmission");
  } finally {
    await app.close();
    for (const name of ["portfolio.refresh","notification.deliver","evaluation.run","source.sync"]) {
      const queue = new Queue(name,{connection:{url:redisUrl!},prefix});
      try { await queue.obliterate({force:true}); } finally { await queue.close(); }
    }
  }
}),30000);
