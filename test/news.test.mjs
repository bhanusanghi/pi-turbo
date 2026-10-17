import { test } from "bun:test";
import assert from 'node:assert/strict';
import { createNewsApplication } from '../dist-examples/hyperliquid-news/index.js';
import { NewsWatch, startWatch, stopWatch } from '../dist-examples/hyperliquid-news/watch.js';
import { host, context, choose, response, tool, helpOptions } from './host.mjs';
const config = { wallets: ['0x1111111111111111111111111111111111111111'], feeds: ['https://example.com/rss'], perpDexs: [''],
  includeSpot: true, databaseFile: 'news.sqlite', mode: 'telegram', telegramChatId: 'fixture', contextArticles: 24,
  retentionHours: 48, excerptChars: 1000, positionMaxAgeSeconds: 120, policy: 'Use related evidence together' };
const position = { wallet: config.wallets[0], kind: 'perp', dex: '', coin: 'HYPE', size: '10', side: 'long', entryPrice: '20', positionValue: '220', unrealizedPnl: '20' };
function fixtures(send) {
  return { portfolio: async () => ({ fetchedAt: Date.now(), positions: [position], coverage: ['fixture:perp:native', 'fixture:spot'] }),
    news: async () => ['A', 'B'].map((id, i) => ({ id, source: config.feeds[0], sourceId: id, title: `Synthetic ${id}`, url: `https://example.com/${id}`,
      publishedAt: Date.now() - (2 - i) * 60000, observedAt: Date.now(), excerpt: id === 'A' ? 'Orion operator outage' : 'Orion dependency of held network', excerptTruncated: false })),
    article: async (a) => a.excerpt, telegram: send };
}
function judgment(req) {
  if (req.questions.next)
    return choose(req, 'fetch');
  const result = choose(req, req.state.current.id === 'A' ? 'skip' : 'alert');
  result.answers.focus = { type: 'choice', choice: 'p0', confidence: 1, probabilities: { p0: 1, none: 0 } };
  return result;
}
async function fixture(options = {}) {
  const app = createNewsApplication({ ...config, ...options.config }, options.ports ?? fixtures(async () => 'message-73'));
  const h = await host({ integration: app.integration, tools: app.tools, classify: options.classify ?? judgment, extraTasks: [NewsWatch],
    dir: options.dir, system2: options.system2, helper: options.helper });
  const state = () => h.harness.snapshot(app.documents.News, app.scope, context);
  const again = async () => {
    const next = await h.harness.createConversation({ ownership: { kind: 'ownerless' }, agent: {
        model: h.turbo.model, extensions: [h.product, h.turbo.extension], tools: [...app.tools, h.turbo.consultTool],
      } }, context);
    return (await next.submit({ type: 'input', content: 'fresh check' }, context)).wait(context);
  };
  return { ...h, app, state, again };
}
test('news retains skipped A for joint A+B judgment, persists receipt and deduplicates across conversations', async () => {
  let sends = 0;
  const h = await fixture({ ports: fixtures(async (text) => { sends++; assert.match(text, /HYPE/); return 'message-73'; }) });
  try {
    assert.equal((await h.run()).status, 'done');
    assert.equal(sends, 1);
    const packets = h.seen.classifications.filter(r => r.questions.action);
    assert.deepEqual(packets.map(p => p.state.context.map(a => a.id)), [['A'], ['A', 'B']]);
    assert.equal(packets[1].state.context[0].priorJudgment, 'skip');
    const saved = await h.state();
    assert.equal(saved.articles.length, 2);
    assert.equal(Object.values(saved.alerts)[0].receipt, 'message-73');
    await h.again();
    assert.equal(sends, 1);
  }
  finally {
    await h.close();
    await h.cleanup();
  }
}, 5000);
test('preview follows the same Durable application path without delivery', async () => {
  const h = await fixture({ config: { mode: 'preview' }, ports: fixtures(async () => { throw new Error('must not send'); }) });
  try {
    await h.run();
    assert.equal(Object.values((await h.state()).alerts)[0].status, 'preview');
  }
  finally {
    await h.close();
    await h.cleanup();
  }
}, 5000);
test('unknown send survives a fresh conversation and requires explicit application reconciliation', async () => {
  let sends = 0;
  const h = await fixture({ ports: fixtures(async () => { sends++; throw new Error('connection lost after acceptance'); }) });
  try {
    await h.run();
    const [key, alert] = Object.entries((await h.state()).alerts)[0];
    assert.equal(alert.status, 'unknown');
    await h.again();
    assert.equal(sends, 1);
    await h.harness.commit(tx => h.app.reconcile(tx, key, 'sent', 'externally-verified'), context);
    await h.again();
    assert.equal(sends, 1);
    assert.equal((await h.state()).alerts[key].receipt, 'externally-verified');
  }
  finally {
    await h.close();
    await h.cleanup();
  }
}, 5000);
test('position freshness prevents sending against a changed portfolio', async () => {
  let reads = 0, sends = 0;
  const ports = fixtures(async () => { sends++; return 'receipt'; });
  ports.portfolio = async () => ({ fetchedAt: Date.now(), positions: ++reads === 1 ? [position] : [], coverage: ['fixture'] });
  const h = await fixture({ ports });
  try {
    await h.run();
    assert.equal(sends, 0);
    assert.match(JSON.stringify(await h.messages()), /Portfolio changed/);
  }
  finally {
    await h.close();
    await h.cleanup();
  }
}, 5000);
test('ordinary Durable watch task pauses after classifier failure', async () => {
  const h = await fixture({ classify: req => choose(req, 'fetch', { stopReason: 'error', errorMessage: 'context limit exceeded', answers: {} }) });
  try {
    const id = await startWatch(h.root, context, 20, 1000);
    const finished = await h.harness.waitForTask(id, context);
    assert.equal(finished.state.outcome.result.status, 'paused');
    assert.equal(h.seen.classifications.length, 1);
  }
  finally {
    await h.close();
    await h.cleanup();
  }
}, 5000);
test('native watch saves the next due time and reuses its task after reopening', async () => {
  let h = await fixture();
  const dir = h.dir;
  try {
    const id = await startWatch(h.root, context, 100000, 1000);
    h.harness.resume();
    let saved;
    for (let i = 0; i < 100; i++) {
      const record = await h.harness.getTask(id, context);
      if (record.state.checkpoint?.phase === 'sleep' && record.state.checkpoint.nextDue > Date.now() + 50000) {
        saved = record.state.checkpoint;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(saved, 'first native check should complete and checkpoint its next due time');
    await h.close();
    h = await fixture({ dir });
    assert.equal(await startWatch(h.root, context, 100000, 1000), id);
    assert.deepEqual((await h.harness.getTask(id, context)).state.checkpoint, saved);
    await stopWatch(h.harness, h.root, context);
    assert.equal((await h.harness.getTask(id, context)).state.outcome.status, 'aborted');
    assert.equal(h.seen.classifications.length, 0, 'reopening must not reset sleep to now');
  }
  finally {
    await h.close();
    await h.cleanup();
  }
}, 5000);
test('news pending intent survives interruption after Telegram acceptance without replaying the send', async () => {
  let sends = 0, accepted;
  const ready = new Promise(resolve => accepted = resolve);
  const ports = fixtures(async (_text, _config, signal) => {
    sends++;
    accepted();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  let h = await fixture({ ports });
  const dir = h.dir;
  try {
    const running = h.run('run', 'news').catch(() => { });
    await ready;
    await h.close();
    await running;
    h = await fixture({ dir, ports });
    await h.run('run', 'news');
    assert.equal(sends, 1);
    assert.equal(Object.values((await h.state()).alerts)[0].status, 'pending');
    assert.match(JSON.stringify(await h.messages()), /Reconcile uncertain delivery/);
  }
  finally {
    await h.close();
    await h.cleanup();
  }
}, 5000);
test('news consultation reads an exact source and only informs the matching article', async () => {
  let sawHelp = false, sawFreshArticle = false;
  const h = await fixture({ system2: { ...helpOptions, tools: ['news_article'] },
    classify: req => {
      if (!req.questions.action)
        return judgment(req);
      if (req.state.current.id === 'A' && !req.state.consultation) {
        const answer = judgment(req);
        answer.answers.action.choice = 'help';
        return answer;
      }
      if (req.state.current.id === 'A') {
        sawHelp = true;
        assert.equal(req.state.consultation.tools[0].details.articleId, 'A');
      }
      if (req.state.current.id === 'B') {
        sawFreshArticle = true;
        assert.equal(req.state.consultation, null);
        assert.ok(req.questions.action.criteria.help);
      }
      return judgment(req);
    },
    helper: input => response(input.messages.some(m => m.role === 'toolResult')
      ? [tool('turbo_hyperliquid_news_finish', { status: 'completed', findings: 'Read source A', sources: ['https://example.com/A'], uncertainties: [] })]
      : [tool('news_article', { articleId: 'A' })]),
  });
  try {
    await h.run();
    assert.equal(sawHelp, true);
    assert.equal(sawFreshArticle, true);
    assert.equal(h.seen.helper.length, 2);
  }
  finally {
    await h.close();
    await h.cleanup();
  }
}, 5000);

test('news projects helper claims/evidence without repeating the original request or accounting', async () => {
  let postHelp;
  const h = await fixture({ system2: { ...helpOptions, tools: ['news_article'] }, classify: req => {
    if (!req.questions.action) return judgment(req);
    if (req.state.current.id === 'A' && !req.state.consultation) {
      const answer = judgment(req); answer.answers.action.choice = 'help'; return answer;
    }
    if (req.state.current.id === 'A') postHelp = structuredClone(req);
    return judgment(req);
  }, helper: input => response(input.messages.some(m => m.role === 'toolResult')
    ? [tool('turbo_hyperliquid_news_finish', { status: 'incomplete', findings: 'Read source A; need confirmation', sources: ['https://example.com/A'], uncertainties: ['Source remains unconfirmed'] })]
    : [tool('news_article', { articleId: 'A' })]) });
  try {
    await h.run();
    const projected = postHelp.state.consultation;
    assert.equal(projected.status, 'incomplete');
    assert.match(projected.goal, /article A/); assert.match(projected.doneWhen, /uncertainty/);
    assert.deepEqual(projected.uncertainties, ['Source remains unconfirmed']);
    assert.deepEqual(projected.tools[0].arguments, { articleId: 'A' });
    assert.equal(projected.tools[0].details.source, 'Orion operator outage');
    for (const key of ['request', 'model', 'turns', 'usage', 'id', 'conversationId']) assert.equal(Object.hasOwn(projected, key), false);
    assert.equal(Object.hasOwn(projected.tools[0], 'callId'), false);
    const original = (await h.messages()).find(m => m.role === 'toolResult' && m.toolName === 'turbo_hyperliquid_news_consult').details;
    assert.equal(original.request.inputs.current.id, 'A');
    assert.deepEqual(original.request.inputs.context.map(a => a.id), ['A']);
    assert.ok(original.usage.totalTokens > 0);
    assert.equal(projected.tools[0].callId, undefined);
  } finally { await h.close(); await h.cleanup(); }
}, 5000);

test('news stops before classification when a required evidence tool is disabled', async () => {
  let reads = 0;
  const ports = fixtures(async () => { throw new Error('No alert should run'); });
  ports.portfolio = async () => { reads++; throw new Error('Disabled read must not execute'); };
  const h = await fixture({ ports });
  try {
    await h.root.configure({ tools: h.app.tools.filter(t => t.name !== 'hl_positions') }, context);
    await h.run();
    assert.equal(reads, 0); assert.equal(h.seen.classifications.length, 0);
    const answer = (await h.messages()).findLast(m => m.role === 'assistant');
    assert.equal(answer.rawStopReason, 'turbo.blocked');
    assert.match(JSON.stringify(answer.content), /Required evidence tool is unavailable/);
  } finally { await h.close(); await h.cleanup(); }
}, 5000);

test('news removes disabled actions from its actual classifier criteria', async () => {
  const h = await fixture({ classify: req => {
    if (req.questions.next) return choose(req, 'fetch');
    assert.equal(Object.hasOwn(req.questions.action.criteria, 'alert'), false);
    const answer = choose(req, 'skip');
    answer.answers.focus = { type: 'choice', choice: 'none', confidence: 1, probabilities: { p0: 0, none: 1 } };
    return answer;
  } });
  try {
    await h.root.configure({ tools: h.app.tools.filter(t => t.name !== 'news_alert') }, context);
    await h.run();
    assert.equal(Object.keys((await h.state()).alerts).length, 0);
    assert.equal(Object.keys((await h.state()).reviewed).length, 2);
    assert.equal((await h.messages()).findLast(m => m.role === 'assistant').rawStopReason, 'turbo.completed');
  } finally { await h.close(); await h.cleanup(); }
}, 5000);
