# Durable migration: implementation status

The authorized migration is implemented in this working tree. Baseline: coding-agent 1.0.4 at `404d6db`. New host: Durable / pi-ai / Chord **1.2.0**.

The former coding-agent plan is available at baseline Git commit `404d6db`. Learning proposals remain outside this migration.


| Stage | Implemented result | Validation |
| --- | --- | --- |
| Native package/host | Pinned Durable peers; registry extension/provider; removed coding-agent discovery and controller | TypeScript build, real Harness and packed-package execution |
| System 1 interface | JSON packet, pure versioned resolver, native classifier and task memos | Exact bindings, invalid input, late result and crash recovery |
| System 2 | Owned child conversation, native generation/tool loop, saved scope and structured return | Native permissions, nested grants, limits, cancellation, evidence and recovery |
| Product application | Ordinary tools/documents; native SQLite bootstrap | News A+B, preview, receipts, deduplication and unknown-effect reconciliation |
| Long-running example | Application `defineTask` with saved next due/check deadline and stable submission | Pause on failure, reopen without resetting timer, native cancellation |
| Migration/reviewer docs | HLD/LLD, ownership, before/after, applicability table, runnable guide | Source-linked contracts and explicit evidence limits |

## Deployment work requiring real configuration

1. Select actual accounts, feeds, native model providers and credentials; run preview.
2. Evaluate Jev with independently labelled A-only, B-only, A+B, corrections, contradictions, duplicate and stale-position cases.
3. Evaluate scoped helper returns, denied reads, failure/timeout and uncertainty with the selected physical model.
4. Reconcile/import existing application receipt data before enabling Telegram in a new SQLite ledger. No automatic legacy importer is included.
5. Verify a previewed message and real Telegram receipt using the operator's chosen destination.
6. Configure the application's process supervisor and storage backup policy; verify restart in that deployment.

These are live deployment/evaluation steps, not claims of tests already performed. No monitor, model call or external delivery was enabled by implementing this migration.

## Outside this version

Automatic state selection, shrinking, summarization, semantic article retrieval, learning/consolidation, a generic workflow/scheduler, multiplayer UI, old-session conversion and exactly-once external effects.

Future learning work requires separate scope. This runtime's temporary recovery memos do not constitute a permanent evaluation dataset.
