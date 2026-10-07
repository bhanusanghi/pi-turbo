# Turbo V1 implementation

Implemented locally against **Pi 1.0.4**, 2026-10-07. The concrete public Interface
is [contracts.ts](../src/contracts.ts); automatic context/state management remains V2.
[Runnable watcher](../examples/hyperliquid-news/README.md) · [Visual guide](visuals/hyperliquid-news.html).

## Small author Interface, deep runtime Module

```ts
registerSystem1(pi, {
  id, revision, tools,
  prepareTurn({ pi: ctx, signal, attemptId, step, capabilities, consultation }) {
    // Author chooses state, questions and interpretation.
    return { request: { state, questions }, resolve };
    // Or return { kind: "final", status, text } for known terminal conditions.
  }
});
```

`resolve` returns exactly one of:

```ts
{ kind: "tool", name, args }
{ kind: "consult", request: { goal, inputs, doneWhen, tools } }
{ kind: "final", status, text }
```

Each helper grant supplies exact allowed `arguments` objects or explicitly sets
`allowAnyArguments: true`. The operator's configured tool list is an additional
ceiling. Authored request/resolve functions are paired with the current attempt;
closures are rediscovered from code, never persisted.

## Call path and ownership

```text
PI session prompt / native continuation
  TURBO virtual model: turbo/auto
    TURBO Provider: turbo/system1
      AUTHOR prepareTurn(current Pi context)
      PI registry.classify(configured Jev, authored request)
      TURBO validate status + typed answers
      AUTHOR resolve(exact result)
      TURBO validate binding → native assistant tool call
  PI validate tool + installed hooks → AUTHOR tool implementation
  PI turn_end → next response / explicit final
```

There is no second System 1 agent loop. Turbo does not translate arbitrary tools
into model questions. A direct/auxiliary request is rejected before classification.
Custom entries are execution records; they are not automatically sent to Jev.

## Optional System 2

```text
JEV help choice → AUTHOR scoped request → PI turbo_consult tool
  TURBO records phase=s2
  PI Agent (isolated brief, own native tool loop)
    physical LLM → allowed wrapper → parent ctx.executeTool → native hooks + actual result
    turbo_finish alone → structured result
  TURBO records findings + actual tool outcomes; phase=s1
PI normal continuation → AUTHOR decides what evidence Jev sees next
```

**Why this transport:** isolation makes the helper's starting context explicit and
its cancellation owned by the parent tool. A same-session phase router was an
initial proposal; the implemented helper is a native `pi-agent-core` Agent, not a
separately persisted `AgentSession`. Parent context hooks are not automatically
applied to its messages. Parent request instrumentation is forwarded; native tool
execution/permission hooks apply through `ctx.executeTool`.

Natural text without `turbo_finish` returns `incomplete`. Denial, model error and
work/time exhaustion return distinct evidence. Parent cancellation aborts actual
helper work, awaits idle, and does not restart Jev. One helper runs at a time; no
recursive Turbo consultation. Domain tools must honor their AbortSignal.

Model usage is recorded on the consultation result. Pi aggregates nested tool
usage separately onto the parent tool-result message. Failed calls remain recorded;
zero/unknown provider prices are not evidence of free execution. Work/time ceilings
exist; dollar spend enforcement does not.

## State and exceptions

| Owner | Persistence | Handling |
| --- | --- | --- |
| Author | Native Pi entries or chosen file/DB | Schema, migrations, evidence selection, retention, outcome interpretation and effect ledger. |
| Turbo | `pi-turbo/control-v1` on active branch | Integration/revision, session/anchor/attempt, phase, deadline, steps, pending exact call and last consultation. |
| Turbo | Judgment/helper custom entries | Actual model identity, status, usage and returned evidence. |
| Pi | Session tree, transcript and native nested-call records | Dispatch, validation, registered hooks and ordinary continuation. |

Restore marks any unfinished attempt as an error and retains its pending identity;
it never replays saved tools/resolvers. A new user attempt re-prepares state. Authors
must reconcile unknown external outcomes. Branching a session does not undo them.

Input overflow or malformed answers stop before resolve/dispatch. Turbo does not
change author data, split questions, summarize or call System 2 to repair input.
`session_before_compact` cancels Turbo compaction and aborts the unchanged attempt;
other selected models retain their own behavior. Start a fresh Pi session when
needed while retaining the author's long-lived evidence/receipts.

## Files and native extension rules

| File | Responsibility / Pi facility |
| --- | --- |
| `src/extension.ts` | Factory registers flags, commands, native Provider, virtual model and consultation tool. Hooks bind session start/tree/turn/settled/model selection/compaction/shutdown. |
| `src/registration.ts` | Versioned `pi.events` handshake; both load orders and reload. Duplicate IDs fail. |
| `src/runtime/provider.ts` | Native assistant event stream and errors; forwards cancellation/instrumentation. |
| `src/runtime/lifecycle.ts` | Control records, timers, abort ownership, active-branch restore and stale-return checks. |
| `src/runtime/protocol.ts` | JSON/answer/tool-scope mechanical checks. Frozen approved arguments prevent later object mutation. |
| `src/helpers/system2.ts` | Native Agent, explicit tool forwarding, completion and result/usage recording. |
| `src/context/` | Empty V2 implementation homes; no V1 exports or dependencies. |

Registration happens in the factory; session resources initialize on session start
and clean up on shutdown. UI calls are guarded; execution works headlessly. Tools
are ordinary Pi tools with schemas and actual results. Host dependencies are peers,
not bundled copies. These are the applicable
[Pi extension](https://pi.dev/docs/latest/extensions) and
[package](https://pi.dev/docs/latest/packages) conventions.

## Verification boundary

Tests cross production preparation, resolution, the native provider/tool pipeline,
helper Agent, parent hooks, author file persistence, reload and branch navigation.
A captured in-flight helper snapshot restores as interrupted without replay.
HTTP-adapter tests parse actual response shapes and RSS/Atom, using network doubles.
The source package and npm archive load through Pi discovery.

No live model or external delivery was exercised. Tests establish control flow and
input meaning, not Jev relevance accuracy, third-party hook compatibility, hard
termination of uncooperative tools, or power-loss/durable automatic continuation.
See [development](development.md) and [remaining validation](implementation-plan.md).
