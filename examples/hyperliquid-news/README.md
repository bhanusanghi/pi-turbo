# Hyperliquid portfolio + news application

Runnable example on **Pi Durable 1.2.0**. The application owns tools, documents, prompts, source selection, delivery and scheduling. Turbo contributes Jev decisions and optional consultation.

## Start with preview

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run build:examples
cp examples/hyperliquid-news/news.example.json news.local.json
cp examples/hyperliquid-news/turbo.example.json turbo.local.json
```

Set your public account/subaccount addresses in `wallets` and public HTTPS RSS/Atom URLs in `feeds`. Empty values fail explicitly. Supply `TYPESAFE_API_KEY` through the environment. No signing or trading key is required.

```sh
bun run news check
bun run news status
```

`check` creates a fresh native conversation. `status` reads the saved ledger and pending task graph without scheduling work. Preview messages appear in the SQLite application ledger as `preview`; no Telegram call occurs.

Use `--news PATH --turbo PATH` to select configuration files. `databaseFile` is the application's Durable SQLite path. One process owns that database: stop the worker before running another command against it. Attach a UI/server to the owning process if concurrent access is needed.

## What lives where

| File | Owner | Responsibility |
| --- | --- | --- |
| [`run.ts`](run.ts) | Application host | Native providers, credentials, registry, SQLite, settings, worker commands and shutdown. |
| [`index.ts`](index.ts) | Application | Ordinary `defineTool` implementations; Jev questions and pure action mapping. |
| [`state.ts`](state.ts) | Application | `News` session document family and `Cycle` conversation document. |
| [`watch.ts`](watch.ts) | Application | Native `defineTask`, saved sleep/check phase, absolute check deadline, cancellation. |
| [`adapters.ts`](adapters.ts) | Application | Read-only Hyperliquid `/info`, RSS/Atom, source reads and Telegram HTTP. |
| [`src/`](../../src/) | Turbo | Jev translation and bounded System 2; no portfolio, news or Telegram rules. |

```text
Durable GenerationTask
  → author prepareTurn reads native documents
  → Turbo calls native Models.classify(Jev)
  → author resolveTurn binds exact article/position IDs
  → Durable ToolTask executes the ordinary product tool
  → application commits documents / actual receipt
  → native continuation asks Jev again
```

The application first fetches positions and feeds. It then asks how to handle each unreviewed article and which held position is most affected. An alert without a supported position stops. Jev selects supplied choices; the application writes the notification template.

## A alone, then A+B

Synthetic scenario; tests substitute the judgments.

```text
A: operator outage       → Jev input [A + portfolio]     → skip, retain A
B: held asset depends on operator
                         → Jev input [A + B + portfolio] → alert / defer / help
```

| State | Native location | Meaning |
| --- | --- | --- |
| Articles, reviews and delivery ledger | Session-scoped `News`, keyed by accounts/feeds/destination | Shared across check conversations; does not rewind with a fork. |
| Fresh portfolio, revision, read progress, issue | Conversation-scoped `Cycle` | Fresh per check; fork initializes empty. |
| Selected state/questions/bindings | Pending native generation memo | Exact decision-time packet; removed when that task finishes. |
| Watch phase/next due/check deadline | Native task checkpoint | Reopening resumes the current phase without resetting its timer. |

Defaults retain 48 hours of articles and select up to 24 preceding/current articles. Excerpt limits and omitted counts are explicit. Skipping reviews an article; it does not delete it. Change this application policy to use other evidence windows. Review and receipt records need application-owned archival as they grow.

Context overflow stops explicitly. It does not trigger summarization, shrinking or an automatic LLM call. Adjust authored context and start a fresh check. Turbo declines native compaction in its conversations; automatic state management remains V2.

## Optional System 2

The example host registers native TypeSafe and OpenAI providers. Other providers require an ordinary addition to `run.ts`; Turbo accepts any configured physical native chat model.

Set `system2` in `turbo.local.json`:

```json
{
  "enabled": true,
  "model": { "provider": "openai", "modelId": "YOUR_AVAILABLE_MODEL_ID" },
  "tools": ["news_article"],
  "maxTurns": 6,
  "maxToolCalls": 8,
  "timeoutMs": 60000
}
```

Replace the placeholder with a model from your native catalog and supply its provider credentials. The library has no default helper model.

```text
Jev chooses help
  → author binds exact retained article IDs
  → Turbo creates/reuses an owned Durable conversation
  → physical LLM can call native news_article within that scope
  → structured findings + actual read evidence return
  → author includes the result only for that article
  → Jev judges the next action
```

The helper cannot send Telegram in this recipe. Its `completed` result is a claim, not proof of news relevance. The parent decides what to do next. See [consultation mechanics and limits](../../ARCHITECTURE.md#system-2-reusable-consultation-native-execution).

## Delivery and long-running operation

After inspecting previews, set `mode: "telegram"`, set `telegramChatId`, and supply `TELEGRAM_BOT_TOKEN`. Preview/live keys differ: enabling delivery can alert on sources previously previewed.

```sh
bun run news watch --interval 300 --deadline 120
# SIGINT closes the process and preserves pending native work.
bun run news worker
# Reopens the database and resumes its pending tasks.
```

The native watch task runs one check at a time, saves `nextDue` before sleeping and coalesces missed intervals. Each check gets a fresh conversation and a stable submission ID. The task pauses after a blocked, failed, cancelled or timed-out check. Correct the cause and use `watch` to start another task.

A process supervisor is application infrastructure. Durable persists the work; it cannot restart a dead Bun process by itself. `worker` starts nothing new when the database has no pending tasks.

After shutting down the owning worker:

```sh
bun run news status
bun run news stop
```

`stop` aborts the saved watch task and waits for native cancellation to settle. `check --deadline 120` bounds a one-off check. Starting/installing the library schedules nothing.

## Effects and recovery

| Condition | Application behavior |
| --- | --- |
| Partial account/feed read fails | Stops; never labels the result “no positions” or “no news”. |
| Portfolio changed or too old at send | Stops the saved alert binding; requires a fresh check. |
| Confirmed receipt exists | Deduplicates the exact article/exposure/policy/mode key. |
| Send accepted, receipt not saved | Keeps `pending` or `unknown`; blocks further alerts until reconciliation. |
| Process dies during alert tool | Native `replay: "unsafe"` prevents rerunning that tool. |
| Safe read interrupted | Native recovery replays; Turbo rechecks its binding and current permissions. |

After independently checking Telegram:

```sh
bun run news resolve EFFECT_KEY sent VERIFIED_RECEIPT
bun run news resolve EFFECT_KEY not-sent
```

Use exactly one outcome. `not-sent` permits a later retry. There is no atomic transaction between SQLite and Telegram, and no exactly-once delivery claim.

**Migration:** the old `stateFile`, coding-agent session and slash commands are retired. They are not automatically imported. Preserve historical receipts and reconcile unknown deliveries before using a fresh live ledger. The default remains preview.

Coverage: native/HIP-3 perpetual positions and optional spot balances for explicitly listed accounts. Decimal values and long/short direction are retained. This is exposure inventory, not NAV, account discovery, open-order analysis or trading.

Verification uses real Durable/SQLite with substituted model and HTTP calls. Tests cover A+B context, source-scoped consultation, preview/receipts, stale exposures, unknown sends and watch restart. Live relevance accuracy, live APIs and delivery remain unverified. [Full matrix](../../docs/development.md).
