# Pi Durable: applicability to Turbo

The runtime implements these boundaries against pinned Durable 1.2.0. The [original article](https://earendil.com/posts/pi-durable/) supplies design principles; [native tests](../development.md) provide execution evidence.

| Principle | Owner | Application to Turbo |
| --- | --- | --- |
| Small extensible harness | Durable + Turbo | Use native registry, `defineExtension`, `defineTool`, hooks and wrappers. |
| Model access | Durable | Invoke the classifier and configured helper through native `Models`. |
| Saved decisions and task recovery | Durable + Turbo | Keep serializable packets in native memos; version authored interpretation. |
| Tool replay | Author + Turbo | Recheck bindings, grants and deadlines at execution; authors own external-effect policy. |
| Submission deduplication | Durable | Stable request IDs deduplicate admission, not arbitrary external effects. |
| Owned child work | Durable + Turbo | A bounded System 2 child belongs to the consultation task and returns to System 1. |
| State and storage | Author + Durable | Ordinary native documents/storage; no Turbo product database. |
| Context selection | Author | Supply every Jev-visible fact/question; V1 does not infer, retrieve or summarize context. |
| Automatic compaction | Outside Turbo V1 | Decline compaction for Turbo conversations; overflow remains explicit. |
| Background scheduling | Host/application | Do not add a workflow engine or polling scheduler to Turbo. |
| Usage accounting | Durable + Turbo | Preserve physical provider usage and child accounting without double charging. |
| Experimental APIs | Maintainer | Pin peers together and verify real native lifecycle contracts before upgrades. |
| Remote execution and product UI | Host/application | Independent of the reusable decision/consultation interface. |

Recovery does not imply exactly-once external effects or power-loss guarantees. Native safe replay can skip the initial `beforeTool` chain, so replay-sensitive permissions belong at the execution boundary. See [architecture](../../ARCHITECTURE.md) for executable contracts and limitations.
