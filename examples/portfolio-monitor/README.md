# Portfolio monitor foundation

A self-contained TypeScript example application around Pi Turbo. The current application implements ingestion, read-only Hyperliquid portfolios, PostgreSQL, Redis queues, HTTP configuration/query routes and outbound notifications. **Evaluation is intentionally disconnected**: stored requests remain `awaiting_evaluator`.

Inbound integrations are installed through a provider catalog. The core ships no inbound provider; source PRs supply their registrations. [Shared source interface](SOURCES.md). Jev context, classification questions, turns, Turbo invocation and System 2 policy remain unconfigured. The existing `../hyperliquid-news` example remains a separate application.

## Run locally

Requires Bun 1.4.3 (pinned in `.bun-version`) and Docker Compose. Bun loads `.env`, executes TypeScript and runs the native test suite.

```sh
cd examples/portfolio-monitor
bun install --frozen-lockfile --ignore-scripts
bun run setup
bun run local
```

`setup` creates a private local `.env` with a generated operator token and preserves an existing file. `local` starts PostgreSQL and Redis, then starts the application. Startup applies the application migrations. Default HTTP address: `http://127.0.0.1:8787`. PostgreSQL and Redis also bind only to localhost, on ports 55432 and 56379. The Compose credentials are local-development credentials.

For compiled execution: `bun run build && bun run start`. `bun run migrate` applies migrations without starting workers. Ctrl-C shuts down the application; `bun run infra:down` stops its containers while preserving volumes. Run one application process per database/queue namespace in this version. Restart/replay policy for Pi conversations is a separate future task.

Every `/v1` request needs `Authorization: Bearer <API_TOKEN from .env>`. Every mutation also needs an `Idempotency-Key` of 8–200 printable non-space characters. Reusing a key with different content returns 409. A repeated accepted request returns its original receipt; use the GET endpoint to inspect current status.

## Modules and ownership

```mermaid
flowchart LR
  H["HTTP APIs"] --> I["Common ingress"]
  H --> P["Portfolio module"]
  HL["Hyperliquid SDK"] --> P
  H --> N["Notification module"]
  I --> DB["PostgreSQL\naccepted records + pending dispatch"]
  P --> DB
  N --> DB
  DB --> Q["BullMQ / Redis"]
  Q --> R["Refresh worker"] --> P
  Q --> D["Delivery worker"] --> T["Preview / Telegram"]
  Q --> E["Evaluation queue\npaused; no consumer"]
  PI["Optional native Durable tools"] --> P
  PI --> N
  classDef app fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef native fill:#dbeafe,stroke:#2563eb,color:#172554;
  classDef later fill:#f3e8ff,stroke:#9333ea,color:#581c87;
  class H,I,P,N,DB,Q,R,D,T app;
  class HL,PI native;
  class E later;
```

| Module | Responsibility |
| --- | --- |
| `src/application.ts`, `main.ts`, `config.ts` | Composition, configuration, startup and shutdown |
| `src/http/` | Validated operator interface, authentication, pagination and health |
| `src/storage/` | PostgreSQL schema/migrations, transaction rules, identities and pending dispatch |
| `src/sources/`, `source-cli.ts` | Provider-neutral catalog, credentials, collection lifecycle, checkpoints and operator commands |
| `src/ingress/` | Bind a source identity to the common input interface |
| `src/portfolio/` | SDK reads/subscriptions, normalization, coverage and refresh lifecycle |
| `src/queues/` | Publish committed IDs; run source/refresh/delivery workers; pause evaluation |
| `src/delivery/` | Explicit content, templates, preview/Telegram adapters and outcomes |
| `src/pi/` | Optional native `defineExtension`/`defineTool` adapters over these modules |

Product records belong to PostgreSQL. Redis carries record IDs and scheduling state. The optional Durable extension owns no product database and starts no conversation. Turbo stays a generic package outside this application.

## HTTP reference

All bodies reject unknown properties. Lists return `{ items, nextCursor }`; pass `?limit=50&cursor=...` to continue. UUID cursors apply to configuration/deliveries; numeric sequence cursors apply to inputs/evaluations. Dates must include a timezone. Async admission returns 202, not proof that the worker or external delivery has completed.

| Routes | Purpose |
| --- | --- |
| `POST /v1/{connections,sources,accounts,portfolios,monitors,destinations}` | Create configuration |
| `GET /v1/{connections,sources,accounts,portfolios,monitors,destinations}` | Paginated configuration |
| `GET /v1/{connections,sources,accounts,portfolios,monitors,destinations}/:id` | Inspect configuration |
| `PATCH /v1/{connections,sources,accounts,portfolios,monitors,destinations}/:id` | Change configuration; `enabled:false` disables without erasing history |
| `PUT /v1/portfolios/:id/accounts` | Replace membership with `{accountIds:[...]}` |
| `POST /v1/inputs` | Accept `{sourceId,input}` |
| `GET /v1/inputs?sourceId=...`, `GET /v1/inputs/:id` | List revisions; inspect one item with all revisions |
| `POST /v1/portfolios/:id/refresh` | Atomically request/coalesce account refreshes |
| `GET /v1/refreshes/:id` | Inspect a refresh request |
| `GET /v1/portfolios/:id/snapshot` | Inspect `{snapshot,fresh,reasons}` |
| `GET /v1/accounts/:id/subaccounts` | Discover possible accounts; inclusion remains explicit |
| `POST /v1/evaluations` | Request work with `{monitorId}` |
| `GET /v1/evaluations?monitorId=...`, `GET /v1/evaluations/:id` | Inspect pending requests; no case/projection endpoint |
| `POST /v1/notifications` | Queue explicit notification content |
| `POST /v1/destinations/:id/test` | Queue `{content:{title,body,links?}}` with `operator_test` origin |
| `GET /v1/deliveries`, `GET /v1/deliveries/:id` | Inspect status, rendered text and provider receipt |
| `GET /v1/queues` | Counts, waiting age and pending dispatches |
| `GET /health/live`, `GET /health/ready` | Process/dependency status; no authentication needed |

Configuration bodies:

```ts
source      = { name: "Manual input", kind: "manual", enabled: true }
account     = { label: "Main account", address: "YOUR_HYPERLIQUID_ADDRESS",
                network: "mainnet", perpDexs: "all", enabled: true }
portfolio   = { name: "My portfolio", accountIds: [accountId], enabled: true }
destination = { label: "Preview", adapter: "preview", enabled: true }
monitor     = { name: "Watch", portfolioId, sourceIds: [sourceId],
                destinationIds: [destinationId], enabled: true }
```

The monitor only binds configuration and trigger routing. It contains no policy, context window or model setting yet. `perpDexs:[""]` selects native perps only; `"all"` includes discovered HIP-3 DEXs. Spot is included in both cases. Account addresses are read-only; no trading/signing key is used.

Ingress example:

```json
{
  "sourceId": "REGISTERED_SOURCE_ID",
  "input": {
    "sourceItemId": "article-123",
    "sourceRevision": "1",
    "kind": "article",
    "publishedAt": "2026-10-14T12:00:00Z",
    "title": "Example report",
    "text": "Full supplied evidence for later evaluation.",
    "url": "https://example.com/article-123"
  }
}
```

Changed content becomes a retained revision. Unchanged content does not request another evaluation. `relatesTo:[{sourceItemId,relation:"reply"|"correction"}]` preserves relationships. Missing provider revision ordering remains unspecified; arrival does not imply truth. No cross-source semantic merging or automatic context trimming occurs.

## Hyperliquid behavior

The community SDK adapter preserves canonical network/DEX/coin or token identities, signed perps, decimal quantities, separate spot holdings and account-level venue observations. Token IDs are distinct from spot market IDs. Monetary values retain quote currency and price provenance; unknown valuations stay null. Shared collateral observations are not summed into fabricated account equity.

REST supplies authoritative assembled snapshots. Subscriptions invalidate holdings; periodic reads cover prices and connection gaps. Refreshes coalesce, with one follow-up when data changes during a read. Configuration changes invalidate old snapshots. Snapshot freshness is measured from the beginning of its account read, rather than treating early observations as newly fetched at completion.

Coverage/issues distinguish empty, failed and unsupported responses. Staking, vault ownership, outcome assets and HyperEVM inventory are outside this positions view. Unknown account modes remain explicit. Raw observations and metadata remain inspectable beside normalized fields. Default local request admission is conservative; it is not a claim about all other clients sharing the venue's IP quota.

## Notifications

Telegram destination configuration:

```ts
{ label: "Telegram", adapter: "telegram", enabled: true,
  chatId: "YOUR_CHAT_ID", secretRef: "TELEGRAM_BOT_TOKEN" }
```

Set the named token in the host environment/`.env`. The database stores its reference only. Notification content is explicit `{title,body,links?}`; POST `/v1/notifications` also supplies `destinationId`, `origin:"application"|"operator_test"` and optional `evidenceRevisionIds`.

Secret availability is checked during dispatch. An accepted request may therefore become `rejected` if its secret is absent. Repeating an accepted idempotency key still returns its receipt after configuration changes. Destination changes before admission reject old queued work; a change after admission cannot redirect a send to a new chat.

```text
queued → sending → previewed | sent | rejected | unknown
                     └ confirmed 429 → queued with due time → bounded next attempt
```

Preview stores text and a preview receipt. Telegram records the returned message ID. Ambiguous transport failure becomes `unknown` without automatic resend. Only confirmed rate-limit rejection retries, at most three attempts. Rendering is bounded and never silently truncates required content. Portfolio relevance, stale-alert cancellation and any model decision binding belong to the future evaluator design.

Before workers start, the single application owner recovers interrupted portfolio reads and pending queue publications. Recovered reads use the current account configuration, so disabling an account still prevents collection. Previously `sending` deliveries become `unknown`; they are never automatically retransmitted. Queued notification retries keep their original due time. Run only one application process per database/queue namespace; this startup recovery is not a distributed worker lease protocol.

If writing a delivery result fails, the worker attempts to record `unknown`. An already committed terminal receipt is preserved. If the database is still unavailable, restart the application after storage recovers to resolve any remaining `sending` records.

After checking the original destination/provider receipt, use authenticated `POST /v1/deliveries/:id/reconcile` with an `Idempotency-Key` and one of these bodies:

```json
{"outcome":"sent","evidence":"Verified Telegram message 123 in the original chat -10042"}
```

```json
{"outcome":"not_sent","evidence":"Provider evidence confirms this attempt was not accepted"}
```

Only `unknown` deliveries can be reconciled. `sent` records operator-confirmed delivery; `not_sent` resolves it as `rejected`. The receipt labels the result as `operator_reconciliation` and retains the evidence and previous diagnostic. This operation changes the record only and never sends a message. Leave the record `unknown` when evidence is inconclusive.

## Source and future evaluator interfaces

```ts
// The application installs trusted provider registrations.
createApplication(config, { sourceExtensions: installedProviders });
// Provider collect() returns normalized items and a proposed checkpoint.
// The shared host owns publication, guards and checkpoint commitment.
```

`createApplicationExtension` exports native `portfolio_snapshot` and `evidence_read` tools, scoped by explicit portfolio/source allowlists. `notification_request` exists only when the host supplies destination grants. These are optional wrappers over the same application modules as HTTP. They are not installed or run by server startup.

Next design step: decide evaluation case selection, retained evidence, Jev state/questions, turn construction, `createTurbo` configuration and System 2 handover. The server currently creates no model provider, conversation or inferred decision. No automatic state management is added.

## Verification

The extracted core is checked independently from each source PR. See [verification and ownership](../../docs/shared-core.md). Tests include compiled process lifecycle, real PostgreSQL/Redis, source guards and checkpoint ordering, and delivery recovery/reconciliation.

```sh
bun run check
bun run build
bun run test
TEST_DATABASE_URL=postgresql://monitor:monitor-local@127.0.0.1:55432/portfolio_monitor \
TEST_REDIS_URL=redis://127.0.0.1:56379 bun run test:integration
```

Integration tests require real PostgreSQL/Redis. They create isolated temporary databases/schemas and queue namespaces, then clean those up. They exercise HTTP → accepted records → dispatcher → workers → snapshots/receipts. The native Durable Harness tests use a deterministic transport to exercise actual tool validation and scopes, with no live model. Source SDK tests live with their provider PRs and substitute external traffic.

Live Hyperliquid account access and real Telegram delivery require operator configuration and are separate from these automated checks. Queue correctness does not establish model relevance. Source adapter verification and live-access limitations are described in [SOURCES.md](SOURCES.md).

## Dependencies

| Technology | Use |
| --- | --- |
| Fastify + TypeBox | HTTP and schemas |
| PostgreSQL + Bun.SQL + Drizzle Bun SQL adapter | Transactions, explicit SQL migrations and typed schema declarations |
| BullMQ + Redis (BullMQ owns its ioredis client) | ID-only jobs and workers |
| `@nktkas/hyperliquid` + decimal.js | Venue reads/subscriptions and precise arithmetic |
| grammY `Api` | Outbound Telegram |
| Pi Durable / pi-ai / Chord 1.2.0 | Optional native tool extension |
| TypeScript + bun:test + native Bun execution | Runtime/test source and development execution |

Dependency versions are pinned in this example's own `bun.lock`. Bun supplies the runtime, PostgreSQL connections, file reads, subprocesses and environment loading. Fastify owns HTTP routing, parsing, validation integration and server lifecycle; no custom HTTP stack, pg or tsx runtime is required. Application code has no imports from Turbo internals; the package can be extracted intact later.
