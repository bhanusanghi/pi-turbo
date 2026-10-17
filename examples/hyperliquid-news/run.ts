import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { typesafeProvider } from "@earendil-works/pi-ai/providers/typesafe";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { Harness, createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createTurbo, type ModelRef, type System2Options } from "pi-turbo";
import { createNewsApplication } from "./index.js";
import { NewsWatch, startWatch, stopWatch } from "./watch.js";
import type { NewsConfig } from "./types.js";

type Settings = { classifier: ModelRef; system2?: System2Options | { enabled: false } };
const read = async <T>(path: string) => await Bun.file(path).json() as T;
const seconds = (value: string, name: string) => {
  const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0 || n > 2_147_483) throw new Error(`${name} must be a positive integer in seconds`);
  return n * 1000;
};

/** The host owns providers, credentials, SQLite, scheduling and shutdown. */
export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    news: { type: "string", default: "news.local.json" }, turbo: { type: "string", default: "turbo.local.json" },
    interval: { type: "string", default: "300" }, deadline: { type: "string", default: "120" }, help: { type: "boolean" },
  } });
  const [command = "help", ...args] = positionals;
  if (command === "help" || values.help) {
    console.log("news <check|watch|worker|stop|status|resolve KEY sent RECEIPT|resolve KEY not-sent> [--news FILE] [--turbo FILE] [--interval SECONDS] [--deadline SECONDS]");
    return;
  }
  if (!["check", "watch", "worker", "stop", "status", "resolve"].includes(command)) throw new Error("Unknown command; run with --help");
  const settings = await read<Settings>(values.turbo!);
  const app = createNewsApplication(await read<NewsConfig>(values.news!));
  const models = createModels();
  models.setProvider(typesafeProvider()); models.setProvider(openaiProvider());
  if (!models.getModelOfType("classifier", settings.classifier.provider, settings.classifier.modelId)) throw new Error("Unknown classifier in this host's native model catalog");
  if (settings.system2?.enabled && !models.getModel(settings.system2.model.provider, settings.system2.model.modelId))
    throw new Error("Unknown helper model. This example host registers TypeSafe and OpenAI; add your chosen native provider in run.ts");
  const turbo = createTurbo({ integration: app.integration, classifier: settings.classifier, tools: app.tools,
    ...(settings.system2?.enabled ? { system2: settings.system2 } : {}) });
  models.setProvider(turbo.provider);
  const registry = createRegistry();
  const scheduling = defineExtension({ name: "hyperliquid-news.schedule", tasks: [NewsWatch] });
  registry.install(app.extension); registry.install(turbo.extension); registry.install(scheduling);
  const database = resolve(app.config.databaseFile);
  await mkdir(dirname(database), { recursive: true });
  const context = BACKGROUND_CONTEXT;
  const harness = await Harness.open(await openNodeSqliteStorage(database), {
    registry, models, settings: { compaction: { enabled: false }, retry: { enabled: false }, toolExecution: "sequential" },
    onReport: error => console.error("Durable:", error),
  }, context);
  const agent = { model: turbo.model, extensions: [app.extension, turbo.extension, scheduling], tools: [...app.tools, turbo.consultTool] };
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => { stop = resolve; });
  const shutdown = () => { stop(); void harness.close(context).catch(error => console.error(error)); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  try {
    const root = await harness.root(context, { agent });
    if (command === "status") {
      const state = await harness.snapshot(app.documents.News, app.scope, context);
      console.log(JSON.stringify({ database, pending: await harness.inspect(context),
        articles: state?.articles.length ?? 0, alerts: state?.alerts ?? {} }, null, 2));
    } else if (command === "resolve") {
      const [key, outcome, receipt] = args;
      if (!key || (outcome !== "sent" && outcome !== "not-sent")) throw new Error("resolve KEY sent RECEIPT | resolve KEY not-sent");
      await harness.commit(tx => app.reconcile(tx, key, outcome, receipt), context);
      console.log("Recorded the operator's reconciliation");
    } else if (command === "stop") {
      await stopWatch(harness, root, context); console.log("Watch stopped");
    } else if (command === "check") {
      const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, context);
      const limited = withAbortSignal(AbortSignal.timeout(seconds(values.deadline!, "deadline")), context);
      try {
        const settled = await (await conversation.submit({ type: "input", content: "Check portfolio news", requestId: "check" }, context)).wait(limited);
        const messages = (await conversation.context(context)).messages;
        const answer = messages.findLast(message => message.role === "assistant");
        console.log(JSON.stringify({ conversationId: conversation.id, settled, answer }, null, 2));
        if (answer?.rawStopReason !== "turbo.completed") process.exitCode = 1;
      } catch (error) {
        if (limited.abortSignal?.aborted) await conversation.abort(context);
        throw error;
      }
    } else {
      // Reconfiguration is explicit application policy. Recipe revisions protect saved bindings.
      await root.configure(agent, context);
      if (command === "watch") console.log("Watch task", await startWatch(root, context,
        seconds(values.interval!, "interval"), seconds(values.deadline!, "deadline")));
      harness.resume();
      console.log("Worker running. SIGINT/SIGTERM closes storage and preserves pending work. Use stop after shutdown to cancel the watch.");
      const keepAlive = setInterval(() => {}, 60_000);
      try { await stopped; } finally { clearInterval(keepAlive); }
    }
  } finally {
    process.removeListener("SIGINT", shutdown); process.removeListener("SIGTERM", shutdown);
    await harness.close(context);
  }
}
if (import.meta.main) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
