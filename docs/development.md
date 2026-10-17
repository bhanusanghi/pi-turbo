# Development

Read [architecture](../ARCHITECTURE.md) before changing decisions, state selection, tool bindings or helper policy. The runtime targets **Durable, pi-ai and Chord 1.2.0**, pinned together in package metadata and the lockfile.

## Local checks

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test
bun pm pack --dry-run
```

`bun run test` cleans/builds the package and exercises production runtime paths. SQLite databases and package extraction use temporary directories. Tests use Durable's stock SQLite adapter through Bun 1.4.3's `node:sqlite` compatibility. Inference and application effects are substituted.

Install/select the version in `.bun-version` before these commands; an older globally installed Bun is not upgraded by dependency installation.

Bun runs the TypeScript compiler for type checks/declaration builds. `bun test` is the native test runner; `bun run test` builds exports first. Compatible `node:` standard-library imports run inside Bun. The package requires neither a Node executable nor `tsx`. CI checks, builds, tests and packs this runtime.

## Verification matrix

The remaining suite covers the core runtime and packed extension. These tests are native execution evidence, not live semantic model evaluation.

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
| Package | Packed native extension runs inside Harness; application examples, media and secrets are excluded. |

Not verified: live Jev quality, live helper quality, all third-party hooks, power-loss recovery, distributed/multiple-writer storage or a deployed process supervisor.

## System 1 evidence

This cleanup changes no runtime source, authored decision contract, model input or consultation policy. Runtime tests continue to exercise native offered capabilities, exact saved bindings, current permissions, nested tool evidence (including structured `null`), invalid answers and cancellation. They establish mechanical behavior with substituted model answers; live semantic quality remains unverified.

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
