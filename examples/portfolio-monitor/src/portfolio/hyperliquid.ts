import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Decimal } from "decimal.js";
import { HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport,
  type IRequestTransport, type ISubscriptionTransport, type ISubscription } from "@nktkas/hyperliquid";
import { type Account, type AccountObservation, type CoveragePart, type Json, type Network,
  type PortfolioProvider, type Position } from "../contracts.js";

type RecordValue = Record<string, unknown>;
const FinancialDecimal = Decimal.clone({ precision: 100 });
const record = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? null)) as Json;
const now = () => new Date().toISOString();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const decimal = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  // Reject empty strings, nonfinite values and scientific notation from provider text.
  if (!/^-?\d+(\.\d+)?$/.test(String(value))) return null;
  const result = new FinancialDecimal(value);
  return result.isFinite() ? result.toFixed() : null;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tokenIdentity = (network: Network, token: number) => `hyperliquid:${network}:spot:${token}`;

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let aborted!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
  });
  try { return await Promise.race([promise, stopped]); }
  finally { signal.removeEventListener("abort", aborted); }
}

/** SDK transports are injectable for tests; production always uses the SDK clients. */
export type HyperliquidProviderOptions = {
  transportFactory?: (network: Network) => IRequestTransport<"info">;
  subscriptionTransportFactory?: (network: Network) => ISubscriptionTransport & {
    close?: () => void;
    socket?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  };
  readTimeoutMs?: number;
  subscriptionTimeoutMs?: number;
  metadataTtlMs?: number;
  valuationTtlMs?: number;
  requestIntervalMs?: number;
  requestsPerMinute?: number;
};

/** Shared request-count admission across accounts/networks; other IP clients have their own venue quota use. */
function requestBudget(interval: number, maxPerMinute: number) {
  let tail = Promise.resolve();
  let last = 0;
  const admitted: number[] = [];
  return async function run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = tail;
    const gate = new Promise<void>(resolve => { release = resolve; });
    tail = previous.then(() => gate);
    try {
      await abortable(previous, signal);
      signal.throwIfAborted();
      let time = Date.now();
      while (admitted[0] !== undefined && admitted[0] <= time - 60_000) admitted.shift();
      const wait = Math.max(0, last + interval - time, admitted.length >= maxPerMinute ? admitted[0]! + 60_000 - time : 0);
      if (wait) await delay(wait, undefined, { signal });
      signal.throwIfAborted();
      time = Date.now();
      while (admitted[0] !== undefined && admitted[0] <= time - 60_000) admitted.shift();
      last = time;
      admitted.push(time);
      return await abortable(operation(), signal);
    } finally { release(); }
  };
}

/** Retains only holdings/collateral fields for invalidation; prices and PnL do not flood refreshes. */
export function holdingsFingerprint(value: unknown): string {
  const root = record(value);
  if (Array.isArray(root.clearinghouseStates)) {
    return hash(array(root.clearinghouseStates).map(item => {
      const [dex, state] = array(item);
      const data = record(state);
      return [dex, array(data.assetPositions).map(item => {
        const position = record(record(item).position);
        return [position.coin, position.szi, position.entryPx, position.leverage];
      }), record(data.marginSummary).totalRawUsd];
    }));
  }
  const data = record(root.spotState ?? value);
  return hash({ portfolioMarginEnabled: data.portfolioMarginEnabled,
    balances: array(data.balances).map(item => {
      const balance = record(item);
      return [balance.token, balance.coin, balance.total, balance.hold, balance.spotHold, balance.borrowed, balance.supplied];
    }), evmEscrows: data.evmEscrows });
}

export function createHyperliquidProvider(options: HyperliquidProviderOptions = {}): PortfolioProvider {
  const timeoutMs = options.readTimeoutMs ?? 180_000;
  const subscriptionTimeoutMs = options.subscriptionTimeoutMs ?? 5_000;
  const ttl = options.metadataTtlMs ?? 300_000;
  const valuationTtl = options.valuationTtlMs ?? 30_000;
  const interval = options.requestIntervalMs ?? 100;
  const maxRequests = options.requestsPerMinute ?? 40;
  if (![timeoutMs, subscriptionTimeoutMs].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(ttl) || ttl < 0 ||
      !Number.isFinite(valuationTtl) || valuationTtl < 0 || !Number.isFinite(interval) || interval < 0 || !Number.isInteger(maxRequests) || maxRequests < 1) throw new Error("Invalid Hyperliquid provider limits");
  const lifetime = new AbortController();
  const budget = requestBudget(interval, maxRequests);
  const clients = new Map<Network, InfoClient>();
  const subscriptionTransports = new Map<Network, ReturnType<NonNullable<HyperliquidProviderOptions["subscriptionTransportFactory"]>>>();
  const cache = new Map<string, { expires: number; receivedAt: string; value: unknown }>();
  const active = new Set<() => Promise<void>>();

  function client(network: Network) {
    let info = clients.get(network);
    if (!info) {
      info = new InfoClient({ transport: options.transportFactory?.(network) ?? new HttpTransport({ isTestnet: network === "testnet", timeout: 10_000 }) });
      clients.set(network, info);
    }
    return info;
  }
  function boundedSignal(signal: AbortSignal) { return AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(timeoutMs)]); }
  async function cached<T>(network: Network, key: string, signal: AbortSignal, load: () => Promise<T>, cacheTtl = ttl) {
    const identity = `${network}/${key}`;
    const previous = cache.get(identity);
    if (previous && previous.expires > Date.now()) return previous;
    const value = await budget(signal, load);
    const entry = { expires: Date.now() + cacheTtl, receivedAt: now(), value };
    cache.set(identity, entry);
    return entry;
  }

  return {
    async read(account, parentSignal) {
      const signal = boundedSignal(parentSignal);
      signal.throwIfAborted();
      const startedAt = now();
      const info = client(account.network);
      const positions: Position[] = [];
      const coverage: CoveragePart[] = [];
      const issues: string[] = [];
      const raw: Record<string, Json> = {};
      const facts: Record<string, Json> = { interpretation: "positions_and_venue_observations; no_aggregate_equity", configuredPerpDexs: json(account.perpDexs) };
      const expose: Record<string, unknown> = {};
      async function capture<T>(part: string, load: () => Promise<T>): Promise<T | undefined> {
        try {
          const value = await load();
          signal.throwIfAborted();
          raw[part] = json(value);
          coverage.push({ part, status: "complete", receivedAt: now() });
          return value;
        } catch (error) {
          signal.throwIfAborted();
          const issue = `${part}: ${message(error)}`;
          issues.push(issue);
          coverage.push({ part, status: "failed", receivedAt: now(), issue });
          return undefined;
        }
      }
      function unsupported(part: string, issue: string) {
        issues.push(issue);
        coverage.push({ part, status: "unsupported", receivedAt: now(), issue });
      }
      const mode = await capture("accountMode", () => budget(signal, () => info.userAbstraction({ user: account.address }, signal)));
      const accountMode = typeof mode === "string" ? mode : null;
      if (mode !== undefined && accountMode === null) unsupported("accountMode.schema", "Account mode response is not a string");
      if (accountMode !== null && !["unifiedAccount", "portfolioMargin", "disabled"].includes(accountMode)) {
        unsupported("accountMode.interpretation", `Account mode ${accountMode} retained without assuming standard/shared collateral semantics`);
      }
      const spotEntry = await capture("spot.metadata", () => cached(account.network, "spot.metadata", signal, () => info.spotMetaAndAssetCtxs(signal), Math.min(ttl, valuationTtl)));
      const [spotMetadataValue, spotContextsValue] = array(spotEntry?.value);
      const spotMeta = record(spotMetadataValue);
      if (spotEntry && (!Array.isArray(spotMeta.tokens) || !Array.isArray(spotMeta.universe))) unsupported("spot.metadata.schema", "Spot metadata lacks token or universe arrays");
      const tokens = new Map<number, RecordValue>();
      for (const value of array(spotMeta.tokens)) {
        const token = record(value);
        if (Number.isInteger(token.index) && (token.index as number) >= 0) tokens.set(token.index as number, token);
      }
      const spotContexts = array(spotContextsValue);
      const spot = await capture("spot.balances", () => budget(signal, () => info.spotClearinghouseState({ user: account.address }, signal)));
      if (spot !== undefined && !Array.isArray(record(spot).balances)) unsupported("spot.schema", "Spot response did not contain a balances array");
      for (const item of array(record(spot).balances)) {
        const balance = record(item);
        if (!Number.isInteger(balance.token) || (balance.token as number) < 0) {
          unsupported("spot.unsupported_balance", `Unsupported spot balance ${String(balance.coin)} has no canonical token index`);
          continue;
        }
        const tokenId = balance.token as number;
        const total = decimal(balance.total);
        const hold = decimal(balance.hold);
        if (total === null || hold === null || typeof balance.coin !== "string") { unsupported("spot.invalid_balance", `Invalid balance for token ${tokenId}`); continue; }
        const token = tokens.get(tokenId);
        if (!token) unsupported(`spot.token.${tokenId}`, `Metadata unavailable for spot token ${tokenId}; raw identity retained`);
        let value: Extract<Position, { kind: "spot" }>["value"] = null;
        // A market's array position identifies its context. Its index identifies the market, never the held token.
        for (const [index, item] of array(spotMeta.universe).entries()) {
          const market = record(item);
          const pair = array(market.tokens);
          if (pair[0] !== tokenId || !Number.isInteger(pair[1])) continue;
          const price = decimal(record(spotContexts[index]).markPx);
          const quote = tokens.get(pair[1] as number);
          if (price === null || !quote || new FinancialDecimal(price).lte(0)) continue;
          value = { amount: new FinancialDecimal(total).mul(price).toFixed(), currency: tokenIdentity(account.network, pair[1] as number),
            priceRef: `hyperliquid:${account.network}:spot-market:${String(market.index)}:mark:${spotEntry?.receivedAt}` };
          break;
        }
        positions.push({ kind: "spot", accountId: account.id, instrumentId: tokenIdentity(account.network, tokenId), tokenId,
          venueSymbol: balance.coin, total, hold, spotHold: decimal(balance.spotHold), value });
      }
      facts.spot = json(spot);
      facts.spotMetadata = json(spotEntry ? { receivedAt: spotEntry.receivedAt, metadata: spotMetadataValue } : null);
      if (array(record(spot).evmEscrows).length) unsupported("spot.evmEscrows", "EVM escrow balances retained in account facts; excluded from tradable spot positions");
      const discovered = await capture("perp.discovery", () => cached(account.network, "perp.discovery", signal, () => info.perpDexs(signal)));
      if (discovered && !Array.isArray(discovered.value)) unsupported("perp.discovery.schema", "Perpetual DEX discovery response is not an array");
      const allDexs = new Set<string>([""]);
      for (const dex of array(discovered?.value)) if (typeof record(dex).name === "string") allDexs.add(record(dex).name as string);
      const selected = (account.perpDexs === "all" ? [...allDexs] : [...new Set(account.perpDexs)]).sort();
      facts.selectedPerpDexs = json(selected);
      const bulkEntry = await capture("perp.bulkMetadata", () => cached(account.network, "perp.bulkMetadata", signal, () => info.allPerpMetas(signal)));
      const byDex = new Map<string, { metadata: unknown; contexts: unknown }>();
      for (const value of array(bulkEntry?.value)) {
        // SDK0.33.3 declares flat MetaResponse[]; venue docs also illustrate [meta, contexts][] tuples.
        const metadata = Array.isArray(value) ? value[0] : value;
        const universe = record(metadata).universe;
        if (!Array.isArray(universe) || !Number.isInteger(record(metadata).collateralToken) || (record(metadata).collateralToken as number) < 0) continue;
        const namespaces = new Set(universe.map(item => {
          const name = record(item).name;
          return typeof name === "string" ? (name.includes(":") ? name.slice(0, name.indexOf(":")) : "") : null;
        }));
        // Never guess metadata identity from bulk-array order. Empty/ambiguous namespaces use named fallback.
        if (namespaces.size !== 1) continue;
        const dex = [...namespaces][0];
        if (dex === null || dex === undefined || byDex.has(dex)) continue;
        byDex.set(dex, { metadata, contexts: Array.isArray(value) ? value[1] : null });
      }
      const perpFacts: Record<string, Json> = {};
      const collateralExposure: Record<string, unknown> = {};
      for (const dex of selected) {
        if (discovered && !allDexs.has(dex)) { unsupported(`perp.${dex}.scope`, `Configured DEX ${dex} absent from discovery`); continue; }
        const bulk = byDex.get(dex);
        const metadataEntry = bulk && bulkEntry ? { ...bulkEntry, value: bulk.metadata } :
          await capture(`perp.${dex}.metadata`, () => cached(account.network, `perp.${dex}.metadata`, signal, () => info.meta({ dex }, signal)));
        const metadataValue = metadataEntry?.value;
        const contextsValue = bulk?.contexts;
        const metadata = record(metadataValue);
        const collateralId = Number.isInteger(metadata.collateralToken) && (metadata.collateralToken as number) >= 0 ? metadata.collateralToken as number : null;
        const currency = collateralId === null ? null : tokenIdentity(account.network, collateralId);
        if (collateralId === null) unsupported(`perp.${dex}.collateral`, `No collateral token metadata for DEX ${dex || "native"}; amounts remain unvalued`);
        const state = await capture(`perp.${dex}.positions`, () => budget(signal, () => info.clearinghouseState({ user: account.address, dex }, signal)));
        if (state !== undefined && !Array.isArray(record(state).assetPositions)) unsupported(`perp.${dex}.schema`, "Perpetual response did not contain assetPositions");
        for (const item of array(record(state).assetPositions)) {
          const position = record(record(item).position);
          const signedSize = decimal(position.szi);
          if (signedSize === null || typeof position.coin !== "string") { unsupported(`perp.${dex}.invalid_position`, "Invalid perp position retained in raw observations"); continue; }
          if (new FinancialDecimal(signedSize).isZero()) continue;
          const leverage = record(position.leverage);
          const marginMode = leverage.type === "cross" || leverage.type === "isolated" ? leverage.type : "unknown";
          if (marginMode === "unknown") unsupported(`perp.${dex}.margin_mode`, `Unsupported leverage type ${String(leverage.type)} for ${position.coin}`);
          const index = array(metadata.universe).findIndex(item => record(item).name === position.coin);
          if (index < 0) unsupported(`perp.${dex}.instrument`, `Metadata unavailable for perp ${position.coin}; raw identity retained`);
          const notional = decimal(position.positionValue);
          const pnl = decimal(position.unrealizedPnl);
          positions.push({ kind: "perp", accountId: account.id, instrumentId: `hyperliquid:${account.network}:perp:${encodeURIComponent(dex)}:${encodeURIComponent(position.coin)}`,
            dex, venueCoin: position.coin, signedSize, side: new FinancialDecimal(signedSize).isNegative() ? "short" : "long",
            entryPrice: decimal(position.entryPx), notional: currency && notional !== null ? { amount: notional, currency,
              priceRef: `hyperliquid:${account.network}:perp:${encodeURIComponent(dex)}:reported-position-value:${String(record(state).time)}` } : null,
            unrealizedPnl: currency && pnl !== null ? { amount: pnl, currency } : null,
            marginMode, leverage: decimal(leverage.value), liquidationPrice: decimal(position.liquidationPx) });
        }
        const stateRecord = record(state);
        perpFacts[dex] = json({ collateralToken: collateralId, collateralCurrency: currency, sourceTime: stateRecord.time,
          marginSummary: stateRecord.marginSummary, crossMarginSummary: stateRecord.crossMarginSummary,
          crossMaintenanceMarginUsed: stateRecord.crossMaintenanceMarginUsed, withdrawable: stateRecord.withdrawable,
          metadata: metadataValue, assetContexts: contextsValue, metadataReceivedAt: metadataEntry?.receivedAt });
        collateralExposure[dex] = { collateralToken: collateralId, rawCollateral: record(stateRecord.marginSummary).totalRawUsd,
          isolatedCollateral: array(stateRecord.assetPositions).map(item => {
            const position = record(record(item).position);
            const leverage = record(position.leverage);
            return [position.coin, leverage.type, leverage.rawUsd];
          }) };
      }
      facts.perpsByDex = perpFacts;
      facts.collateralInterpretation = accountMode === "unifiedAccount" || accountMode === "portfolioMargin" ?
        "Shared collateral; venue summaries are separate observations and must not be summed with spot balances" :
        accountMode === "disabled" ? "Separate spot/perp ledgers; no aggregate equity calculated" : "Unknown account-mode interpretation; raw observations retained";
      positions.sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
      expose.positions = positions.map(position => position.kind === "spot" ?
        [position.instrumentId, position.total, position.hold, position.spotHold] :
        [position.instrumentId, position.signedSize, position.entryPrice, position.marginMode, position.leverage]);
      expose.mode = accountMode;
      expose.scope = selected;
      expose.collateral = collateralExposure;
      expose.spotFacts = { portfolioMarginEnabled: record(spot).portfolioMarginEnabled,
        balances: array(record(spot).balances).map(item => { const b = record(item); return [b.token, b.coin, b.total, b.hold, b.spotHold, b.borrowed, b.supplied]; }),
        evmEscrows: record(spot).evmEscrows };
      signal.throwIfAborted();
      return { accountId: account.id, network: account.network, address: account.address, startedAt, completedAt: now(), positions,
        accountMode, accountFacts: facts, coverage, issues, exposureHash: hash(expose), raw };
    },
    async subAccounts(account, parentSignal) {
      const signal = boundedSignal(parentSignal);
      const data = await budget(signal, () => client(account.network).subAccounts({ user: account.address }, signal));
      if (data === null) return [];
      if (!Array.isArray(data)) throw new Error("Invalid subAccounts response");
      return data.map(item => {
        if (!/^0x[0-9a-fA-F]{40}$/.test(item.subAccountUser) || typeof item.name !== "string") throw new Error("Invalid sub-account identity");
        return { address: item.subAccountUser, name: item.name };
      });
    },
    async subscribe(account, onChange, signal) {
      signal.throwIfAborted();
      lifetime.signal.throwIfAborted();
      const local = new AbortController();
      const runningSignal = AbortSignal.any([signal, lifetime.signal, local.signal]);
      let closed = false;
      let detach = async () => {};
      let recovering: Promise<void> | undefined;
      const close = async () => {
        if (closed) return;
        closed = true;
        local.abort();
        active.delete(close);
        signal.removeEventListener("abort", aborted);
        await detach();
        await recovering?.catch(() => {});
      };
      const aborted = () => { void close(); };
      signal.addEventListener("abort", aborted, { once: true });
      async function attach(): Promise<void> {
        runningSignal.throwIfAborted();
        let transport = subscriptionTransports.get(account.network);
        if (!transport) {
          transport = options.subscriptionTransportFactory?.(account.network) ?? new WebSocketTransport({ isTestnet: account.network === "testnet", timeout: subscriptionTimeoutMs });
          subscriptionTransports.set(account.network, transport);
        }
        const ws = transport;
        const subscriptionClient = new SubscriptionClient({ transport: ws });
        const subscriptions: ISubscription[] = [];
        let detached = false;
        let perpFingerprint: string | undefined;
        let spotFingerprint: string | undefined;
        const reopened = () => { if (!closed && !detached) onChange(); };
        ws.socket?.addEventListener("open", reopened);
        const cleanup = async () => {
          detached = true;
          ws.socket?.removeEventListener("open", reopened);
          await Promise.allSettled(subscriptions.splice(0).map(subscription => subscription.unsubscribe()));
        };
        detach = cleanup;
        const attaching = new AbortController();
        const setupSignal = AbortSignal.any([runningSignal, attaching.signal, AbortSignal.timeout(subscriptionTimeoutMs)]);
        let confirmed = false;
        const onError = (error: unknown) => {
          if (closed || detached) return;
          // A first confirmed channel can fail while its sibling is still attaching.
          // Abort that attachment instead of dropping the error behind the recovery guard.
          if (!confirmed) { attaching.abort(error); return; }
          if (recovering) return;
          onChange(); // REST refresh now; periodic REST remains available during reconnection.
          recovering = (async () => {
            await cleanup();
            if (subscriptionTransports.get(account.network) === ws) {
              subscriptionTransports.delete(account.network);
              ws.close?.();
            }
            while (!runningSignal.aborted) {
              await delay(1_000, undefined, { signal: runningSignal });
              try { await attach(); return; } catch { await detach(); }
            }
          })().catch(() => {}).finally(() => { recovering = undefined; });
        };
        try {
          subscriptions.push(await subscriptionClient.allDexsClearinghouseState({ user: account.address }, event => {
            const filtered = account.perpDexs === "all" ? event : { ...event, clearinghouseStates: event.clearinghouseStates.filter(([dex]) => account.perpDexs.includes(dex)) };
            const fingerprint = holdingsFingerprint(filtered);
            if (!closed && !detached && fingerprint !== perpFingerprint) { perpFingerprint = fingerprint; onChange(); }
          }, { signal: setupSignal, onError }));
          setupSignal.throwIfAborted();
          // SDK 0.33.3 supports ignorePortfolioMargin; omit it for the complete server default.
          subscriptions.push(await subscriptionClient.spotState({ user: account.address }, event => {
            const fingerprint = holdingsFingerprint(event);
            if (!closed && !detached && fingerprint !== spotFingerprint) { spotFingerprint = fingerprint; onChange(); }
          }, { signal: setupSignal, onError }));
          setupSignal.throwIfAborted();
          confirmed = true;
        } catch (error) {
          await cleanup();
          if (subscriptionTransports.get(account.network) === ws) {
            subscriptionTransports.delete(account.network);
            ws.close?.();
          }
          throw error;
        }
      }
      try {
        await attach();
        active.add(close);
        return close;
      } catch (error) { await close(); throw error; }
    },
    async close() {
      lifetime.abort();
      await Promise.allSettled([...active].map(close => close()));
      for (const transport of subscriptionTransports.values()) transport.close?.();
      subscriptionTransports.clear(); clients.clear(); cache.clear();
    },
  };
}
