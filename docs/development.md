# Development

Turbo V1 and the Hyperliquid/news companion are implemented. Read the
[architecture](../ARCHITECTURE.md) before changing model inputs, action bindings,
control state or helper availability. [Public Interface](../src/contracts.ts) ·
[implementation](v1-implementation.md) · [remaining work](implementation-plan.md).

## Local checks

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

`npm test` builds the package and examples, then runs native Pi integration,
HTTP-adapter and package-discovery tests. Tests use isolated temporary credential,
settings and session locations; they do not use a real wallet or Telegram account.
If your default npm cache is unwritable, use a writable `--cache` path; do not change
system ownership to run these checks.

Run the [watcher guide](../examples/hyperliquid-news/README.md) with the project's
`node_modules/.bin/pi`. Development is pinned to Pi **1.0.4**. The broad peer ranges
follow Pi packaging rules; they do not assert older or future API compatibility.

## Verification: 2026-10-07

**32 tests passed**, including source/archive discovery. The interactive guide was
checked in the browser, including A+B/overflow/unknown-delivery/help controls and a
narrow viewport without page overflow. These visual checks do not run the agent.

| Evidence | Result / limit |
| --- | --- |
| TypeScript package + runnable companion | Checked and compiled against installed Pi 1.0.4. |
| Native integration | Real loader, ModelRuntime, AgentSession, classifier Adapter, tool hooks and continuation. Inference is substituted at its boundary. |
| Registration | Both load orders, duplicate IDs, missing configuration and reload. |
| State/lifecycle | Active-branch reconstruction, actual interrupted helper snapshot, cancellation, late model reply rejection; no pending-call replay. |
| Context exceptions | Rejected classifier input never reaches resolve/effect or unchanged reclassification; manual compaction and direct auxiliary calls are blocked. |
| System 2 | Isolated brief, multi-tool Agent loop, exact argument grants, host denial, return, error/exhaustion/cancel, mixed completion/effect rejection. |
| Usage | Helper model usage plus nested tool usage counted once by the parent Pi record. |
| News author path | A skipped but retained, A+B passed to next judgment, preview, receipt/deduplication, stale positions and unknown-send reconciliation. |
| HTTP adapters | Native/HIP-3 perp and spot response shapes, RSS/Atom parsing, corrections, API errors, Telegram receipt and token-safe errors; fetch is substituted. |
| Packaging | Source package + companion and unpacked npm archive load through native discovery. Declared exports are present; secrets/session/config files excluded. |
| Headless CLI | Real project binary reaches the author's missing-wallet final outcome with no model credentials or external calls. |

**Not verified:** live Jev relevance/correlation accuracy, a live System 2 provider,
actual Hyperliquid account reads, RSS availability, Telegram delivery, every
third-party extension combination, power-loss persistence or automatic crash resume.
No runtime code depends on the empty V2 `src/context/` implementation homes.

## System 1 input review

Next judgment: “How should this article be handled, and which held exposure is
most directly affected?” Current article, prior articles, timestamps, source URLs,
previous judgments, explicit policy, portfolio coverage and optional helper evidence
support that judgment. The focus question does not read the action answer.

Before the news companion, the repository had only a design sketch and no model
payload. Now the real preparation path sends A alone, records `skip`, then sends
A+B with A's prior judgment. A test inspects those exact requests and the persisted
receipt. The model answers in that test are supplied inference doubles, so this
proves state/meaning and control transport, not Jev's semantic success. The authored
window omits older articles explicitly; it is not evidence of improved efficiency.

## Native contracts to preserve

Register providers/models/tools in the factory; initialize session resources on
session start and close them on shutdown. Do not use private Pi APIs. Retain native
validation, installed hooks, cancellation, physical model identity and usage.
Author state and effects remain author-owned. Tests must cross production paths;
never add hardcoded-success substitutes for missing tools or model capability.

The [Pi Durable comparison](research/pi-durable-applicability.md) guides ownership,
unknown effects and cancellation. Durable's registry, scheduler and storage are
not present in this coding-agent extension. The earlier design is retained as
research, with its superseded transport clearly marked.
