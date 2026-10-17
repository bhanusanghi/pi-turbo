import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { Queue } from "bullmq";
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
test.skipIf(Boolean((!databaseUrl || !redisUrl) && "Set TEST_DATABASE_URL and TEST_REDIS_URL"))("compiled process serves authenticated HTTP and shuts down cleanly with empty configuration", async () => {
  const database = `pm_cli_${randomUUID().replaceAll("-", "")}`;
  const admin = new SQL(databaseUrl!);
  await admin.unsafe(`CREATE DATABASE ${database}`);
  const db = new URL(databaseUrl!);
  db.pathname = `/${database}`;
  const reserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reserve.port;
  await reserve.stop(true);
  const prefix = `cli-${randomUUID()}`;
  const token = randomUUID();
  const child = Bun.spawn([process.execPath, "dist/src/main.js"], { cwd: process.cwd(), env: { ...process.env,
      DATABASE_URL: db.href, REDIS_URL: redisUrl, API_TOKEN: token, HOST: "127.0.0.1", PORT: String(port), QUEUE_PREFIX: prefix }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let diagnostics = "";
  const capture = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done)
          break;
        diagnostics += new TextDecoder().decode(value);
      }
    }
    finally {
      reader.releaseLock();
    }
  };
  const output = Promise.all([capture(child.stdout), capture(child.stderr)]);
  const exit = child.exited;
  try {
    const until = Date.now() + 10000;
    let ready = false;
    while (Date.now() < until && child.exitCode === null) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok;
      }
      catch { /* Wait for binding. */ }
      if (ready)
        break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, diagnostics);
    const accounts = await fetch(`http://127.0.0.1:${port}/v1/accounts`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(accounts.status, 200);
    assert.deepEqual(await accounts.json(), { items: [], nextCursor: null });
    child.kill("SIGTERM");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([exit, new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error("Shutdown timed out")), 5000); })]);
      assert.equal(code, 0, diagnostics);
    }
    finally {
      if (deadline)
        clearTimeout(deadline);
    }
    assert.ok(!diagnostics.includes(token), "logs must not disclose the operator token");
  }
  finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exit;
    await output;
    for (const name of ["portfolio.refresh", "evaluation.run", "notification.deliver"]) {
      const queue = new Queue(name, { connection: { url: redisUrl! }, prefix });
      try {
        await queue.obliterate({ force: true });
      }
      finally {
        await queue.close();
      }
    }
    await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.close();
  }
}, 25000);
