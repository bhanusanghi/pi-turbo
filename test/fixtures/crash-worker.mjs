import { recoveryHost } from './recovery.mjs';
const [dir, mode] = process.argv.slice(2);
const h = await recoveryHost({ dir, mode, pause: true, ready: () => process.send({ ready: true }) });
await h.run('run', 'stable-request');
process.send({ unexpectedCompletion: true });
await h.close();
