import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createTurbo } from '../dist/index.js';
import { zeroUsage } from '../dist/runtime/protocol.js';
export const context = BACKGROUND_CONTEXT;
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
export async function host({ integration, tools = [], classify = req => choose(req, 'go'), helper,
  system2, extensions = [], settings = {}, init, dir: suppliedDir, extraTasks = [], turboFactory = createTurbo } = {}) {
  const dir = suppliedDir ?? await mkdtemp(join(tmpdir(), 'pi-turbo-durable-'));
  const seen = { classifications: [], helper: [], errors: [] };
  const models = createModels();
  models.setProvider({ id: 'fixture', name: 'Inference double',
    auth: { apiKey: { name: 'test', resolve: async () => ({ auth: {}, source: 'fixture' }) } },
    getModels: () => [llm], getAllModels: () => [llm, classifier],
    classify: async (_model, request, opts) => { seen.classifications.push(structuredClone(request)); return classify(request, opts); },
    stream(...args) { return this.streamSimple(...args); },
    streamSimple(_model, input, opts) {
      const events = createAssistantMessageEventStream(); seen.helper.push(structuredClone(input));
      void (async () => {
        let msg;
        try { msg = await helper(input, opts); }
        catch (error) { msg = response([], { stopReason: opts?.signal?.aborted ? 'aborted' : 'error', errorMessage: String(error) }); }
        events.push({ type: 'start', partial: msg });
        if (['error', 'aborted'].includes(msg.stopReason)) events.push({ type: 'error', reason: msg.stopReason, error: msg });
        else events.push({ type: 'done', reason: msg.stopReason, message: msg });
        events.end(msg);
      })();
      return events;
    },
  });
  const turbo = turboFactory({ integration, tools, classifier: { provider: 'fixture', modelId: 'jev' }, ...(system2 ? { system2 } : {}) });
  const registry = createRegistry();
  const product = defineExtension({ name: 'product', tools, tasks: extraTasks });
  registry.install(product); registry.install(turbo.extension);
  for (const extension of extensions) registry.install(extension);
  models.setProvider(turbo.provider);
  const harness = await Harness.open(await openNodeSqliteStorage(join(dir, 'session.sqlite')), {
    registry, models, onReport: error => seen.errors.push(error), settings: {
      compaction: { enabled: false }, retry: { enabled: false }, toolExecution: 'sequential', ...settings,
    },
  }, context);
  const root = await harness.root(context, { agent: { model: turbo.model,
    extensions: [product, turbo.extension, ...extensions], tools: [...tools, turbo.consultTool] }, ...(init ? { init } : {}) });
  return { dir, harness, root, models, registry, turbo, product, seen,
    run: async (content = 'run', requestId) => (await root.submit({ type: 'input', content, ...(requestId ? { requestId } : {}) }, context)).wait(context),
    messages: async () => (await root.context(context)).messages,
    close: () => harness.close(context),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
export const helpOptions = { enabled: true, model: { provider: 'fixture', modelId: 'helper' }, tools: [], maxTurns: 3, maxToolCalls: 3, timeoutMs: 2000 };
export const question = state => ({ state, questions: { next: { type: 'choice', instructions: 'Select the authored next action', criteria: { go: 'Continue' } } } });
export const finish = (status = 'completed') => tool('turbo_test_finish', { status, findings: 'Evidence checked', sources: ['source-A'], uncertainties: [] });
