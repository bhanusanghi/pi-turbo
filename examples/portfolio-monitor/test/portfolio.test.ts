import assert from "node:assert/strict";
import { test } from "bun:test";
import type { IRequestTransport, ISubscriptionTransport } from "@nktkas/hyperliquid";
import { createHyperliquidProvider, holdingsFingerprint } from "../src/portfolio/hyperliquid.js";
import type { Account } from "../src/contracts.js";
import { accountAddress, clearinghouse, responses } from "./fixtures/hyperliquid/responses.js";
const account: Account = { id: "account-1", revision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", address: accountAddress, label: "Test", network: "mainnet", enabled: true, perpDexs: "all" };
const signal = () => new AbortController().signal;
function fixtureTransport(data: Record<string, unknown>, calls: string[] = []): IRequestTransport<"info"> {
  return { isTestnet: false, async request<T>(_endpoint: "info", payload: unknown, signal?: AbortSignal): Promise<T> {
      signal?.throwIfAborted();
      const request = payload as {
        type: string;
        dex?: string;
      };
      const key = ["meta", "metaAndAssetCtxs", "clearinghouseState"].includes(request.type) ? `${request.type}/${request.dex ?? ""}` : request.type;
      calls.push(key);
      const result = data[key];
      if (result instanceof Error)
        throw result;
      if (result === undefined)
        throw new Error(`Unconfigured request ${key}`);
      return structuredClone(result) as T;
    } };
}
function fixtureProvider(data = structuredClone(responses), calls: string[] = []) {
  return createHyperliquidProvider({ transportFactory: () => fixtureTransport(data, calls), metadataTtlMs: 0, requestIntervalMs: 0, requestsPerMinute: 10000 });
}
test("SDK path discovers HIP-3 perps and normalizes spot token identity, exact decimals and quote currency", async () => {
  const calls: string[] = [];
  const provider = fixtureProvider(undefined, calls);
  try {
    const result = await provider.read(account, signal());
    assert.equal(result.accountMode, "unifiedAccount");
    assert.equal(result.coverage.every(part => part.status === "complete"), true);
    assert.equal(result.positions.length, 4);
    const perp = result.positions.find(item => item.kind === "perp" && item.dex === "xyz");
    assert.ok(perp?.kind === "perp");
    assert.equal(perp.notional?.currency, "hyperliquid:mainnet:spot:10");
    assert.equal(perp.signedSize, "2");
    const native = result.positions.find(item => item.kind === "perp" && item.dex === "");
    assert.ok(native?.kind === "perp");
    assert.equal(native.side, "short");
    assert.equal(native.signedSize, "-0.002");
    const spot = result.positions.find(item => item.kind === "spot" && item.tokenId === 150);
    assert.ok(spot?.kind === "spot");
    assert.equal(spot.instrumentId, "hyperliquid:mainnet:spot:150");
    assert.equal(spot.total, "1.000000000000000001");
    assert.equal(spot.value?.amount, "21.123456789000000021123456789");
    assert.match(spot.value!.priceRef!, /spot-market:107/);
    assert.equal(result.positions.find(item => item.kind === "spot" && item.tokenId === 0)?.kind, "spot");
    const quote = result.positions.find(item => item.kind === "spot" && item.tokenId === 0);
    assert.ok(quote?.kind === "spot");
    assert.equal(quote.value, null);
    assert.ok(calls.includes("clearinghouseState/xyz"));
    assert.equal((await provider.subAccounts(account, signal()))[0]?.address, `0x${"2".repeat(40)}`);
  }
  finally {
    await provider.close();
  }
});
test("explicit DEX scope excludes unselected builder positions and failed reads remain distinguishable from empty", async () => {
  const data = structuredClone(responses);
  data["spotClearinghouseState"] = new Error("spot unavailable");
  data["clearinghouseState/"] = { ...clearinghouse("BTC"), assetPositions: [] };
  const calls: string[] = [];
  const provider = fixtureProvider(data, calls);
  try {
    const result = await provider.read({ ...account, perpDexs: [""] }, signal());
    assert.deepEqual(result.positions, []);
    assert.equal(result.coverage.find(part => part.part === "perp..positions")?.status, "complete");
    assert.equal(result.coverage.find(part => part.part === "spot.balances")?.status, "failed");
    assert.equal(calls.includes("clearinghouseState/xyz"), false);
  }
  finally {
    await provider.close();
  }
});
test("unknown modes, outcome records and unknown metadata remain explicit and raw observations survive", async () => {
  const data = structuredClone(responses);
  data.userAbstraction = "futureMode";
  data.spotClearinghouseState = { portfolioMarginEnabled: true, portfolioMarginRatio: "0.9", balances: [
      { coin: "+1", total: "5", hold: "0", entryNtl: "1" },
      { coin: "UNKNOWN", token: 999, total: "2", hold: "0", borrowed: "1", supplied: "0" },
    ] };
  const provider = fixtureProvider(data);
  try {
    const result = await provider.read(account, signal());
    assert.equal(result.accountMode, "futureMode");
    assert.ok(result.coverage.some(part => part.part === "spot.unsupported_balance"));
    assert.ok(result.coverage.some(part => part.part === "accountMode.interpretation"));
    const spot = result.positions.find(item => item.kind === "spot");
    assert.ok(spot?.kind === "spot");
    assert.equal(spot.tokenId, 999);
    assert.equal(spot.value, null);
    assert.deepEqual((result.raw as Record<string, unknown>)["spot.balances"], data.spotClearinghouseState);
  }
  finally {
    await provider.close();
  }
});
test("exposure identity excludes valuation changes and includes holdings, mode and collateral changes", async () => {
  const data = structuredClone(responses);
  const provider = fixtureProvider(data);
  try {
    const first = await provider.read(account, signal());
    const native = data["clearinghouseState/"] as ReturnType<typeof clearinghouse>;
    native.assetPositions[0]!.position.positionValue = "130";
    native.assetPositions[0]!.position.unrealizedPnl = "8.75";
    native.marginSummary.accountValue = "410";
    const second = await provider.read(account, signal());
    assert.equal(first.exposureHash, second.exposureHash);
    native.marginSummary.totalRawUsd = "310";
    assert.notEqual(second.exposureHash, (await provider.read(account, signal())).exposureHash);
    native.assetPositions[0]!.position.szi = "-0.003";
    assert.notEqual(second.exposureHash, (await provider.read(account, signal())).exposureHash);
    const beforeIsolated = (await provider.read(account, signal())).exposureHash;
    native.assetPositions[0]!.position.leverage = { type: "isolated", value: 10, rawUsd: "20" } as unknown as typeof native.assetPositions[0]["position"]["leverage"];
    const isolated = (await provider.read(account, signal())).exposureHash;
    assert.notEqual(beforeIsolated, isolated);
    (native.assetPositions[0]!.position.leverage as unknown as {
      rawUsd: string;
    }).rawUsd = "21";
    assert.notEqual(isolated, (await provider.read(account, signal())).exposureHash);
  }
  finally {
    await provider.close();
  }
});
test("shared metadata cache avoids repeated metadata reads without caching account observations", async () => {
  const calls: string[] = [];
  const provider = createHyperliquidProvider({ transportFactory: () => fixtureTransport(responses, calls), metadataTtlMs: 60000, requestIntervalMs: 0, requestsPerMinute: 10000 });
  try {
    await provider.read(account, signal());
    await provider.read(account, signal());
    assert.equal(calls.filter(call => call === "perpDexs").length, 1);
    assert.equal(calls.filter(call => call === "spotMetaAndAssetCtxs").length, 1);
    assert.equal(calls.filter(call => call === "spotClearinghouseState").length, 2);
  }
  finally {
    await provider.close();
  }
});
test("abort propagates instead of publishing a misleading complete/empty snapshot", async () => {
  const transport: IRequestTransport<"info"> = { isTestnet: false, request: (_endpoint, _payload, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
    }) };
  const provider = createHyperliquidProvider({ transportFactory: () => transport, readTimeoutMs: 20 });
  const keepAlive = setTimeout(() => { }, 100);
  try {
    await assert.rejects(provider.read(account, signal()), error => (error as Error).name === "TimeoutError");
  }
  finally {
    clearTimeout(keepAlive);
    await provider.close();
  }
});
test("native SDK subscriptions invalidate holdings and reconnection, suppress price/PnL ticks, and clean up", async () => {
  const socket = new EventTarget();
  const listeners = new Map<string, (event: CustomEvent<unknown>) => void>();
  let unsubscribed = 0;
  const transport: ISubscriptionTransport & {
    socket: EventTarget;
    close: () => void;
  } = {
    socket, close() { },
    async subscribe<T>(channel: string, _payload: unknown, listener: (event: CustomEvent<T>) => void) {
      listeners.set(channel, listener as (event: CustomEvent<unknown>) => void);
      return { async unsubscribe() { unsubscribed++; listeners.delete(channel); } };
    },
  };
  const provider = createHyperliquidProvider({ subscriptionTransportFactory: () => transport });
  let changes = 0;
  try {
    const stop = await provider.subscribe(account, () => { changes++; }, signal());
    const event = { user: accountAddress, clearinghouseStates: [["", clearinghouse("BTC")]] };
    const emit = () => listeners.get("allDexsClearinghouseState")!(new CustomEvent("allDexsClearinghouseState", { detail: event }));
    emit();
    assert.equal(changes, 1);
    event.clearinghouseStates[0]![1] = { ...clearinghouse("BTC"), time: 1760000001000 };
    (event.clearinghouseStates[0]![1] as ReturnType<typeof clearinghouse>).assetPositions[0]!.position.unrealizedPnl = "10";
    emit();
    assert.equal(changes, 1);
    (event.clearinghouseStates[0]![1] as ReturnType<typeof clearinghouse>).assetPositions[0]!.position.szi = "-1";
    emit();
    assert.equal(changes, 2);
    socket.dispatchEvent(new Event("open"));
    assert.equal(changes, 3);
    await stop();
    assert.equal(unsubscribed, 2);
    socket.dispatchEvent(new Event("open"));
    assert.equal(changes, 3);
  }
  finally {
    await provider.close();
  }
});
test("spot holding fingerprint includes borrowing without conflating provider valuation", () => {
  const state = { balances: [{ coin: "HYPE", token: 150, total: "1", hold: "0", borrowed: "0", supplied: "0", entryNtl: "20" }], portfolioMarginRatio: "0.1" };
  const before = holdingsFingerprint(state);
  state.portfolioMarginRatio = "0.2";
  assert.equal(before, holdingsFingerprint(state));
  state.balances[0]!.borrowed = "1";
  assert.notEqual(before, holdingsFingerprint(state));
});
test("missing collateral metadata keeps nonzero perp exposure visible with unknown amounts and leverage mode", async () => {
  const data = structuredClone(responses);
  data.allPerpMetas = new Error("metadata unavailable");
  data["meta/"] = new Error("metadata unavailable");
  const native = data["clearinghouseState/"] as ReturnType<typeof clearinghouse>;
  (native.assetPositions[0]!.position.leverage as {
    type: string;
  }).type = "futureMode";
  const provider = fixtureProvider(data);
  try {
    const result = await provider.read(account, signal());
    const position = result.positions.find(item => item.kind === "perp" && item.dex === "");
    assert.ok(position?.kind === "perp");
    assert.equal(position.signedSize, "-0.002");
    assert.equal(position.marginMode, "unknown");
    assert.equal(position.notional, null);
    assert.ok(result.coverage.some(part => part.status === "failed"));
    assert.ok(result.coverage.some(part => part.part === "perp..margin_mode" && part.status === "unsupported"));
  }
  finally {
    await provider.close();
  }
});
test("subscription setup is deadline-bound and removes a partially attached subscription", async () => {
  let unsubscribed = 0;
  const transport: ISubscriptionTransport = {
    async subscribe<T>(channel: string, _payload: unknown, _listener: (event: CustomEvent<T>) => void, options?: {
      signal?: AbortSignal;
    }) {
      if (channel === "allDexsClearinghouseState")
        return { async unsubscribe() { unsubscribed++; } };
      return new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true }));
    },
  };
  const provider = createHyperliquidProvider({ subscriptionTransportFactory: () => transport, subscriptionTimeoutMs: 20 });
  const keepAlive = setTimeout(() => { }, 100);
  try {
    await assert.rejects(provider.subscribe(account, () => { }, signal()), error => (error as Error).name === "TimeoutError");
    assert.equal(unsubscribed, 1);
  }
  finally {
    clearTimeout(keepAlive);
    await provider.close();
  }
});
test("terminal subscription failure replaces the transport and reattaches both channels", async () => {
  let transports = 0;
  let unsubscriptions = 0;
  let transportCloses = 0;
  let fail: (() => void) | undefined;
  const attached: string[] = [];
  const provider = createHyperliquidProvider({ subscriptionTransportFactory: () => {
      const generation = ++transports;
      return {
        close() { transportCloses++; },
        async subscribe<T>(channel: string, _payload: unknown, _listener: (event: CustomEvent<T>) => void, options?: {
          onError?: (error: Error) => void;
        }) {
          attached.push(`${generation}/${channel}`);
          if (generation === 1 && channel === "allDexsClearinghouseState")
            fail = () => options?.onError?.(new Error("connection permanently closed"));
          return { async unsubscribe() { unsubscriptions++; } };
        },
      };
    } });
  let invalidations = 0;
  try {
    const stop = await provider.subscribe(account, () => { invalidations++; }, signal());
    fail!();
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const timer = setInterval(() => {
        if (attached.includes("2/spotState")) {
          clearInterval(timer);
          resolve();
        }
        else if (Date.now() >= deadline) {
          clearInterval(timer);
          reject(new Error("Replacement subscription did not attach"));
        }
      }, 10);
    });
    assert.equal(transports, 2);
    assert.equal(transportCloses, 1);
    assert.equal(invalidations, 1);
    assert.equal(unsubscriptions, 2);
    await stop();
    assert.equal(unsubscriptions, 4);
  }
  finally {
    await provider.close();
  }
});
test("failed initial confirmation discards a dead transport before the next subscription attempt", async () => {
  let transports = 0;
  let closed = 0;
  const provider = createHyperliquidProvider({ subscriptionTransportFactory: () => {
      const generation = ++transports;
      return { close() { closed++; }, async subscribe() {
          if (generation === 1)
            throw new Error("permanently terminated before confirmation");
          return { async unsubscribe() { } };
        } };
    } });
  try {
    await assert.rejects(provider.subscribe(account, () => { }, signal()), /permanently terminated/);
    assert.equal(closed, 1);
    const stop = await provider.subscribe(account, () => { }, signal());
    assert.equal(transports, 2);
    await stop();
  }
  finally {
    await provider.close();
  }
});
test("confirmed channel failure during recovery sibling setup aborts attachment and retries fresh", async () => {
  let transports = 0;
  let failInitial: (() => void) | undefined;
  let thirdAttached = false;
  let secondUnsubscribed = 0;
  const provider = createHyperliquidProvider({ subscriptionTransportFactory: () => {
      const generation = ++transports;
      let failPerp: (() => void) | undefined;
      return { close() { }, async subscribe<T>(channel: string, _payload: unknown, _listener: (event: CustomEvent<T>) => void, options?: {
          signal?: AbortSignal;
          onError?: (error: Error) => void;
        }) {
          if (channel === "allDexsClearinghouseState") {
            failPerp = () => options?.onError?.(new Error("confirmed channel died during sibling setup"));
            if (generation === 1)
              failInitial = failPerp;
          }
          if (generation === 2 && channel === "spotState") {
            const waiting = new Promise<never>((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true }));
            failPerp!();
            return waiting;
          }
          if (generation === 3 && channel === "spotState")
            thirdAttached = true;
          return { async unsubscribe() { if (generation === 2)
              secondUnsubscribed++; } };
        } };
    } });
  try {
    const stop = await provider.subscribe(account, () => { }, signal());
    failInitial!();
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3500;
      const timer = setInterval(() => {
        if (thirdAttached) {
          clearInterval(timer);
          resolve();
        }
        else if (Date.now() >= deadline) {
          clearInterval(timer);
          reject(new Error("Failed setup was silently ignored"));
        }
      }, 10);
    });
    assert.equal(transports, 3);
    assert.equal(secondUnsubscribed, 1);
    await stop();
  }
  finally {
    await provider.close();
  }
});
test("bulk metadata accepts venue tuple shape and maps canonical namespaces without relying on array order", async () => {
  const data = structuredClone(responses);
  data.allPerpMetas = [data["metaAndAssetCtxs/xyz"], data["metaAndAssetCtxs/"]];
  const calls: string[] = [];
  const provider = fixtureProvider(data, calls);
  try {
    const result = await provider.read(account, signal());
    assert.equal(result.coverage.every(part => part.status === "complete"), true);
    const native = result.positions.find(position => position.kind === "perp" && position.dex === "");
    const builder = result.positions.find(position => position.kind === "perp" && position.dex === "xyz");
    assert.ok(native?.kind === "perp" && builder?.kind === "perp");
    assert.equal(native.notional?.currency, "hyperliquid:mainnet:spot:0");
    assert.equal(builder.notional?.currency, "hyperliquid:mainnet:spot:10");
    assert.equal(calls.length, 7); // D + 5; no per-DEX metadata calls.
    assert.equal(calls.some(call => call.startsWith("meta/")), false);
  }
  finally {
    await provider.close();
  }
});
test("many discovered DEXs require one bulk metadata read plus one account state read per DEX", async () => {
  const data = structuredClone(responses);
  const metas: unknown[] = [(data.allPerpMetas as unknown[])[0]];
  const dexs: unknown[] = [null];
  for (let index = 1; index <= 44; index++) {
    const dex = `builder${index}`;
    dexs.push({ name: dex });
    metas.push({ universe: [{ name: `${dex}:ASSET`, szDecimals: 5, maxLeverage: 10, marginTableId: 1 }], marginTables: [], collateralToken: 0 });
    data[`clearinghouseState/${dex}`] = clearinghouse(`${dex}:ASSET`, "1");
  }
  data.perpDexs = dexs;
  data.allPerpMetas = metas;
  const calls: string[] = [];
  const provider = fixtureProvider(data, calls);
  try {
    const result = await provider.read(account, signal());
    assert.equal(result.coverage.every(part => part.status === "complete"), true);
    assert.equal(result.positions.filter(position => position.kind === "perp").length, 45);
    assert.equal(calls.length, 50);
    assert.equal(calls.filter(call => call === "allPerpMetas").length, 1);
    assert.equal(calls.some(call => call.startsWith("meta/")), false);
  }
  finally {
    await provider.close();
  }
});
