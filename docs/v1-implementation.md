# Turbo V1 implementation

Current runtime: **Pi Durable 1.2.0**. [Architecture](../ARCHITECTURE.md) describes executable behavior and limitations; [migration comparison](durable-migration.md) names the former coding-agent baseline.

```text
src/
├─ contracts.ts          author decision interface and consultation data
├─ extension.ts          native hooks, saved judgments and tool binding checks
├─ runtime/provider.ts   local signed decision transport; native loop remains host-owned
├─ runtime/protocol.ts   JSON, answer and grant validation
└─ helpers/system2.ts    scoped native child conversation, limits and return
```

## Decision interface

Illustrative pseudocode:

```ts
prepareTurn({ api, consultation }, context) {
  state = api.snapshot(ProductDoc, conversationId, context)
  return { request: { state: selectContext(state, consultation), questions }, bindings }
}
resolveTurn(packet, answer) {
  return { kind: "tool", name: "product_action", args: bind(packet, answer) }
}
product_action(args, api, context) {
  validateCurrentPermissions(args)
  return executeAndCommitApplicationResult(args, api, context)
}
```

The first two functions are the Turbo integration. The third is an ordinary Durable `defineTool`. Jev sees only authored inputs. Turbo persists packets/answers/decisions as native task memos and emits native tool calls.

Consultation creates or reuses a task-owned native conversation. Its generation hook calls the configured physical model through native `Models`; Durable executes tools and continues. Scope documents and execution wrappers preserve grants, deadlines and tool budgets. Structured findings and real evidence return to the next System 1 judgment.

No Turbo scheduler, product state abstraction, custom storage engine or automatic context manager is present. See [verification](development.md) for tested production paths and live-validation gaps.
