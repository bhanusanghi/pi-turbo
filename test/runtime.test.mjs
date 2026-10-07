import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from '@earendil-works/pi-ai';
import { registerSystem1 } from '../dist/index.js';
import { host, choose, response, text, tool } from './host.mjs';

function counterCompanion(onCall = () => {}) {
  return pi => {
    pi.registerTool({ name: 'count', label: 'Count', description: 'Increment by an exact amount', parameters: Type.Object({ n: Type.Integer() }),
      async execute(_id, { n }) { onCall(n); pi.appendEntry('counter', { n }); return { content: text(String(n)), details: { n } }; } });
    registerSystem1(pi, { id: 'counter', revision: '1', tools: ['count'],
      prepareTurn({ pi: ctx }) {
        const done = ctx.sessionManager.getBranch().some(e => e.type === 'custom' && e.customType === 'counter');
        return { request: { state: { done }, questions: { next: { type: 'choice', instructions: 'Select the next step', criteria: { increment: 'Increment when not done', finish: 'Finish when done' } } } },
          resolve: r => r.answers.next.choice === 'increment' ? { kind: 'tool', name: 'count', args: { n: 3 } } : { kind: 'final', status: 'completed', text: 'Counted 3' } };
      } });
  };
}
for (const order of ['turbo-first', 'companion-first']) test(`native classifier → Pi tool → author state → classifier (${order})`, async () => {
  let counted = 0;
  const h = await host({ companion: counterCompanion(n => counted += n), order,
    classify: request => choose(request, request.state.done ? 'finish' : 'increment') });
  try {
    await h.session.prompt('count');
    assert.equal(counted, 3); assert.equal(h.seen.classifications.length, 2);
    assert.equal(h.control().status, 'completed');
    assert.ok(h.session.messages.some(m => m.role === 'toolResult' && m.toolName === 'count' && !m.isError));
    assert.deepEqual(h.seen.errors, []);
  } finally { await h.close(); }
});
test('failed/oversized classifier response skips resolver, effects and unchanged retries', async () => {
  let calls = 0;
  const h = await host({ companion: counterCompanion(() => calls++), classify: request => choose(request, 'increment', { stopReason: 'error', errorMessage: 'maximum context length exceeded', answers: {} }) });
  try { await h.session.prompt('count'); assert.equal(calls, 0); assert.equal(h.seen.classifications.length, 1); assert.equal(h.control().status, 'error'); }
  finally { await h.close(); }
});
test('unsupported classifier answer cannot execute a tool', async () => {
  let calls = 0;
  const h = await host({ companion: counterCompanion(() => calls++), classify: request => choose(request, 'not-an-option') });
  try { await h.session.prompt('count'); assert.equal(calls, 0); assert.equal(h.control().status, 'error'); }
  finally { await h.close(); }
});
function helpCompanion(captured, usage) {
  return pi => {
    pi.registerTool({ name: 'lookup', label: 'Lookup', description: 'Get evidence for an exact id', parameters: Type.Object({ id: Type.String() }),
      async execute(_id, { id }, signal) { captured.push(id); return { content: text(`source ${id}`), details: { id, receipt: `read:${id}` }, ...(usage ? { usage } : {}) }; } });
    registerSystem1(pi, { id: 'help', revision: '1', tools: ['lookup'], prepareTurn({ consultation }) {
      return { request: { state: { helped: !!consultation, result: consultation ?? null }, questions: { next: { type: 'choice', instructions: 'Ask for help or finish', criteria: { help: 'Need evidence', finish: 'Evidence returned' } } } },
        resolve: r => r.answers.next.choice === 'finish' ? { kind: 'final', status: 'completed', text: 'Returned to Jev' }
          : { kind: 'consult', request: { goal: 'Look up a and b', inputs: { public: 'brief' }, doneWhen: 'Both sources read', tools: [{ name: 'lookup', arguments: [{ id: 'a' }, { id: 'b' }] }] } } };
    } });
  };
}
const helperOptions = { system2: { enabled: true, model: { provider: 'fixture', id: 'helper' }, tools: ['lookup'], maxTurns: 5 } };
test('scoped multi-tool helper uses native permission hooks, real results and returns to Jev', async () => {
  const read = []; const hooks = []; let turn = 0;
  const h = await host({ companion: helpCompanion(read), options: helperOptions,
    extensions: [pi => pi.on('tool_call', event => { hooks.push([event.toolName, event.parentToolCallId]); })],
    classify: req => choose(req, req.state.helped ? 'finish' : 'help'),
    helper: () => [response([tool('lookup', { id: 'a' })]), response([tool('lookup', { id: 'b' })]),
      response([tool('turbo_finish', { status: 'completed', findings: 'Both found', sources: ['a', 'b'], uncertainties: [] })])][turn++] });
  try {
    await h.session.prompt('PRIVATE PARENT SECRET');
    assert.deepEqual(read, ['a', 'b']); assert.equal(h.seen.classifications.length, 2);
    assert.equal(h.control().consultation.tools.length, 2); assert.equal(h.control().consultation.status, 'completed');
    assert.equal(h.control().consultation.usage.totalTokens, 66);
    assert.ok(hooks.filter(([name, parent]) => name === 'lookup' && parent).length === 2);
    assert.ok(!JSON.stringify(h.seen.helper).includes('PRIVATE PARENT SECRET'));
    assert.equal(h.control().status, 'completed'); assert.deepEqual(h.seen.errors, []);
  } finally { await h.close(); }
});
test('disabled helper makes no LLM call', async () => {
  const h = await host({ companion: helpCompanion([]), classify: req => choose(req, 'help'), helper: () => { throw new Error('must not run'); } });
  try { await h.session.prompt('help'); assert.equal(h.seen.helper.length, 0); assert.equal(h.control().status, 'error'); }
  finally { await h.close(); }
});

test('helper argument scope and installed permission denial prevent effects', async () => {
  const read = []; let turn = 0;
  const h = await host({ companion: helpCompanion(read), options: helperOptions,
    extensions: [pi => pi.on('tool_call', e => e.toolName === 'lookup' ? { block: true, reason: 'Host denied' } : undefined)],
    classify: req => choose(req, req.state.helped ? 'finish' : 'help'),
    helper: () => [response([tool('lookup', { id: 'outside' })]), response([tool('lookup', { id: 'a' })]), response(text('Could not read sources'))][turn++] });
  try { await h.session.prompt('help'); assert.deepEqual(read, []);
    assert.equal(h.control().consultation.status, 'incomplete'); assert.equal(h.control().consultation.tools[0].isError, true);
    assert.equal(h.control().status, 'completed'); }
  finally { await h.close(); }
});
test('helper tool ceiling stops repeated requests and returns exhausted', async () => {
  const read = [];
  const h = await host({ companion: helpCompanion(read), options: { ...helperOptions, system2: { ...helperOptions.system2, maxToolCalls: 1 } },
    classify: req => choose(req, req.state.helped ? 'finish' : 'help'), helper: () => response([tool('lookup', { id: 'a' })]) });
  try { await h.session.prompt('help'); assert.deepEqual(read, ['a']); assert.equal(h.control().consultation.status, 'exhausted');
    assert.equal(h.control().status, 'completed'); }
  finally { await h.close(); }
});
test('helper deadline aborts model work and returns control to Jev', async () => {
  let aborted = false;
  const h = await host({ companion: helpCompanion([]), options: { ...helperOptions, system2: { ...helperOptions.system2, timeoutMs: 25 } },
    classify: req => choose(req, req.state.helped ? 'finish' : 'help'),
    helper: (_context, opts) => new Promise((resolve, reject) => { opts.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true }); }) });
  // Keep the test process alive; runtime deadline timers correctly use unref().
  const keepAlive = setTimeout(() => {}, 2000);
  try { await h.session.prompt('help'); assert.equal(aborted, true); assert.equal(h.control().consultation.status, 'exhausted');
    assert.equal(h.control().status, 'completed'); }
  finally { clearTimeout(keepAlive); await h.close(); }
});
test('parent cancellation aborts helper and never restarts Jev', async () => {
  let started; const ready = new Promise(resolve => started = resolve);
  let aborted = false;
  const h = await host({ companion: helpCompanion([]), options: helperOptions,
    classify: req => choose(req, 'help'), helper: (_context, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true }); started();
    }) });
  try { const run = h.session.prompt('help'); await ready; await h.session.abort(); await run;
    assert.equal(aborted, true); assert.equal(h.seen.classifications.length, 1); assert.equal(h.control().status, 'cancelled', JSON.stringify({ control: h.control(), messages: h.session.messages.slice(-3) })); }
  finally { await h.close(); }
});
test('compaction is declined and auxiliary calls never run the classifier', async () => {
  const h = await host({ companion: counterCompanion(), classify: req => choose(req, req.state.done ? 'finish' : 'increment') });
  try { await h.session.prompt('go'); const calls = h.seen.classifications.length;
    await assert.rejects(h.session.compact()); assert.equal(h.seen.classifications.length, calls);
    const result = await h.modelRuntime.completeSimple(h.modelRuntime.getModel('turbo', 'auto'), { messages: [{ role: 'user', content: 'summarize', timestamp: Date.now() }] });
    assert.equal(result.stopReason, 'error'); assert.match(result.errorMessage, /auxiliary/); assert.equal(h.seen.classifications.length, calls); }
  finally { await h.close(); }
});
test('invalid tool arguments are rejected before the native effect', async () => {
  let effect = 0;
  const h = await host({ companion: pi => {
    pi.registerTool({ name: 'strict', label: 'Strict', description: 'Requires an integer', parameters: Type.Object({ n: Type.Integer() }, { additionalProperties: false }),
      execute: async () => { effect++; return { content: text('effect'), details: {} }; } });
    registerSystem1(pi, { id: 'strict', revision: '1', tools: ['strict'], prepareTurn: () => ({ request: { state: {}, questions: { next: { type: 'choice', instructions: 'Go?', criteria: { go: 'Go' } } } },
      resolve: () => ({ kind: 'tool', name: 'strict', args: { n: 'bad' } }) }) });
  }, classify: req => choose(req, 'go') });
  try { await h.session.prompt('go'); assert.equal(effect, 0); assert.equal(h.control().status, 'error'); }
  finally { await h.close(); }
});
test('later argument-rewriting hooks cannot change an already approved binding', async () => {
  let counted = 0;
  const h = await host({ companion: counterCompanion(n => counted += n), options: { maxSteps: 2 },
    extensions: [pi => pi.on('tool_call', e => { if (e.toolName === 'count') e.input.n = 999; })],
    classify: req => choose(req, 'increment') });
  try { await h.session.prompt('count'); assert.equal(counted, 0); assert.equal(h.control().status, 'error'); }
  finally { await h.close(); }
});
test('a cancelled classifier reply never reaches the resolver', async () => {
  let release; let started; let resolved = 0;
  const ready = new Promise(r => started = r);
  const h = await host({ companion: pi => registerSystem1(pi, { id: 'late', revision: '1', tools: [],
    prepareTurn: () => ({ request: { state: {}, questions: { q: { type: 'choice', instructions: 'Choose', criteria: { finish: 'Finish' } } } },
      resolve: () => { resolved++; return { kind: 'final', status: 'completed', text: 'done' }; } }) }),
    classify: req => new Promise(r => { release = () => r(choose(req, 'finish')); started(); }) });
  try { const run = h.session.prompt('go'); await ready; const aborting = h.session.abort(); release(); await aborting; await run;
    assert.equal(resolved, 0); assert.equal(h.control().status, 'cancelled'); }
  finally { await h.close(); }
});
test('reload rediscovers the companion and restores completed branch state', async () => {
  let counted = 0;
  const h = await host({ companion: counterCompanion(n => counted += n), classify: req => choose(req, req.state.done ? 'finish' : 'increment') });
  try { await h.session.prompt('count'); await h.session.reload(); await h.session.prompt('continue');
    assert.equal(counted, 3); assert.equal(h.control().status, 'completed'); }
  finally { await h.close(); }
});

test('restore of an actual interrupted helper record marks error and never replays pending work', async () => {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  let started; const ready = new Promise(r => started = r);
  const h = await host({ companion: helpCompanion([]), options: helperOptions, classify: req => choose(req, 'help'),
    helper: (_context, opts) => new Promise((_resolve, reject) => { opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); started(); }) });
  let snapshot;
  try { const running = h.session.prompt('help'); await ready;
    snapshot = structuredClone([h.session.sessionManager.getHeader(), ...h.session.sessionManager.getEntries()]);
    assert.equal(h.control().phase, 's2'); await h.session.abort(); await running;
  } finally { await h.close(); }
  const restored = SessionManager.inMemory('/tmp', undefined, snapshot);
  const next = await host({ companion: helpCompanion([]), options: helperOptions, sessionManager: restored,
    classify: () => { throw new Error('restore must not classify'); }, helper: () => { throw new Error('restore must not resume'); } });
  try { assert.equal(next.control().status, 'error'); assert.match(next.control().error, /Interrupted/);
    assert.equal(next.control().pending.name, 'turbo_consult'); assert.equal(next.seen.classifications.length, 0); assert.equal(next.seen.helper.length, 0); }
  finally { await next.close(); }
});
test('native branch navigation rebuilds author state from the selected branch', async () => {
  let counted = 0;
  const h = await host({ companion: counterCompanion(n => counted += n), classify: req => choose(req, req.state.done ? 'finish' : 'increment') });
  try { await h.session.prompt('count');
    const beforeEffect = h.session.sessionManager.getBranch().find(e => e.type === 'message' && e.message.role === 'user');
    await h.session.navigateTree(beforeEffect.id, { summarize: false });
    await h.session.prompt('count on this branch');
    assert.equal(counted, 6); assert.equal(h.control().status, 'completed');
    // This counter is deliberately branch-local; external effects need an author ledger, as in news.
    assert.deepEqual(h.seen.classifications.map(r => r.state.done), [false, true, false, true]);
  } finally { await h.close(); }
});
test('a helper cannot mix an effect with its completion control call', async () => {
  const read = [];
  const h = await host({ companion: helpCompanion(read), options: helperOptions, classify: req => choose(req, req.state.helped ? 'finish' : 'help'),
    helper: () => response([tool('lookup', { id: 'a' }), tool('turbo_finish', { status: 'completed', findings: 'claim', sources: [], uncertainties: [] })]) });
  try { await h.session.prompt('help'); assert.deepEqual(read, []); assert.notEqual(h.control().consultation.status, 'completed'); }
  finally { await h.close(); }
});
test('duplicate companion ids fail explicitly without model or tool work', async () => {
  const h = await host({ companion: counterCompanion(), extensions: [pi => registerSystem1(pi, { id: 'counter', revision: '1', tools: [],
    prepareTurn: () => ({ kind: 'final', status: 'completed', text: 'must not run' }) })], classify: () => { throw new Error('not called'); } });
  try { await h.session.prompt('count'); assert.equal(h.seen.classifications.length, 0);
    assert.match(h.session.messages.findLast(m => m.role === 'assistant').errorMessage, /Duplicate/); }
  finally { await h.close(); }
});
test('helper model failure returns error evidence without automatic context repair', async () => {
  const h = await host({ companion: helpCompanion([]), options: helperOptions, classify: req => choose(req, req.state.helped ? 'finish' : 'help'),
    helper: () => response([], { stopReason: 'error', errorMessage: 'context limit exceeded' }) });
  try { await h.session.prompt('help'); assert.equal(h.seen.helper.length, 1); assert.equal(h.control().consultation.status, 'error');
    assert.match(h.control().consultation.findings, /context limit/); assert.equal(h.control().status, 'completed'); }
  finally { await h.close(); }
});
test('native parent accounting adds helper model and nested tool usage once', async () => {
  const usage = { input: 6, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  let turn = 0;
  const h = await host({ companion: helpCompanion([], usage), options: helperOptions, classify: req => choose(req, req.state.helped ? 'finish' : 'help'),
    helper: () => [response([tool('lookup', { id: 'a' })]), response([tool('lookup', { id: 'b' })]),
      response([tool('turbo_finish', { status: 'completed', findings: 'sources', sources: ['a', 'b'], uncertainties: [] })])][turn++] });
  try { await h.session.prompt('help');
    const result = h.session.messages.find(m => m.role === 'toolResult' && m.toolName === 'turbo_consult');
    assert.equal(h.control().consultation.usage.totalTokens, 66);
    assert.deepEqual(h.control().consultation.tools.map(t => t.usage.totalTokens), [7, 7]);
    assert.equal(result.usage.totalTokens, 80);
  } finally { await h.close(); }
});
