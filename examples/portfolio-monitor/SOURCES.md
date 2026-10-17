# Shared source core

The application installs trusted TypeScript source registrations in `src/providers/index.ts`.
This core branch has no inbound providers. The Telegram/X and TradingView PRs add their own registrations, tests and setup guides.
Manual ingress, portfolios, delivery and all queues work independently of those registrations.

## Implemented contract

```text
SourceExtension
├── connectionSchema                 closed configuration; credential references only
├── validateWatch(connection, watch)  provider target and poll/push compatibility
├── acceptsRevision(previous, next)   optional provider ordering; called under item lock
├── createClient(context)             probe, collect, optional discover/watch/prepareWatch
├── receivers(context)               optional authenticated provider receivers
└── cli                              optional provider setup, flags and help
```

`createApplication({..}, {sourceExtensions})` passes one catalog to HTTP and storage.
The core CLI uses the same installed registrations. SDKs are constructed only for installed providers.
A registration is trusted application code, not uploaded tenant code or an MCP server.

A polling client returns `{items, checkpoint, gap}`. The host admits each item with current source/connection revision guards.
Only after every item succeeds does it commit the proposed checkpoint. Retried accepted items deduplicate.
This is deliberately not a whole-batch transaction.

Live events share the source's publication lane with history collection. Optional `prepareWatch` resolves the live identity or defers attachment.
`mode:"push"` sources bypass poll scheduling. `createPushReceiver` binds an authenticated provider request to current source and connection revisions.
A receiver must authenticate before normalization/admission; management authentication is delegated only for its exact registered POST route.

PostgreSQL owns accepted input revisions, configuration, checkpoints, sync status and pending dispatch.
Redis carries IDs. Provider checkpoints remain opaque to the host. Configuration changes cancel active work and reject late publication.
There is no cross-source semantic deduplication, evidence summarization or evaluation/model call.

## Operator interface

`bun run sources --help` shows common commands plus installed provider setup.
Connections carry only references to local credentials; private credential imports and file permissions use `sources/secrets.ts`.
Use authenticated `/v1/connections`, `/v1/sources`, source status/sync and input inspection routes.
Provider-specific connection fields are closed and validated by the same schema in HTTP and direct storage calls.
Connection adapter, source target, source connection and initial cutoff are immutable. Create a new source to change identity.

## Extension verification

Test provider wire parsing with external traffic substituted, then use its real client through the common app/DB/queue pipeline.
Core tests install synthetic providers and require no inbound SDK. Existing Telegram/X and TradingView fixtures belong to their own PRs.
A successful fixture or probe does not establish live account access or sustained collection.

See [shared-core.md](../../docs/shared-core.md) for the PR and ownership map.
