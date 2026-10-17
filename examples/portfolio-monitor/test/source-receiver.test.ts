import { test, expect } from "bun:test";
import { Type } from "typebox";
import type { AppStore } from "../src/contracts.js";
import { createPushReceiver } from "../src/sources/receiver.js";
import { createHttp } from "../src/http/index.js";

function fixture() {
  let enabled = true, calls = 0;
  const store = {
    async getResource(kind: string) { return kind === "sources"
      ? {id:"source",kind:"adapter",enabled,revision:3,watch:{mode:"push",connectionId:"connection",target:"channel"}}
      : {id:"connection",adapter:"fixture-push",enabled:true,revision:7}; },
    async acceptInput(sourceId: string, input: unknown, key: string, guard: unknown) {calls++;return {sourceId,input,key,guard};},
  } as unknown as AppStore;
  const receive = createPushReceiver<{text:string}>({store,adapter:"fixture-push",
    async authenticate(_connection,token){return token === "fixture-secret";},
    normalize(_source,body){return {sourceItemId:"item",kind:"message",text:body.text,publishedAt:null};},
  });
  return {store,receive,disable(){enabled=false;},calls:()=>calls};
}
test("shared push receiver authenticates and passes exact configuration revisions into admission",async()=>{
  const f=fixture();
  await expect(f.receive("source","wrong",{text:"message"})).rejects.toMatchObject({statusCode:401});
  expect(f.calls()).toBe(0);
  const result=await f.receive("source","fixture-secret",{text:"message"}) as unknown as {guard:unknown};
  expect(result.guard).toEqual({sourceRevision:3,connectionId:"connection",connectionRevision:7});
  f.disable();
  await expect(f.receive("source","fixture-secret",{text:"message"})).rejects.toMatchObject({statusCode:401});
  expect(f.calls()).toBe(1);
});
test("receiver authentication delegation applies only to its registered POST route",async()=>{
  const f=fixture();
  const app=createHttp({store:f.store,apiToken:"operator",portfolios:{async requestRefresh(){return [];},async discoverSubAccounts(){return [];}},
    deliveries:{async request(){}},queues:{async health(){},async inspect(){}},
    receivers:[{path:"/webhooks/fixture/:sourceId/:token",params:Type.Object({sourceId:Type.String(),token:Type.String()}),body:Type.Object({text:Type.String()},{additionalProperties:false}),
      receive(params,body){return f.receive(params.sourceId!,params.token!,body as {text:string});}}],
  });
  try {
    expect((await app.inject({method:"POST",url:"/webhooks/fixture/source/wrong",payload:{text:"message"}})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:"/webhooks/fixture/source/fixture-secret",payload:{text:"message"}})).statusCode).toBe(202);
    expect((await app.inject({method:"GET",url:"/webhooks/fixture/source/fixture-secret"})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:"/webhooks/unregistered",payload:{}})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:"/v1/inputs",payload:{}})).statusCode).toBe(401);
    expect(f.calls()).toBe(1);
  } finally {await app.close();}
});
