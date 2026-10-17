# pi-turbo

**System 1 decisions and optional System 2 consultation for Pi Durable applications.** Built against `@earendil-works/pi-durable` **1.2.0**, running on **Bun 1.4.3**.

Your tools and application state remain ordinary Durable code. Turbo connects authored state/questions to Jev, translates the answer into a native tool call, and provides bounded consultation that returns to System 1.

| Your application | Turbo | Pi Durable |
| --- | --- | --- |
| Goals, documents, context, questions, mappings | Jev integration and decision translation | Models and native tool execution |
| Product tools, permissions, model/storage selection | Optional consultation and its limits | Conversations, ownership, recovery and storage primitives |

```ts
// Bootstrap excerpt. integration and productTools are authored application code.
const turbo = createTurbo({
  integration,
  classifier: { provider: "typesafe", modelId: "jev-latest" },
  tools: productTools, // ordinary defineTool() references
});
registry.install(productExtension);
registry.install(turbo.extension);
models.setProvider(turbo.provider);
const root = await harness.root(context, { agent: {
  model: turbo.model,
  extensions: [productExtension, turbo.extension],
  tools: [...productTools, turbo.consultTool],
} });
await (await root.submit({ type: "input", content: "Check", requestId: "job-42" }, context)).wait(context);
```

The application creates `models`, `registry`, storage and `harness` using Durable. The [packed-package test](test/package.test.mjs) exercises this interface through the native test host.

Bun is the runtime, package manager and test runner. The package pins it in `.bun-version`; use the checked-in `bun.lock` file. The SQLite host uses Durable's stock `storage/sqlite/node` adapter through Bun's `node:sqlite` compatibility. Bun 1.4.3 is required; 1.3.14 does not implement that module.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test
```

[Architecture / HLD and LLD](ARCHITECTURE.md) · [before and after migration](docs/durable-migration.md) · [public types](src/contracts.ts) · [verification](docs/development.md) · [implementation status](docs/implementation-plan.md).

This migration replaces the coding-agent host integration. `pi -e`, `/pi-turbo`, companion registration, old session files and `stateFile` configuration do not apply. Application data migrations remain the responsibility of the consuming application.

V1 context remains author-managed. Turbo reports overflow; it does not summarize or silently enable an LLM. System 2 is opt-in. Durable resumes pending tasks; applications retain responsibility for safe replay and uncertain external effects.

The package remains local/private. Tests cover native execution and process recovery with substituted inference/network calls; live model quality and external delivery are unverified.
