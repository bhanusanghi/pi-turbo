import { test } from "bun:test";
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Type } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-durable';
import { host, question } from './host.mjs';
const root = resolve(import.meta.dirname, '..');
function run(cmd, cwd = root) {
  const result = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  return result.stdout.toString();
}
test('packed package executes in a native Durable Harness with its declared peers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'turbo-archive-'));
  let h;
  try {
    const archive = join(dir, 'pi-turbo.tgz');
    run([process.execPath, 'pm', 'pack', '--ignore-scripts', '--quiet', '--filename', archive]);
    const files = run(['tar', '-tzf', archive]).trim().split('\n').map(path => path.replace(/^package\//, ''));
    assert.ok(files.includes('dist/index.js') && files.includes('dist/index.d.ts') && files.includes('src/extension.ts'));
    assert.ok(files.includes('dist-examples/hyperliquid-news/run.js'));
    assert.ok(!files.some(f => /(^|\/)(node_modules|\.pi)(\/|$)|\.local\.json$|^\.env|\.(mp4|jpg|html)$/.test(f)));
    assert.ok(!files.some(f => /registration|runtime\/lifecycle|context\/budget/.test(f)));
    run(['tar', '-xzf', archive, '-C', dir]);
    await symlink(join(root, 'node_modules'), join(dir, 'package', 'node_modules'), 'dir');
    const metadata = JSON.parse(await readFile(join(dir, 'package', 'package.json'), 'utf8'));
    assert.equal(metadata.pi, undefined);
    assert.equal(metadata.peerDependencies['@earendil-works/pi-coding-agent'], undefined);
    assert.equal(metadata.peerDependencies['@earendil-works/pi-durable'], '1.2.0');
    assert.equal(metadata.packageManager, 'bun@1.4.3');
    assert.equal(metadata.engines.node, undefined);
    const { createTurbo } = await import(pathToFileURL(join(dir, 'package', 'dist', 'index.js')));
    let effects = 0;
    const ordinary = defineTool({ name: 'ordinary', description: 'Native package smoke test', parameters: Type.Object({}), replay: 'unsafe',
      async execute() { effects++; return { output: [{ type: 'text', text: 'native result' }] }; } });
    h = await host({ turboFactory: createTurbo, tools: [ordinary], integration: { id: 'package', revision: '1',
        prepareTurn: ({ messages }) => messages.some(m => m.role === 'toolResult')
          ? { kind: 'final', status: 'completed', text: 'Loaded packed extension' } : { request: question({ check: true }), bindings: {} },
        resolveTurn: () => ({ kind: 'tool', name: 'ordinary', args: {} }) } });
    assert.equal((await h.run()).status, 'done');
    assert.equal(effects, 1);
    assert.deepEqual(h.seen.errors, []);
  }
  finally {
    if (h) {
      await h.close();
      await h.cleanup();
    }
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
test('runnable example opens native SQLite for status without inference or HTTP', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'turbo-cli-'));
  try {
    const news = join(dir, 'news.json'), turbo = join(dir, 'turbo.json');
    await writeFile(news, JSON.stringify({ wallets: ['0x' + '1'.repeat(40)], feeds: ['https://example.invalid/feed'], databaseFile: join(dir, 'native.sqlite') }));
    await writeFile(turbo, JSON.stringify({ classifier: { provider: 'typesafe', modelId: 'jev-latest' }, system2: { enabled: false } }));
    const result = JSON.parse(run([process.execPath, join(root, 'dist-examples/hyperliquid-news/run.js'), 'status', '--news', news, '--turbo', turbo]));
    assert.equal(result.articles, 0);
    assert.deepEqual(result.alerts, {});
    assert.deepEqual(result.pending.tasks, []);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);
