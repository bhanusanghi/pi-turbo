import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HelpRequest, HelpResult, System1Integration, TaskStatus } from "../contracts.js";
import type { ToolCall } from "@earendil-works/pi-ai";
export const CONTROL = "pi-turbo/control-v1";
export interface Control {
  version: 1; integration: string; revision: string; sessionId: string; branchAnchor: string | null;
  attemptId: string; phase: "s1" | "s2" | "settled"; status?: TaskStatus; error?: string;
  step: number; deadline: number; pending?: ToolCall; helpRequest?: HelpRequest; consultation?: HelpResult;
  cancelRequested?: boolean;
}
export class Lifecycle {
  current: Control | undefined;
  aborter = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private watched = new Map<AbortSignal, () => void>();
  constructor(private readonly pi: ExtensionAPI) {}
  save(): void { if (this.current) this.pi.appendEntry(CONTROL, structuredClone(this.current)); }
  restore(ctx: ExtensionContext): void {
    this.close();
    const entry = ctx.sessionManager.getBranch().findLast(e => e.type === "custom" && e.customType === CONTROL);
    this.current = entry?.type === "custom" ? structuredClone(entry.data as Control) : undefined;
    if (this.current && this.current.version !== 1) throw new Error("Unsupported Turbo control schema");
    if (this.current && this.current.phase !== "settled") {
      this.finish("error", "Interrupted attempt: inspect pending calls and reconcile unknown external effects before starting again");
    }
  }
  start(ctx: ExtensionContext, integration: System1Integration, timeoutMs: number): Control {
    this.close();
    this.aborter = new AbortController();
    this.current = { version: 1, integration: integration.id, revision: integration.revision,
      sessionId: ctx.sessionManager.getSessionId(), branchAnchor: ctx.sessionManager.getLeafId(),
      attemptId: randomUUID(), phase: "s1", step: 0, deadline: Date.now() + timeoutMs };
    this.timer = setTimeout(() => {
      this.finish("error", "Task deadline exhausted; pending effects require reconciliation");
      this.aborter.abort(); ctx.abort();
    }, timeoutMs);
    this.timer.unref();
    this.save();
    return this.current;
  }
  assert(attempt: string, ctx: ExtensionContext): Control {
    const c = this.current;
    if (!c || c.attemptId !== attempt || c.sessionId !== ctx.sessionManager.getSessionId()
      || c.phase === "settled" || c.cancelRequested || this.aborter.signal.aborted || Date.now() >= c.deadline) throw new Error("Turbo attempt is no longer active");
    return c;
  }
  finish(status: TaskStatus, error?: string): void {
    if (!this.current) return;
    this.current.phase = "settled"; this.current.status = status;
    if (error) this.current.error = error;
    this.clearTimer(); this.save();
  }
  watch(signal?: AbortSignal): void {
    if (!signal || this.watched.has(signal)) return;
    const cancelled = () => {
      if (this.current && this.current.phase !== "settled") { this.current.cancelRequested = true; this.save(); }
    };
    this.watched.set(signal, cancelled);
    signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) cancelled();
  }
  close(): void {
    this.clearTimer(); this.aborter.abort();
    for (const [signal, listener] of this.watched) signal.removeEventListener("abort", listener);
    this.watched.clear();
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
}
