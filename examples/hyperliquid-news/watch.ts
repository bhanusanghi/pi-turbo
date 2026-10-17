import { withAbortSignal, type Context } from "@earendil-works/chord/context";
import { AssistantEntry, defineDoc, defineTask, type Conversation, type ConversationId, type Harness, type TaskId } from "@earendil-works/pi-durable";

type Input = { intervalMs: number; checkTimeoutMs: number };
type Checkpoint = { phase: "sleep"; nextDue: number } | { phase: "check"; conversationId: ConversationId; deadline: number };
export const WatchControl = defineDoc<{ taskId?: TaskId }>({ kind: "hyperliquid-news.watch", version: 1,
  scope: "conversation", history: "latest", fork: "initial", initial: () => ({}) });

/** Application scheduling, using only Durable tasks, ownership and native submissions. */
export const NewsWatch = defineTask<Input, Checkpoint, { status: string; reason?: string }>({
  name: "hyperliquid-news.watch", version: 1,
  initial: input => {
    if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs <= 0 || !Number.isSafeInteger(input.checkTimeoutMs) || input.checkTimeoutMs <= 0) throw new Error("Invalid watch interval/deadline");
    return { phase: "sleep", nextDue: Date.now() };
  },
  phases: {
    sleep: async (task, runtime, context) => {
      if (task.state.checkpoint.phase !== "sleep") throw new Error("Invalid watch checkpoint");
      await runtime.sleep(task.state.checkpoint.nextDue, context);
      await runtime.commit(async tx => {
        const child = await tx.createConversation({ ownership: { kind: "task", taskId: task.id } });
        return { status: "running", checkpoint: { phase: "check", conversationId: child.id, deadline: runtime.now() + task.input.checkTimeoutMs } };
      }, context);
    },
    check: async (task, runtime, context) => {
      if (task.state.checkpoint.phase !== "check") throw new Error("Invalid watch checkpoint");
      const child = (await runtime.conversation(task.state.checkpoint.conversationId, context))!;
      const deadline = task.state.checkpoint.deadline;
      const limited = withAbortSignal(AbortSignal.timeout(Math.max(1, deadline - runtime.now())), context);
      try {
        if (runtime.now() >= deadline) throw new Error("Check deadline exhausted");
        const settled = await (await child.submit({ type: "input", content: "Check portfolio news", requestId: `watch:${task.id}:${child.id}` }, context)).wait(limited);
        await runtime.commit(async tx => {
          const entry = settled.status === "done" && settled.type === "input" ? await tx.entry(AssistantEntry, settled.answer!) : undefined;
          const answer = entry?.model?.[0];
          if (answer?.role !== "assistant" || answer.rawStopReason !== "turbo.completed") return {
            status: "terminal", outcome: { status: "completed", result: { status: "paused", reason: "Check failed, blocked or was cancelled; inspect its native conversation" } },
          };
          // Coalesce missed intervals: start a fresh check after this completed one.
          return { status: "running", checkpoint: { phase: "sleep", nextDue: runtime.now() + task.input.intervalMs } };
        }, context);
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        await child.abort(context);
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: {
          status: "paused", reason: error instanceof Error ? error.message : String(error),
        } } }), context);
      }
    },
  },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});
export async function startWatch(root: Conversation, context: Context, intervalMs = 300_000, checkTimeoutMs = 120_000) {
  return root.commit(async tx => {
    const control = await tx.doc(WatchControl, root.id);
    const existing = control.taskId === undefined ? undefined : await tx.task(control.taskId);
    if (existing && existing.state.status !== "terminal") return existing.id;
    const id = await tx.createTask(NewsWatch, { intervalMs, checkTimeoutMs }, { ownership: { kind: "conversation" }, background: true });
    control.taskId = id;
    return id;
  }, context);
}
export async function stopWatch(harness: Harness, root: Conversation, context: Context) {
  const control = await harness.snapshot(WatchControl, root.id, context);
  if (control?.taskId !== undefined) {
    await harness.abortTask(control.taskId, context);
    await harness.waitForTask(control.taskId, context);
  }
}
