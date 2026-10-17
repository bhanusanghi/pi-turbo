# Development

Read [architecture](../ARCHITECTURE.md) before changing decisions, state selection, tool bindings or helper policy. The runtime targets **Durable, pi-ai and Chord 1.2.0**, pinned together in package metadata and the lockfile.

## Local checks

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test
bun pm pack --dry-run
```

`bun run test` cleans/builds the package and examples, then exercises production paths. SQLite databases and package extraction use temporary directories. The application uses Durable's stock SQLite adapter through Bun 1.4.3's `node:sqlite` compatibility. Native Harness and process-kill tests exercise its production recovery path. Inference and external HTTP are substituted; tests do not read a real wallet or send Telegram messages.

`bun run news --help` runs the TypeScript example directly and shows its commands. [Setup guide](../examples/hyperliquid-news/README.md).

Install/select the version in `.bun-version` before these commands; an older globally installed Bun is not upgraded by dependency installation.

Bun runs the TypeScript compiler for type checks/declaration builds. `bun test` is the native test runner; `bun run test` builds exports first. Compatible `node:` standard-library imports run inside Bun. Neither package requires a Node executable or `tsx`. CI runs both packages and isolated PostgreSQL/Redis integration scenarios.

## Verification matrix

Verified 2026-10-15 on Bun 1.4.3: `bun run check` and all **56 tests passed**. Both TypeScript builds passed. These tests are native execution evidence, not live semantic model evaluation.

| Area | Evidence |
| --- | --- |
| Native integration | Real Harness, SQLite, registry, generation, tool tasks, document commits and continuation. |
| Decisions | Packet/answer/result persistence; exact binding and revision checks; malformed arguments/context and provider failure stop before effects. |
| Ownership | Concurrent conversations stay isolated; ordinary non-Turbo conversations keep native model/tools. |
| Consultation | Native owned child, real system sections/tool schemas, multi-turn tool loop, structured return and actual evidence. |
| Permissions/limits | Native host denial; later argument rewrite denial; exact grants, nested-call budget, turn/tool ceilings, deadline and cancellation. |
| Failure evidence | Streamed native output/details and native result-validation errors remain visible in handback. |
| Usage | Physical model identity, including resolved aliases; child usage counted once by the native ledger. |
| Process recovery | Separate worker is SIGKILLed; reopen reuses saved decisions, safe tool task and consultation child. Unsafe effects do not replay. |
| Changed policy | Reopened recipe revision and helper grants rechecked before execution; absolute deadline survives close/reopen. |
| Context | Invalid/oversized classification stops without fallback; manual compaction leaves Turbo transcript unchanged and calls no LLM. |
| News | A retained after skip; A+B reaches the next judgment; consultation applies only to its article; receipts/deduplication, preview and stale positions. |
| News recovery | Pending intent survives acceptance/close without another send; operator reconciliation; native watch saves next due time and cancels through native tasks. |
| HTTP adapters | Hyperliquid native/HIP-3/spot shapes; partial failures; RSS/Atom corrections; Telegram receipts and redacted transport errors. |
| Package/CLI | Packed native extension runs inside Harness; obsolete build output/media/secrets excluded; example status opens SQLite without inference/HTTP. |

Not verified: live Jev quality, live helper quality, real feeds/accounts/Telegram, all third-party hooks, power-loss recovery, distributed/multiple-writer storage or a deployed process supervisor.

## System 1 meaning and evidence

The news judgment still asks: **How should this article be handled, and which held exposure is most affected?** The author supplies policy, portfolio/coverage, current/prior articles, dates, source IDs, previous dispositions, omissions and relevant helper evidence.

Before migration, preparation closed over in-memory bindings and read an application JSON file. Now preparation reads ordinary Durable documents and returns a serializable packet. A pure resolver maps the same judgments to exact tool arguments. The tests inspect actual A and A+B requests and saved receipts. Substituted answers prove transport/state semantics, not correct financial relevance. A window limit alone is not an efficiency result.

## Review fixes and System 1 evidence

The next news judgment remains alert, skip, defer or scoped consultation, with a supported position binding. Native offered tool definitions now determine capabilities; the authored news recipe blocks unavailable prerequisite reads and removes unavailable action criteria. Saved decisions still pass through answer validation, pure resolution and native dispatch. Helper results return to System 1.

| Input | Decision use and disposition |
| --- | --- |
| Policy, dates, portfolio/coverage, selected articles and prior judgments | Keep: material relevance, direction, freshness, uncertainty and progress. |
| Action/focus criteria and helper availability | Keep current native choices: selecting an action/help that can actually run. |
| Helper goal, completion criterion, status, findings, sources and uncertainties | Keep when bound to the current article: assess what was investigated and what remains unknown. |
| Tool names/arguments, native output/errors and original details | Keep actual evidence and source identity distinct from helper claims. Explicit structured `null` survives nested execution and handback. |
| Repeated original inputs, call/task IDs, model/turn/usage accounting | Remove from the news Jev view; retain the full original native handback for diagnostics and provenance. |

Before/after production-builder capture on the same synthetic 24-article, 1,000-character-excerpt scenario: the pre-consultation request stays **32,410 bytes**; the post-consultation request changes **66,480 → 34,900 bytes** (47.5% fewer UTF-8 bytes). The helper reads one source and returns findings plus uncertainty. This measures the actual author projection with classifier/HTTP doubles, not live token usage or semantic improvement. Existing current-article/context duplication predates this fix and was not changed.

Regression checks exercise native tools/model-tool filters and model-only callers, disabled news reads/actions, full-host versus projected handbacks, and successful nested `Type.Null()` results. All three review defects are mechanically resolved. Live Jev/helper decisions, independent labels, latency/cost and external delivery remain unverified; no unqualified model-quality approval follows.

## Native contracts to preserve

- Register ordinary product tools separately from Turbo. Select extensions/tools/models through native conversation configuration.
- Keep `prepareTurn` repeatable and `resolveTurn` pure. Product writes/effects belong in native tools. Bump recipe revisions when meaning changes.
- Keep replay-sensitive permissions in execution/wrappers. Native safe recovery can skip initial `beforeTool` hooks.
- Use task ownership for helpers and native cancellation contexts for work. `close()` preserves tasks; `abort()` cancels the applicable scope.
- Do not remove/change in-flight tool definitions or wrappers without a coordinated application migration. Names are persisted; executable code is supplied on reopening.
- Put Turbo last among generation hooks. Its helper inference occurs there, before the local provider returns the prepared response.
- Native memos are first-write-wins and removed at terminal task completion. They are not permanent case archives.
- Distinguish submission completion from author status; inspect `rawStopReason: "turbo.completed"` before reporting product success.
- External effects require application receipts/reconciliation. Native request deduplication does not deduplicate arbitrary HTTP effects.

The helper adapter currently omits physical partial-token streaming, deferred provider jobs and generation-specific physical stream options. Provider credentials/transforms still come from native `Models`. See [architecture tradeoffs](../ARCHITECTURE.md).
