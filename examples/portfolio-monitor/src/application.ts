import type { Config } from "./config.js";
import { createStore } from "./storage/index.js";
import { createPortfolioModule } from "./portfolio/index.js";
import { createDeliveryModule } from "./delivery/index.js";
import type { TelegramOptions } from "./delivery/telegram.js";
import { createQueueRuntime } from "./queues/index.js";
import { createHttp } from "./http/index.js";
import type { PortfolioProvider } from "./contracts.js";
import { resolve } from "node:path";
import { createSourceStore } from "./sources/store.js";
import { createSourceModule } from "./sources/index.js";
import { createSourceSecretResolver } from "./sources/secrets.js";
import { sourceExtensions as defaults } from "./providers/index.js";
import { createSourceCatalog } from "./sources/catalog.js";
import type { SourceExtension } from "./sources/extension.js";
import type { SourceClients } from "./sources/contracts.js";

export function createApplication(config: Config, options: {
  portfolioProvider?: PortfolioProvider;
  telegramClient?: TelegramOptions["createClient"];
  resolveSecret?: (name: string) => string | undefined;
  logger?: boolean;
  onError?: (error: unknown) => void;
  sourceClients?: Partial<SourceClients>;
  sourceExtensions?: readonly SourceExtension[];
} = {}) {
  const extensions = options.sourceExtensions ?? defaults;
  const catalog = createSourceCatalog(extensions);
  const store = createStore(config.databaseUrl, catalog);
  const onError = options.onError ?? (() => {});
  const resolveSourceSecret = createSourceSecretResolver(options.resolveSecret);
  const sourceStore = createSourceStore(config.databaseUrl, store);
  const context = { store, resolveSecret: resolveSourceSecret,
    dataDirectory: resolve(config.sourceDataDir ?? ".source-data"), onError };
  const sourceClients: SourceClients = Object.fromEntries(extensions.map(extension =>
    [extension.id, options.sourceClients?.[extension.id] ?? extension.createClient(context)]));
  const receivers = extensions.flatMap(extension => extension.receivers?.(context) ?? []);
  const sources = createSourceModule({ store, sourceStore, clients: sourceClients, onError });
  const portfolios = createPortfolioModule({ store, provider: options.portfolioProvider, refreshIntervalMs: config.refreshIntervalMs, onError });
  const deliveries = createDeliveryModule({ store, resolveSecret: options.resolveSecret ?? (name => process.env[name]), createClient: options.telegramClient });
  const queues = createQueueRuntime({ store, redisUrl: config.redisUrl, prefix: config.queuePrefix,
    dispatchIntervalMs: config.dispatchIntervalMs, processRefresh: portfolios.processRefresh, processDelivery: deliveries.processDelivery, processSourceSync: sources.processSync, onError });
  const http = createHttp({ store, portfolios, deliveries, queues, sources, sourceStore, catalog, receivers, apiToken: config.apiToken, logger: options.logger });
  let closing: Promise<void> | undefined;
  let started = false;
  async function close() {
    return closing ??= (async () => {
      // Stop accepting work, stop producers, drain/abort workers, then close storage.
      await http.close();
      await sources.close();
      await portfolios.close();
      await queues.close();
      await sourceStore.close();
      await store.close();
    })();
  }
  return { store, portfolios, deliveries, queues, sources, sourceStore, http, close,
    async start(listen = true) {
      if (started) return;
      started = true;
      try {
        await store.migrate();
        await store.recoverWork();
        await sourceStore.recoverRunning();
        await queues.start();
        await sources.start();
        await portfolios.start();
        if (listen) await http.listen({ host: config.host, port: config.port });
        else await http.ready();
      } catch (error) { await close(); throw error; }
    },
  };
}
