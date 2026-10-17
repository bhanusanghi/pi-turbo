import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import { defineDoc, defineTool, defineExtension, GenerationTask, hook } from '@earendil-works/pi-durable';
import { host, context, choose, question, response, tool, finish, helpOptions } from '../host.mjs';
export const Receipt = defineDoc({ kind: 'recovery.receipt', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ done: false }) });
const waitForClose = context => new Promise((_resolve, reject) => {
  context.abortSignal.throwIfAborted();
  context.abortSignal.addEventListener('abort', () => reject(context.abortSignal.reason), { once: true });
});
export async function recoveryHost({ dir, mode = 'safe', pause = false, ready = () => {}, revision = '1', timeoutMs = 10000, grants = ['work'] }) {
  let returned;
  const record = (file, value) => appendFile(join(dir, file), value + '\n');
  const work = defineTool({ name: 'work', description: 'Application-owned test effect', parameters: Type.Object({ value: Type.Integer() }), replay: mode === 'unsafe' ? 'unsafe' : 'safe',
    async execute(args, api, ctx) {
      await record('attempts', String(args.value));
      if (mode === 'unsafe') await record('effects', 'external-effect');
      if (pause && mode !== 'packet') { ready(); await waitForClose(ctx); }
      await api.commit(async tx => { (await tx.doc(Receipt, api.conversationId)).done = true; }, ctx);
      return { output: [{ type: 'text', text: 'application receipt' }], details: { value: args.value } };
    } });
  const integration = { id: 'test', revision,
    async prepareTurn({ api, messages, consultation }, ctx) {
      if (messages.some(m => m.role === 'toolResult' && m.isError)) return { kind: 'final', status: 'blocked', text: 'Interrupted effect requires attention' };
      if (consultation) { returned = consultation; return { kind: 'final', status: 'completed', text: consultation.status }; }
      if ((await api.snapshot(Receipt, api.conversationId, ctx))?.done) return { kind: 'final', status: 'completed', text: 'Done' };
      return { request: question({ needed: 'work' }), bindings: { value: 7 } };
    },
    resolveTurn: packet => mode === 'helper'
      ? { kind: 'consult', request: { goal: 'Get evidence', inputs: {}, doneWhen: 'Evidence read', tools: [{ name: 'work', arguments: [{ value: 7 }] }] } }
      : { kind: 'tool', name: 'work', args: packet.bindings },
  };
  const barrier = defineExtension({ name: 'test.barrier', hooks: [hook(GenerationTask, {
    async beforeRequest(_request, api, ctx) {
      if (pause && mode === 'packet' && await api.memo('turbo.test.response', ctx)) { ready(); await waitForClose(ctx); }
    },
  })] });
  const h = await host({ dir, integration, tools: [work], extensions: [barrier],
    classify: async req => { await record('classifications', 'Jev'); return choose(req, 'go'); },
    system2: { ...helpOptions, tools: grants, maxToolCalls: 1, timeoutMs },
    helper: async input => { await record('models', 'LLM'); return response(input.messages.some(m => m.role === 'toolResult') ? [finish()] : [tool('work', { value: 7 })]); },
  });
  return { ...h, result: () => returned };
}
