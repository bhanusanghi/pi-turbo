import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SettingsManager, SessionManager } from '@earendil-works/pi-coding-agent';
import { createTurboExtension } from '../dist/index.js';
import { zeroUsage } from '../dist/runtime/protocol.js';

export const classifier = { provider: 'fixture', id: 'jev', type: 'classifier', api: 'fixture-classifier',
  name: 'Test inference', baseUrl: '', input: ['text'], contextWindow: 64000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
export const llm = { ...classifier, id: 'helper', type: 'chat', api: 'fixture-chat', reasoning: false, maxTokens: 2048 };
export function choose(request, choice, extras = {}) {
  const [id, question] = Object.entries(request.questions)[0];
  return { provider: 'fixture', model: 'jev', api: 'fixture-classifier', timestamp: Date.now(), stopReason: 'stop',
    answers: { [id]: { type: 'choice', choice, confidence: 1,
      probabilities: Object.fromEntries(Object.keys(question.criteria).map(k => [k, k === choice ? 1 : 0])) } },
    usage: { ...zeroUsage(), input: 10, output: 1, totalTokens: 11 }, ...extras };
}
export const text = value => [{ type: 'text', text: value }];
export const tool = (name, args = {}, id = crypto.randomUUID()) => ({ type: 'toolCall', name, arguments: args, id });
export function response(content, extras = {}) {
  return { role: 'assistant', provider: 'fixture', model: 'helper', api: 'fixture-chat', timestamp: Date.now(), content,
    stopReason: content.some(c => c.type === 'toolCall') ? 'toolUse' : 'stop',
    usage: { ...zeroUsage(), input: 20, output: 2, totalTokens: 22 }, ...extras };
}
export async function host({ companion, classify, helper, order = 'turbo-first', options = {}, extensions = [], settings = {}, sessionManager } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-turbo-test-'));
  const seen = { classifications: [], helper: [], errors: [] };
  const mock = pi => pi.registerProvider({
    id: 'fixture', name: 'Inference double', auth: { apiKey: { name: 'test', resolve: async () => ({ auth: { apiKey: 'test-local' }, source: 'test' }) } },
    getModels: () => [llm], getAllModels: () => [llm, classifier],
    classify: async (_model, request, opts) => { seen.classifications.push(structuredClone(request)); return classify(request, opts); },
    stream(...args) { return this.streamSimple(...args); },
    streamSimple(_model, context, opts) {
      const stream = createAssistantMessageEventStream(); seen.helper.push(structuredClone(context));
      void (async () => {
        try { const msg = await helper(context, opts); stream.push({ type: 'start', partial: msg });
          if (msg.stopReason === 'error' || msg.stopReason === 'aborted') stream.push({ type: 'error', reason: msg.stopReason, error: msg });
          else stream.push({ type: 'done', reason: msg.stopReason, message: msg }); stream.end(msg);
        } catch (error) { const msg = response([], { stopReason: opts?.signal?.aborted ? 'aborted' : 'error', errorMessage: String(error) });
          stream.push({ type: 'error', reason: msg.stopReason, error: msg }); stream.end(msg); }
      })(); return stream;
    },
  });
  const turbo = createTurboExtension({ classifier: { provider: 'fixture', id: 'jev' }, timeoutMs: 10000, ...options });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 }, ...settings });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null,
    modelsStorePath: join(dir, 'models-cache.json'), refreshOnCreate: false });
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager, noExtensions: true,
    disabledBuiltinExtensions: ['mcp', 'codemode'], noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [mock, ...(order === 'turbo-first' ? [turbo, companion] : [companion, turbo]), ...extensions].filter(Boolean) });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime, resourceLoader: loader,
    sessionManager: sessionManager ?? SessionManager.inMemory(dir), settingsManager, noTools: 'builtin' });
  await session.bindExtensions({ onError: e => seen.errors.push(e) });
  const virtual = modelRuntime.getModel('turbo', 'auto');
  assert.ok(virtual, 'native virtual model registered');
  await session.setModel(virtual);
  return { session, seen, modelRuntime, loader, dir,
    control: () => session.sessionManager.getBranch().findLast(e => e.type === 'custom' && e.customType === 'pi-turbo/control-v1')?.data,
    close: async () => { await session.abort(); session.dispose(); await rm(dir, { recursive: true, force: true }); } };
}
