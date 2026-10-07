# Implementation plan and status

Updated **2026-10-07** after building Turbo V1 and the requested Hyperliquid/news
companion. [Architecture](../ARCHITECTURE.md) · [evidence](development.md) ·
[Pi Durable applicability](research/pi-durable-applicability.md).

## Completed local implementation

| Step | Concrete result | Verification |
| --- | --- | --- |
| 1. Native Pi path | Stable `turbo/auto` virtual selection + custom System 1 Provider calling the native classifier. | Actual Pi session and normal tool-result continuation. |
| 2. Author Interface | `registerSystem1`, `prepareTurn`, paired `resolve`, tool/consult/final decisions. | Independent counter/helper fixtures and real news companion; both load orders and duplicates. |
| 3. V1 control | Attempt/branch/revision/phase, exact binding, work/time ceilings and explicit errors. | Cancel, stale reply, reload, branch navigation, captured in-flight restore and overflow paths. |
| 4. System 2 | Optional native Agent inside `turbo_consult`; scoped brief and parent native tool forwarding. | Multi-tool return, host denial, exhaustion, cancel, usage and incomplete/error outcomes. |
| 5. Requested product | Hyperliquid exposure inventory, RSS/Atom archive, authored joint context, template preview/send and receipt ledger. | Author path and HTTP-boundary tests; no live model or delivery claim. |
| 6. Package and guide | Private local Pi package, runnable example/configs, source/packed discovery and visual user guide. | Type/build, loader, headless CLI and documentation/visual checks. |

**Transport decision:** use Pi's native `Agent` with explicit parent tool forwarding.
The earlier same-session phase-routing sketch is superseded; no bespoke agent loop
or separately durable child session was added.

## Remaining deployment validation

These require actual user configuration; they are not hidden implementation success claims.

1. **Configure:** public account/subaccounts, selected feeds and TypeSafe access.
   Start in preview mode and verify the reported account/DEX/source coverage.
2. **Measure Jev:** A alone, B alone, A+B, correction, contradiction, duplicate claim,
   unrelated entity, stale/closed position and long/short direction. Record actual
   answers, returned model version, usage, latency and disagreements with policy.
3. **Optional helper:** select an authenticated physical Pi model. Check live source
   reads, explicit return, incomplete evidence and provider errors under its limits.
4. **Delivery:** choose a Telegram bot/chat and enable live mode explicitly. Verify
   an actual receipt and inspect timeout/unknown reconciliation before continuous use.
5. **Release:** choose registry/repository identity and version only on a separate
   publication request. Keep `private: true` until then. Retest any newer Pi baseline.

The independent ticket-triage product remains an authored design example, outside
the requested Hyperliquid implementation. Implement its real ticket-fetch/assignment
Adapters and category evaluation when selected; never substitute success for an
unavailable assignment tool. No domain changes should be needed in Turbo.

## Deliberately outside V1

Automatic retrieval/grouping, state reduction, question splitting, semantic
checkpoints, compaction, overflow recovery and a reusable story-memory Module
remain **V2**. Authors can implement their own explicit selection and storage now.
Dollar spend caps are also not implemented; current ceilings bound steps, turns,
tool calls and elapsed time.

Durable crash continuation is a separate host decision, not a V2 context feature.
Evaluate the actual host/storage contract before promising replay or background
jobs. The example's `/news-watch` timer only lives while its Pi process is open.
Interrupted effects remain unknown until the author/operator reconciles them.
