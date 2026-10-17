import { fixtureSource } from "./fixtures/source.js";
import { createSourceCatalog } from "../src/sources/catalog.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSourceSecretResolver, importSourceCredential } from "../src/sources/secrets.js";
import { runSourceCli } from "../src/source-cli.js";
import { createHttp } from "../src/http/index.js";
import type { AppStore } from "../src/contracts.js";

test("credential import writes private files and resolver rejects exposed files without leaking contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pm-secrets-"));
  const secret = "fixture-not-a-real-account-cookie";
  try {
    const from = join(dir, "input"); await writeFile(from, secret);
    const path = await importSourceCredential(dir, "personal", from);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const resolve = createSourceSecretResolver(name => name === "COOKIE_REF" ? `file:${path}` : undefined);
    assert.equal(await resolve("COOKIE_REF"), secret);
    await assert.rejects(importSourceCredential(dir, "personal", from), /already exists/);
    await chmod(path, 0o644);
    await assert.rejects(resolve("COOKIE_REF"), error => String(error).includes("chmod 600") && !String(error).includes(secret));
    await assert.rejects(resolve("MISSING"), /Missing credential reference/);
    await assert.rejects(importSourceCredential(dir, "../escape", from), /Credential name/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("source CLI sends config references through production HTTP validation, never cookie values", async () => {
  const writes: { kind: string; draft: any }[] = [];
  const app = createHttp({ catalog:createSourceCatalog([fixtureSource]), apiToken: "fixture-token", store: {
    async createResource(kind: string, draft: any) { writes.push({kind,draft}); return { id: "11111111-1111-4111-8111-111111111111", ...draft }; },
  } as unknown as AppStore, portfolios: { async requestRefresh() { return []; }, async discoverSubAccounts() { return []; } },
  deliveries: { async request() {} }, queues: { async health() {}, async inspect() {} } });
  const output: string[] = [];
  const transport = (async (url: URL | string, init: RequestInit) => {
    const u = new URL(url);
    const reply = await app.inject({ method: init.method as "POST", url: u.pathname + u.search,
      headers: init.headers as Record<string,string>, payload: init.body as string });
    return new Response(reply.body, { status: reply.statusCode, headers: {"content-type":"application/json"} });
  }) as typeof fetch;
  const options = { extensions:[fixtureSource], env: { API_TOKEN: "fixture-token" }, fetch: transport, print: (s:string) => output.push(s) };
  try {
    await runSourceCli(["connection", "add", "--adapter", "fixture-source", "--name", "Personal", "--secret-ref", "X_SESSION"], options);
    assert.deepEqual(writes[0], {kind:"connections",draft:{label:"Personal",enabled:true,adapter:"fixture-source",secretRef:"X_SESSION"}});
    await runSourceCli(["source", "add", "--connection", "11111111-1111-4111-8111-111111111111", "--target", "@news", "--name", "News", "--interval", "120"], options);
    assert.equal(writes[1]!.draft.watch.pollIntervalMs, 120000);
    await assert.rejects(runSourceCli(["source", "add", "--connection", "11111111-1111-4111-8111-111111111111", "--target", "@news", "--name", "News", "--interval", "0"], options), /rejected/);
    assert.equal(writes.length, 2);
    await assert.rejects(runSourceCli(["source", "list"], { ...options, env: { ...options.env, APP_URL:"http://example.com" } }), /HTTPS/);
    assert.ok(output.length === 2);
  } finally { await app.close(); }
});
