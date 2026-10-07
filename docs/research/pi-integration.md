# Pi integration research

Checked **2026-10-07**. Published npm latest is **1.0.4**, also pinned in this
package's development dependencies; registry git head is
`7c10bd4337495ee613f2224843ecdf349b80d1df`.
[Registry metadata](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest).
This page retains source research and the original transport proposal. The
[implemented transport and evidence](../v1-implementation.md) supersede that proposal.

**Host scope:** this page describes Pi coding-agent. Pi Durable has a separate
extension Interface; these provider, virtual-model and classifier findings do not
automatically apply there. See the [Durable applicability table](pi-durable-applicability.md)
for adopted V1 principles, host-dependent recovery and deferred automation.

## Verified facilities

| Native facility | Current use in Turbo |
| --- | --- |
| `ctx.modelRegistry.classify()` and classifier lookup | Invoke Pi's existing Jev backend; retain result status, usage and physical identity. |
| `registerProvider()` with custom streaming | Chat-shaped Adapter from authored typed decisions to Pi assistant/tool responses. |
| `registerVirtualModel()` | User selects Turbo; route chooses the System 1 Adapter. S2 uses a separate native Agent. |
| `registerTool`, extension events/hooks | Companion extensions register ordinary tools and discover the registration Seam. |
| `appendEntry`, `sessionManager.getBranch()` | Store/reconstruct versioned domain/control state on the active branch. |

Pi includes TypeSafe Jev as a classifier. Classifiers are not `/model` chat choices;
extensions call them directly without requiring codemode. Reuse credentials and
model lookup instead of building another TypeSafe HTTP/auth layer.
[Classifier guide](https://pi.dev/docs/latest/models#use-classifier-models).

Virtual routing selects a physical chat model, never another virtual model.
Selection and physical response identity differ. Route state follows the branch;
`direct` requests have no persistent route state. These details motivate separate
handling for action decisions and auxiliary requests.
[Virtual models](https://pi.dev/docs/latest/virtual-models).

The custom provider must preserve native response/stream shape, cancellation,
terminal error handling and request instrumentation. Using a classifier internally
does not exempt its outer Adapter from those contracts.
[Custom providers](https://pi.dev/docs/latest/custom-provider).

## Three Interfaces, not interchangeable schemas

```text
Author Interface: prepareTurn(snapshot) → { request, resolve }
Pi classifier:    classify(model, { state, questions }) → typed answers/status/usage
Pi agent loop:    normal assistant message → tool calls or final output
```

The direct TypeSafe SDK's `noul`/Choice/Score schema is not Pi's normalized schema.
Pi uses `choice`, `bool`, `score`; Choice criteria are a map, Boolean criteria use
`true`/`false`, and Score criteria are ordered strings. Inspect `stopReason` and
actual answers; don't map missing/error responses into a valid decision.
[Normalized contract](https://pi.dev/docs/latest/codemode),
[pinned extension types](https://github.com/earendil-works/pi/blob/7c10bd4337495ee613f2224843ecdf349b80d1df/packages/coding-agent/src/core/extensions/types.ts).

## Original same-session transport proposal (superseded)

```text
S1 phase → chat Adapter → registry.classify(Jev) → authored tool binding
   → begin_help tool persists helper scope/phase
S2 phase → selected LLM → ordinary Pi tools, possibly many turns
   → return_to_jev tool validates result and persists S1 phase
S1 phase → author includes returned evidence → next Jev judgment
```

`begin_help` and `return_to_jev` are proposed Turbo tools, not existing Pi APIs.
The phase record must have one authoritative source; derive routing from it, rather
than letting independently mutable router state and helper state drift.

The same-session design must demonstrate these properties before it becomes the
implementation contract:

- Project only the approved helper brief/context; inspect the exact resulting
  system prompt, tool definitions and messages. Prompt instructions alone do not
  enforce scope.
- Enforce the grant at execution hooks, including argument/resource scope. Check
  nested execution and parallel calls. A handover tool and sibling tool calls in
  one response must not execute under different accidental authority.
- Define natural LLM final output, missing structured return, error and exhaustion.
  `agent_before_settle` is a candidate for a bounded return continuation;
  `agent_settled` is notification, not a tool-result loop. Prove event timing.
- Preserve cancellation, actual usage, task identity, active branch, resume and
  real effect receipts. Never infer main completion from LLM silence/settlement.

Use Pi factories for registration and lifecycle events for session resources;
cleanup must be idempotent. `tool_call`/`tool_result` hooks compose with installed
extensions. `ctx.executeTool()` preserves execution hooks, but nested execution
is not an independent transcript turn; explicitly retain required result evidence.
[Extension lifecycle and tool contracts](https://pi.dev/docs/latest/extensions).

If this spike cannot provide a clean scoped helper, compare an isolated SDK session.
Explicitly supply/forward its tools, permission checks, cancellation, history and
usage to the parent; separate sessions are not automatic inheritance.
[SDK facilities](https://pi.dev/docs/latest/sdk).

## Compaction and auxiliary requests

Pi checks its conversation against model context limits before requests, including
the routed model's limit. Therefore a small projected Jev payload does not itself
prevent Pi compaction. Virtual route `reason: "direct"` includes summary requests;
it must not run `prepareTurn` for a business action.

V1 scope: return an explicit unsupported/cancelled compaction outcome while Turbo
owns the request, preserve author/control state, and stop the unchanged attempt.
Prove this through Pi's actual recovery path; a classifier catch alone is insufficient.
An author may supply a deliberate native context policy. V2 adds Turbo-managed
checkpoints and explicitly enabled summarization. Do not globally change other
models' compaction behavior.
[Compaction hooks](https://pi.dev/docs/latest/compaction).

Custom entries are excluded from ordinary LLM context. Compaction reduces model
context, not the original session record into oblivion. Still, source retention in
the author store has its own limits and must be tested separately.
[Session format](https://pi.dev/docs/latest/session-format).

## Currency and evidence gates

Pin the development baseline; check registry/changelog/catalog before implementation
and upgrades. Record the concrete resolved Jev/S2 versions when available, not only
moving aliases. Capability checks must fail clearly on unsupported Pi versions.
Unknown catalog price is not proof of zero cost; spend limits must not treat missing
price data as free usage.

Unverified here: the complete Adapter stream, helper handover, provider/token
measurement, hidden context leakage, hook ordering, accounting, branch recovery,
live model accuracy and actual external delivery. The
[plan](../implementation-plan.md) turns these into implementation gates.
