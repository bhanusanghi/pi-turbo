# Before and after the Durable migration

**Baseline:** Git `404d6db`, coding-agent 1.0.4 implementation. **After:** this working tree, native Durable / pi-ai / Chord 1.2.0. The former architecture and implementation plan remain available at the baseline Git commit. Research and design additions are outside this commit.

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
+  Harness; native task recovery; application-defined durable watch task
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
| News polling | Process-local interval | Application `NewsWatch` task saves phase, deadline and next due time. External supervisor owns uptime. |
| Usage | Parent accounting of helper work | Native child ledger; parent receives evidence, without charging child usage again. |
| Context | Author-selected, overflow is failure | Retained. No automatic retrieval, compaction or summarization in Turbo conversations. |
| Effects | Unknown Telegram sends require reconciliation | Retained; intent/receipt ledger now uses Durable transactions. External exactly-once remains unsupported. |

## Interface and file map

| Seam | Current implementation | Breaking change / retained meaning |
| --- | --- | --- |
| Author → Turbo | [`contracts.ts`](../src/contracts.ts) | `prepareTurn` returns JSON packet; `resolveTurn` becomes a named method. Tools/state remain product-owned. |
| Turbo → native host | [`extension.ts`](../src/extension.ts), [`provider.ts`](../src/runtime/provider.ts) | Registry extension, native hooks/wrappers, local provider; no coding-agent event bus or virtual-model registration. |
| S1 → S2 → S1 | [`system2.ts`](../src/helpers/system2.ts) | Child conversation and native tool tasks replace an isolated in-memory Agent. Original request and actual evidence return together. |
| Application persistence | [`state.ts`](../examples/hyperliquid-news/state.ts) | Session news ledger + per-conversation cycle documents replace file locks/custom branch state. |
| Application host/schedule | [`run.ts`](../examples/hyperliquid-news/run.ts), [`watch.ts`](../examples/hyperliquid-news/watch.ts) | Explicit worker commands and native checkpointed scheduling replace slash commands. |
| Removed | `src/registration.ts`, `src/runtime/lifecycle.ts`, empty `src/context/*` | No parallel controller or placeholder automatic state modules. |
| Tests/package | `test/host.mjs`, runtime/recovery/news/package tests, package metadata | Real Harness + SQLite; packed native extension. Peers pinned to the tested experimental release. |

## Bun host

The current host uses Bun 1.4.3 for execution, package management, tests and packaging. `bun.lock` replaces package-lock files. Durable's stock `storage/sqlite/node` adapter works through Bun's `node:sqlite` compatibility; no custom SQLite adapter remains. The portfolio application uses Fastify/TypeBox for HTTP and validation, with Bun.SQL and Drizzle's Bun SQL driver for PostgreSQL. BullMQ owns Redis job semantics.

The review fixes advertise current native capabilities, preserve successful nested `null` evidence, and project consultation results without repeating original Jev inputs/accounting. The news recipe revision is `durable-2`; pending older packets fail the existing revision guard. Production-builder before/after sizes and model-validation limits are recorded in [development](development.md).

## Defaults, tradeoffs and rollout

| Choice | Benefit | Cost / restriction |
| --- | --- | --- |
| Build on Durable | Native task ownership, pending-work recovery, documents and storage | New host bootstrap; coding-agent terminal commands no longer apply. |
| Plain JSON decision packets | Saved bindings survive restarts | Authors must separate pure mapping from state writes and version recipes. |
| Local provider adapter | Reuses native generation/tool continuation for Jev | Helper physical inference runs in a hook; partial-token streaming, deferred jobs and per-generation physical stream options are not supported. |
| Native tool wrappers | Binding/grant checks also run during safe replay | Installed code is trusted. Removing wrappers or changing executable tool behavior while tasks are pending requires application coordination. |
| Explicit application context | Keeps V1 small and product-independent | Authors own retention, selection and archival. History persistence does not choose useful Jev context. |
| Native watch task | Saved next wake/check, stable submission, coalesced missed intervals | Worker must be restarted externally. One process owns a store. |
| Unsafe alert execution | Stops blind replay of external sends | Interrupted/unknown delivery needs operator reconciliation. |

Old coding-agent sessions and JSON ledgers are **not** automatically migrated. Reconcile pending/unknown sends, preserve old receipts, and start in preview. Importing historical product data is a separate application migration; silently starting a fresh live ledger can duplicate alerts.

Application permissions still use Durable hooks/wrappers. Native safe replay can skip initial `beforeTool` hooks; current permissions belong in replayed execution too. The example explicitly disables native retry/compaction and selects sequential tools. Other conversations keep their own host settings.

Implemented and mechanically tested: native decision/tool flow, permission/argument guards, bounded consultation, actual evidence, process-kill recovery, news retention/deduplication and packed loading. No live Jev/helper quality or external delivery claim follows from these tests. [Validation matrix](development.md).
