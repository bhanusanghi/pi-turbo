# Before and after the Durable migration

**Before:** coding-agent 1.0.4. **After:** native Durable / pi-ai / Chord 1.2.0. This comparison describes the reusable runtime interface.

## Responsibility change

```diff
 Application
-  coding-agent companion registration + Pi custom entries + JSON ledger
+  ordinary Durable extension + defineTool + defineDoc + native commits
 Turbo
-  coding-agent lifecycle controller + in-memory resolver + isolated Agent
+  serializable decision interface + native task memos + owned consultation
 Host
-  AgentSession; interrupted work reported; process-local polling
+  Harness; native task recovery and host-owned continuation
```

| Concern | Before | After / consequence |
| --- | --- | --- |
| Installation | Coding-agent extension factory and `pi.extensions` discovery | Application installs `createTurbo().extension` in a native registry. Breaking integration change. |
| Models | coding-agent virtual model/provider | Local chat-shaped provider with native `ModelRef`; physical calls use host `Models`. |
| Product tools | `pi.registerTool` | Native `defineTool`, registered by the product. No Turbo tool schema/executor. |
| Prepared judgment | Resolver closure over current state | Serializable `PreparedTurn` plus pure, versioned `resolveTurn`. Pending work can recover. |
| Product state | Branch entries and separate JSON file | Ordinary application documents and transactions. Turbo supplies no state manager. |
| Continuation | Coding-agent controller/settlement hooks | Native GenerationTask and ToolTask loop. Turbo does not count or schedule S1 steps. |
| Consultation | In-memory isolated Agent | Native task-owned child conversation, stable submission and scope document. |
| Replay | Interrupted work explicitly stopped | Safe tools replay; unsafe tools report interruption. Execute wrappers recheck Turbo constraints. |
| Usage | Parent accounting of helper work | Native child ledger; parent receives evidence, without charging child usage again. |
| Context | Author-selected, overflow is failure | Retained. No automatic retrieval, compaction or summarization in Turbo conversations. |
| Effects | Unknown external effects require reconciliation | Application-owned; native storage cannot atomically commit an external effect. External exactly-once remains unsupported. |

## Interface and file map

| Seam | Current implementation | Breaking change / retained meaning |
| --- | --- | --- |
| Author → Turbo | [`contracts.ts`](../src/contracts.ts) | `prepareTurn` returns JSON packet; `resolveTurn` becomes a named method. Tools/state remain product-owned. |
| Turbo → native host | [`extension.ts`](../src/extension.ts), [`provider.ts`](../src/runtime/provider.ts) | Registry extension, native hooks/wrappers, local provider; no coding-agent event bus or virtual-model registration. |
| S1 → S2 → S1 | [`system2.ts`](../src/helpers/system2.ts) | Child conversation and native tool tasks replace an isolated in-memory Agent. Original request and actual evidence return together. |
| Removed | `src/registration.ts`, `src/runtime/lifecycle.ts`, empty `src/context/*` | No parallel controller or placeholder automatic state modules. |
| Tests/package | `test/host.mjs`, runtime/recovery/package tests, package metadata | Real Harness + SQLite; packed native extension. Peers pinned to the tested experimental release. |

## Bun host

The current host uses Bun 1.4.3 for execution, package management, tests and packaging. `bun.lock` replaces package-lock files. Durable's stock `storage/sqlite/node` adapter works through Bun's `node:sqlite` compatibility; no custom SQLite adapter remains.

Current capabilities come from native offered tools; nested structured `null` evidence survives consultation. The runtime owns mechanical validation; application projections and semantic evaluation remain outside the package.

## Defaults, tradeoffs and rollout

| Choice | Benefit | Cost / restriction |
| --- | --- | --- |
| Build on Durable | Native task ownership, pending-work recovery, documents and storage | New host bootstrap; coding-agent terminal commands no longer apply. |
| Plain JSON decision packets | Saved bindings survive restarts | Authors must separate pure mapping from state writes and version recipes. |
| Local provider adapter | Reuses native generation/tool continuation for Jev | Helper physical inference runs in a hook; partial-token streaming, deferred jobs and per-generation physical stream options are not supported. |
| Native tool wrappers | Binding/grant checks also run during safe replay | Installed code is trusted. Removing wrappers or changing executable tool behavior while tasks are pending requires application coordination. |
| Explicit application context | Keeps V1 small and product-independent | Authors own retention, selection and archival. History persistence does not choose useful Jev context. |

Old coding-agent sessions are not automatically migrated. Historical product state requires an explicit migration in the consuming application.

Application permissions still use Durable hooks/wrappers. Native safe replay can skip initial `beforeTool` hooks; current permissions belong in replayed execution too. Turbo declines compaction in its own conversations. Other conversations keep their own host settings.

Implemented and mechanically tested: native decision/tool flow, permission/argument guards, bounded consultation, actual evidence, process-kill recovery and packed loading. No live Jev/helper quality or external delivery claim follows from these tests. [Validation matrix](development.md).
