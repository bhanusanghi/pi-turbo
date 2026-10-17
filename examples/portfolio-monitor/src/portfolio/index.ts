import { randomUUID } from "node:crypto";
import { AppError, type Account, type AppStore, type PortfolioProvider, type RefreshRequest } from "../contracts.js";
import { createHyperliquidProvider } from "./hyperliquid.js";

export { createHyperliquidProvider } from "./hyperliquid.js";

export type PortfolioModuleOptions = {
  store: AppStore;
  provider?: PortfolioProvider;
  refreshIntervalMs?: number;
  onError?: (error: unknown) => void;
};

/** Ordinary application lifecycle: PostgreSQL coalesces account refreshes. */
export function createPortfolioModule(options: PortfolioModuleOptions) {
  const { store } = options;
  const provider = options.provider ?? createHyperliquidProvider();
  const interval = options.refreshIntervalMs ?? 60_000;
  if (!Number.isFinite(interval) || interval < 100) throw new Error("refreshIntervalMs must be at least 100");
  const controller = new AbortController();
  const subscriptions = new Map<string, { revision: number; close: () => Promise<void> }>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let reconciling: Promise<void> | undefined;
  let started = false;
  const report = (error: unknown) => options.onError?.(error);

  async function accounts(): Promise<Account[]> {
    const result: Account[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.listResources("accounts", { limit: 100, ...(cursor ? { cursor } : {}) });
      result.push(...page.items.filter(account => account.enabled));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return result;
  }

  async function requestAccount(account: Account, reason: string) {
    if (!controller.signal.aborted) await store.requestRefresh(account.id, reason, randomUUID());
  }

  async function reconcile() {
    if (controller.signal.aborted) return;
    const reason = started ? "periodic_refresh" : "startup";
    const current = await accounts();
    const byId = new Map(current.map(account => [account.id, account]));
    for (const [id, subscription] of subscriptions) {
      if (byId.get(id)?.revision !== subscription.revision) {
        subscriptions.delete(id);
        await subscription.close().catch(report);
      }
    }
    for (const account of current) {
      if (controller.signal.aborted) return;
      if (!subscriptions.has(account.id)) {
        // Subscription setup failure must not prevent REST coverage. Retry next tick.
        try {
          const close = await provider.subscribe(account, () => {
            void requestAccount(account, "subscription_change").catch(report);
          }, controller.signal);
          if (controller.signal.aborted) { await close(); return; }
          subscriptions.set(account.id, { revision: account.revision, close });
        } catch (error) { report(error); }
      }
      await requestAccount(account, reason);
    }
  }

  function tick(): Promise<void> {
    if (!reconciling) {
      reconciling = reconcile().finally(() => { reconciling = undefined; });
    }
    return reconciling;
  }

  return {
    async processRefresh(requestId: string, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      const request = await store.beginRefresh(requestId);
      if (!request) return;
      try {
        const account = await store.getResource("accounts", request.accountId);
        if (!account || !account.enabled) throw new AppError("account_disabled", "Refresh account is missing or disabled", 409);
        const observation = await provider.read(account, signal);
        signal.throwIfAborted();
        const current = await store.getResource("accounts", account.id);
        if (!current || !current.enabled || current.revision !== account.revision) {
          throw new AppError("account_changed", "Account configuration changed during refresh; request a new refresh", 409);
        }
        await store.finishRefresh(requestId, observation);
      } catch (error) {
        await store.finishRefresh(requestId, null, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    async requestRefresh(portfolioId: string, key: string): Promise<RefreshRequest[]> {
      return store.requestPortfolioRefresh(portfolioId, key);
    },
    async discoverSubAccounts(accountId: string, signal = controller.signal) {
      const account = await store.getResource("accounts", accountId);
      if (!account) throw new AppError("not_found", "Account does not exist", 404);
      return provider.subAccounts(account, signal);
    },
    async start(): Promise<void> {
      if (started) return;
      if (controller.signal.aborted) throw new Error("Portfolio module is closed");
      const startup = tick();
      started = true;
      // API startup stays responsive even while an external socket handshake is pending.
      void startup.catch(report);
      timer = setInterval(() => { void tick().catch(report); }, interval);
      timer.unref();
    },
    async close(): Promise<void> {
      controller.abort();
      if (timer) clearInterval(timer);
      await reconciling?.catch(report);
      await Promise.allSettled([...subscriptions.values()].map(subscription => subscription.close()));
      subscriptions.clear();
      await provider.close();
    },
  };
}
