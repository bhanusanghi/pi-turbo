import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNewsExtension } from '../dist-examples/hyperliquid-news/index.js';
import { host, choose } from './host.mjs';
const config = { wallets: ['0x1111111111111111111111111111111111111111'], feeds: ['https://example.com/rss'], perpDexs: [''],
  includeSpot: true, stateFile: 'news.json', mode: 'telegram', telegramChatId: 'fixture', contextArticles: 24,
  retentionHours: 48, excerptChars: 1000, positionMaxAgeSeconds: 120, policy: 'Use related evidence together' };
const position = { wallet: config.wallets[0], kind: 'perp', dex: '', coin: 'HYPE', size: '10', side: 'long', entryPrice: '20', positionValue: '220', unrealizedPnl: '20' };
function fixtures(send) {
  return { portfolio: async () => ({ fetchedAt: Date.now(), positions: [position], coverage: ['fixture:perp:native', 'fixture:spot'] }),
    news: async () => ['A', 'B'].map((id, i) => ({ id, source: config.feeds[0], sourceId: id, title: `Synthetic ${id}`, url: `https://example.com/${id}`,
      publishedAt: Date.now() - (2 - i) * 60000, observedAt: Date.now(), excerpt: id === 'A' ? 'Orion operator outage' : 'Orion dependency of held network', excerptTruncated: false })),
    article: async a => a.excerpt, telegram: send };
}
function judgment(req) {
  if (req.questions.next) return choose(req, 'fetch');
  const result = choose(req, req.state.current.id === 'A' ? 'skip' : 'alert');
  result.answers.focus = { type: 'choice', choice: 'p0', confidence: 1, probabilities: { p0: 1, none: 0 } };
  return result;
}
test('news companion retains skipped A for joint A+B judgment, records actual receipt and deduplicates', async () => {
  let sends = 0;
  const h = await host({ companion: createNewsExtension(config, fixtures(async text => { sends++; assert.match(text, /HYPE/); return 'message-73'; })), classify: judgment });
  try {
    await h.session.prompt('watch');
    assert.equal(h.control().status, 'completed'); assert.equal(sends, 1);
    const packets = h.seen.classifications.filter(r => r.questions.action);
    assert.deepEqual(packets.map(p => p.state.context.map(a => a.id)), [['A'], ['A', 'B']]);
    assert.equal(packets[1].state.context[0].priorJudgment, 'skip');
    const saved = JSON.parse(await readFile(join(h.dir, config.stateFile), 'utf8'));
    assert.equal(saved.articles.length, 2); assert.equal(Object.values(saved.alerts)[0].receipt, 'message-73');
    await h.session.prompt('watch again'); assert.equal(sends, 1); assert.equal(h.control().status, 'completed');
  } finally { await h.close(); }
});
test('preview exercises the same author path without Telegram delivery', async () => {
  let sends = 0;
  const h = await host({ companion: createNewsExtension({ ...config, mode: 'preview' }, fixtures(async () => { sends++; throw new Error('unexpected'); })), classify: judgment });
  try { await h.session.prompt('preview'); assert.equal(sends, 0); assert.equal(h.control().status, 'completed');
    const saved = JSON.parse(await readFile(join(h.dir, config.stateFile), 'utf8')); assert.equal(Object.values(saved.alerts)[0].status, 'preview'); }
  finally { await h.close(); }
});
test('accepted but unacknowledged send remains unknown and is never blindly retried', async () => {
  let sends = 0;
  const h = await host({ companion: createNewsExtension(config, fixtures(async () => { sends++; throw new Error('connection lost after server accepted'); })), classify: judgment });
  try { await h.session.prompt('watch'); assert.equal(h.control().status, 'blocked');
    const saved = JSON.parse(await readFile(join(h.dir, config.stateFile), 'utf8')); const [id, alert] = Object.entries(saved.alerts)[0];
    assert.equal(alert.status, 'unknown');
    const calls = h.seen.classifications.length;
    await h.session.prompt('watch again'); assert.equal(sends, 1); assert.equal(h.seen.classifications.length, calls);
    await h.session.prompt(`/news-resolve ${id} sent externally-checked-receipt`);
    await h.session.prompt('watch after reconciliation'); assert.equal(sends, 1); assert.equal(h.control().status, 'completed');
  } finally { await h.close(); }
});
test('a changed portfolio blocks a stale alert binding', async () => {
  let reads = 0; let sends = 0; const external = fixtures(async () => { sends++; return 'receipt'; });
  external.portfolio = async () => ({ fetchedAt: Date.now(), positions: ++reads === 1 ? [position] : [], coverage: ['fixture'] });
  const h = await host({ companion: createNewsExtension(config, external), classify: judgment });
  try { await h.session.prompt('watch'); assert.equal(sends, 0); assert.equal(h.control().status, 'blocked'); }
  finally { await h.close(); }
});
test('foreground watch pauses on a classifier/context failure instead of scheduling unchanged attempts', async () => {
  let settled; const idle = new Promise(r => settled = r);
  const h = await host({ companion: createNewsExtension({ ...config, mode: 'preview' }, fixtures(async () => { throw new Error('not called'); })),
    classify: req => choose(req, 'fetch', { stopReason: 'error', errorMessage: 'context limit exceeded', answers: {} }),
    extensions: [pi => pi.on('agent_settled', () => settled())] });
  try { await h.session.prompt('/news-watch 60'); await idle;
    const watch = h.session.sessionManager.getBranch().findLast(e => e.type === 'custom' && e.customType === 'hyperliquid-news/watch-v1');
    assert.equal(watch.data.status, 'paused'); assert.equal(h.seen.classifications.length, 1); assert.equal(h.control().status, 'error');
  } finally { await h.close(); }
});
