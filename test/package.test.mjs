import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
const root = resolve(import.meta.dirname, '..');
test('native discovery loads the source package and runnable companion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'turbo-package-'));
  try {
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: SettingsManager.inMemory({}), noExtensions: true,
      noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
      additionalExtensionPaths: [root, join(root, 'examples/hyperliquid-news/index.ts')] });
    await loader.reload(); const loaded = loader.getExtensions(); assert.deepEqual(loaded.errors, []);
    assert.ok(loaded.extensions.some(e => e.commands.has('pi-turbo')));
    assert.ok(loaded.extensions.some(e => e.tools.has('hl_positions') && e.commands.has('news-watch')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('packed npm archive contains exports and loads through Pi package discovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'turbo-archive-'));
  try {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--cache', join(dir, 'cache'), '--pack-destination', dir], { cwd: root, encoding: 'utf8' }));
    const [pack] = Object.values(packed);
    const files = pack.files.map(f => f.path);
    assert.ok(files.includes('dist/index.js') && files.includes('dist/index.d.ts') && files.includes('src/extension.ts'));
    assert.ok(!files.some(f => /(^|\/)(node_modules|\.pi)(\/|$)|\.local\.json$|^\.env/.test(f)));
    execFileSync('tar', ['-xzf', join(dir, pack.filename), '-C', dir]);
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: SettingsManager.inMemory({}), noExtensions: true,
      noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
      additionalExtensionPaths: [join(dir, 'package')] });
    await loader.reload(); const loaded = loader.getExtensions(); assert.deepEqual(loaded.errors, []);
    assert.ok(loaded.extensions.some(e => e.commands.has('pi-turbo')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
