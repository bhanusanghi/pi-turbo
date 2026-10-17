import { Queue, Worker } from "bullmq";
import type { AppStore, QueueName } from "../contracts.js";

const names: QueueName[] = ["portfolio.refresh", "evaluation.run", "notification.deliver", "source.sync"];
export type QueueOptions = {
  store: AppStore; redisUrl: string; prefix: string; dispatchIntervalMs?: number;
  processRefresh(id: string, signal: AbortSignal): Promise<void>;
  processDelivery(id: string, signal: AbortSignal): Promise<void>;
  processSourceSync?(id: string, signal: AbortSignal): Promise<void>;
  onError?(error: unknown): void;
};
export function createQueueRuntime(options: QueueOptions) {
  const onError = options.onError ?? (() => {});
  const abort = new AbortController();
  const connection = { url: options.redisUrl, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 5_000 };
  const queues = Object.fromEntries(names.map(name => [name, new Queue<{ recordId: string }>(name, {
    connection, prefix: options.prefix,
    defaultJobOptions: { attempts: 1, removeOnComplete: { age: 86_400, count: 10_000 }, removeOnFail: { age: 604_800, count: 10_000 } },
  })])) as Record<QueueName, Queue<{ recordId: string }>>;
  for (const queue of Object.values(queues)) queue.on("error", onError);
  const workers: Worker[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let dispatching: Promise<void> | undefined;
  let started = false;
  let closed = false;
  async function dispatchOnce() {
    if (closed) return;
    if (dispatching) return dispatching;
    dispatching = (async () => {
      for (const pending of await options.store.pendingDispatches(100)) {
        if (closed) break;
        try {
          await queues[pending.queue].add(pending.queue, { recordId: pending.recordId }, {
            jobId: pending.id, delay: Math.max(0, Date.parse(pending.availableAt) - Date.now()),
          });
          await options.store.markDispatched(pending.id);
        } catch (error) {
          // Keep accepted work in PostgreSQL; avoid publishing later work out of order.
          await options.store.failDispatch(pending.id, "Queue publication failed");
          onError(error);
          break;
        }
      }
    })().finally(() => { dispatching = undefined; });
    return dispatching;
  }
  async function health() {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const probe = Promise.all(Object.values(queues).map(async queue => {
      await queue.waitUntilReady();
      await queue.getJobCounts("waiting");
    }));
    try {
      await Promise.race([probe, new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error("Redis readiness timeout")), 3_000);
      })]);
    } finally { if (deadline) clearTimeout(deadline); }
  }
  async function inspect() {
    const data = await Promise.all(names.map(async name => {
      const queue = queues[name];
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
      const oldest = (await queue.getJobs(["waiting"], 0, 0, true))[0];
      return { name, counts, paused: await queue.isPaused(), consumer: name === "evaluation.run" ? "awaiting_evaluator" : name === "source.sync" && !options.processSourceSync ? "not_configured" : "running",
        oldestWaitingAgeMs: oldest ? Math.max(0, Date.now() - oldest.timestamp) : null };
    }));
    return { queues: data, pendingDispatches: await options.store.pendingDispatches(100), evaluator: "not_configured" };
  }
  async function start() {
    if (started) return;
    started = true;
    await health();
    await queues["evaluation.run"].pause();
    const processors = { "portfolio.refresh": options.processRefresh, "notification.deliver": options.processDelivery,
      ...(options.processSourceSync ? { "source.sync": options.processSourceSync } : {}) };
    for (const [name, process] of Object.entries(processors)) {
      const worker = new Worker<{ recordId: string }>(name, async job => {
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(name === "portfolio.refresh" ? 240_000 : 120_000)]);
        await process(job.data.recordId, signal);
      }, { connection: { ...connection, maxRetriesPerRequest: null, enableOfflineQueue: true },
        prefix: options.prefix, concurrency: name === "source.sync" ? 4 : 1 });
      worker.on("error", onError);
      worker.on("failed", (_job, error) => onError(error));
      workers.push(worker);
    }
    await Promise.all(workers.map(worker => worker.waitUntilReady()));
    await dispatchOnce();
    timer = setInterval(() => { void dispatchOnce().catch(onError); }, options.dispatchIntervalMs ?? 500);
    timer.unref();
  }
  async function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    abort.abort(new Error("Application shutdown"));
    await dispatching?.catch(onError);
    await Promise.allSettled(workers.map(worker => worker.close()));
    await Promise.allSettled(Object.values(queues).map(queue => queue.close()));
  }
  return { start, close, health, inspect, dispatchOnce };
}
