# pi-turbo

**A working local Pi extension that makes authored Jev judgments drive native Pi tools.**
Optional, operator-enabled System 2 handles scoped subtasks and returns evidence to Jev.
State and context stay author-managed in V1; automatic management is V2.

Start with the **[Hyperliquid portfolio + news watcher](examples/hyperliquid-news/README.md)**
and its **[interactive visual guide](docs/visuals/hyperliquid-news.html)**.

```text
AUTHOR: state + typed questions → TURBO: native Jev call
  → AUTHOR: answer-to-tool binding → PI: execute + hooks + result → repeat
                       ↘ optional native Pi helper Agent → findings → Jev
```

## Run locally

Node ≥22.19; tested with Pi **1.0.4**. This package remains private and unpublished.

```sh
npm ci --ignore-scripts
npm run build
npm test
```

Follow the watcher guide to configure your public wallet, RSS feeds and TypeSafe
credentials. It starts in preview mode. No account, token or Telegram destination
is embedded, and installing Turbo starts no polling or external action.

## Author a companion

Register domain tools with Pi and your decision contract with Turbo:

```ts
import { registerSystem1 } from "pi-turbo";

export default function (pi) {
  pi.registerTool(myDomainTool); // native Pi schema + execute()
  registerSystem1(pi, {
    id: "my-agent", revision: "1", tools: [myDomainTool.name],
    prepareTurn(ctx) {
      const state = readMyState(ctx.pi.sessionManager.getBranch());
      return { request: { state, questions: myQuestions },
        resolve: answers => bindMyDecision(state, answers) };
    }
  });
}
```

The small example above is pseudocode around author functions. The
[news companion](examples/hyperliquid-news/index.ts) is executable TypeScript.
`resolve` returns a tool binding, a consultation request, or an explicit final
outcome. Turbo supplies no news, relevance, position or team-routing policy.

## Implementation and evidence

- [Architecture and ownership](ARCHITECTURE.md)
- [Implemented V1 Interface, Pi hooks and lifecycle](docs/v1-implementation.md)
- [Development and verification boundaries](docs/development.md)
- [Implementation plan and remaining validation](docs/implementation-plan.md)
- [Pi Durable applicability table](docs/research/pi-durable-applicability.md)
- [Independent ticket-triage design](examples/ticket-triage/README.md)
- [Extended news/V2 design](examples/news-agent/README.md)

Tests use actual Pi sessions, registration, tool hooks, continuation and author
storage. Inference and external HTTP are substituted; live model quality and
Telegram delivery are not verified. Pi loads the declared TypeScript extension;
compiled exports provide the companion Interface. Host packages are peers per the
[Pi package guide](https://pi.dev/docs/latest/packages).

Publishing is separate: [release guidance](docs/releasing.md). MIT: [LICENSE](LICENSE).
