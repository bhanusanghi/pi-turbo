import { test } from "bun:test";
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoveryHost, Receipt } from './fixtures/recovery.mjs';
import { context } from './host.mjs';
const lines = async (dir, file) => (await readFile(join(dir, file), 'utf8').catch(e => { if (e.code === 'ENOENT')
  return ''; throw e; })).trim().split('\n').filter(Boolean);
async function crash(dir, mode) {
  const ready = Promise.withResolvers();
  const child = Bun.spawn([process.execPath, new URL('./fixtures/crash-worker.mjs', import.meta.url).pathname, dir, mode], {
    stdout: 'ignore', stderr: 'pipe', ipc: message => ready.resolve(message),
  });
  const stderr = new Response(child.stderr).text();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const event = await Promise.race([ready.promise, child.exited.then(async (code) => { throw new Error(`Worker exited ${code}: ${await stderr}`); })]);
    assert.equal(event.ready, true, JSON.stringify(event));
    child.kill('SIGKILL');
    await child.exited;
  }
  finally {
    clearTimeout(timeout);
    if (child.exitCode === null)
      child.kill('SIGKILL');
    await child.exited;
  }
}
for (const mode of ['packet', 'safe', 'unsafe', 'helper']) {
  test(`SIGKILL/reopen: ${mode} uses Durable recovery and preserves the saved decision`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'turbo-crash-'));
    let h;
    try {
      await crash(dir, mode);
      h = await recoveryHost({ dir, mode });
      const pending = await h.harness.inspect(context);
      assert.ok(pending.tasks.length > 0);
      const settled = await h.run('run', 'stable-request');
      assert.equal(settled.status, 'done');
      assert.equal((await lines(dir, 'classifications')).length, 1, 'a saved decision must not reclassify');
      if (mode === 'unsafe') {
        assert.equal((await lines(dir, 'effects')).length, 1, 'unsafe effect must not replay');
        assert.match(JSON.stringify(await h.messages()), /Interrupted effect requires attention/);
        assert.equal((await h.harness.snapshot(Receipt, h.root.id, context))?.done, undefined);
      }
      else if (mode === 'helper') {
        assert.equal(h.result().status, 'completed');
        assert.equal(h.result().tools.length, 1, 'replayed safe tool keeps the same budget slot');
        assert.equal(h.result().tools[0].details.value, 7);
        assert.equal((await lines(dir, 'models')).length, 2, 'resume the owned child, then return');
        const children = await h.harness.commit(tx => tx.scanConversations({ ownerTaskId: h.result().id }, 10), context);
        assert.equal(children.items.length, 1);
      }
      else
        assert.equal((await h.harness.snapshot(Receipt, h.root.id, context)).done, true);
      assert.deepEqual(h.seen.errors, []);
    }
    finally {
      if (h)
        await h.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 10000);
}
test('recipe revision change rejects a saved tool binding after SIGKILL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'turbo-revision-'));
  let h;
  try {
    await crash(dir, 'safe');
    h = await recoveryHost({ dir, mode: 'safe', revision: '2' });
    await h.run('run', 'stable-request');
    assert.equal((await lines(dir, 'attempts')).length, 1);
    assert.equal((await lines(dir, 'classifications')).length, 1);
    assert.match(JSON.stringify(await h.messages()), /incompatible saved Turbo decision/);
  }
  finally {
    if (h)
      await h.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);
test('current helper grants are rechecked inside replayed execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'turbo-grants-'));
  let h;
  try {
    await crash(dir, 'helper');
    h = await recoveryHost({ dir, mode: 'helper', grants: [] });
    await h.run('run', 'stable-request');
    assert.equal((await lines(dir, 'attempts')).length, 1);
    assert.equal((await lines(dir, 'models')).length, 1);
    assert.match(JSON.stringify(await h.messages()), /unavailable tool/);
  }
  finally {
    if (h)
      await h.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);
test('consultation absolute deadline survives close/reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'turbo-deadline-'));
  let h;
  let ready;
  const started = new Promise(resolve => ready = resolve);
  try {
    h = await recoveryHost({ dir, mode: 'helper', pause: true, timeoutMs: 150, ready });
    const running = h.run('run', 'stable-request').catch(() => { });
    await started;
    await h.close();
    await running;
    await new Promise(resolve => setTimeout(resolve, 200));
    h = await recoveryHost({ dir, mode: 'helper' });
    await h.run('run', 'stable-request');
    assert.equal(h.result().status, 'exhausted');
    assert.equal((await lines(dir, 'attempts')).length, 1);
    assert.equal((await lines(dir, 'models')).length, 1);
  }
  finally {
    if (h)
      await h.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);
