# Runtime implementation status

The reusable runtime targets Durable / pi-ai / Chord **1.2.0** on Bun **1.4.3**.

| Area | Implemented result | Validation |
| --- | --- | --- |
| Host integration | Native registry extension, provider, hooks and tool wrappers | Real Harness, type check and packed-package execution |
| System 1 | JSON packet, pure versioned resolver, native classifier and task memos | Exact bindings, invalid input, late results and crash recovery |
| System 2 | Owned child conversation, native tools, saved scope and structured return | Permissions, nested grants, limits, cancellation, evidence and recovery |
| Context | Author-selected state; explicit failure on invalid or oversized input | No implicit fallback or automatic compaction |

## Work for consuming applications

Register ordinary Durable tools, choose storage/model providers, define authored state/questions/bindings and configure consultation. Independently validate model decisions on representative labelled cases. Application deployment, data migrations, scheduling and effects remain outside this runtime.

## Outside this version

Automatic context selection, shrinking, summarization, learning/consolidation, a generic workflow scheduler, product UI, old-session conversion and exactly-once external effects. Temporary recovery memos are not a permanent evaluation dataset.
