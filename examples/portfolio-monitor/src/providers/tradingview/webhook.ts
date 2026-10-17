import { createPushReceiver } from "../../sources/receiver.js";
import { timingSafeEqual } from "node:crypto";
import { AppError, type AppStore } from "../../contracts.js";
import { SourceFailure, type Connection, type SourceClient } from "../../sources/contracts.js";

export const tradingViewWebhookPath = "/webhooks/tradingview/:sourceId/:token";
export type TradingViewAlert = { eventId: string; symbol: string; triggeredAt: string; text: string };

export function createTradingViewWebhook(options: { store: AppStore; resolveSecret(name: string): Promise<string> }) {
  async function credential(connection: Connection): Promise<string> {
    if (connection.adapter !== "tradingview-webhook" || typeof connection.secretRef !== "string") throw new SourceFailure("configuration", "Wrong webhook connection type");
    const token = await options.resolveSecret(connection.secretRef);
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new SourceFailure("configuration", "Webhook secret must be 32–128 random base64url characters");
    return token;
  }
  const client: SourceClient = {
    async probe(connection, signal) { signal.throwIfAborted(); await credential(connection); return { identity: "tradingview-webhook", label: "Local receiver secret configured; no TradingView connectivity test" }; },
    async collect() { throw new SourceFailure("configuration", "Webhook sources receive pushes and cannot be polled"); },
    async close() {},
  };
  const receive = createPushReceiver<TradingViewAlert>({ store: options.store, adapter: "tradingview-webhook",
    async authenticate(connection, supplied) {
      const expected = Buffer.from(await credential(connection)), actual = Buffer.from(supplied);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    },
    normalize(source, alert) {
      if (alert.symbol !== source.watch.target) throw new AppError("symbol_mismatch", "Alert symbol does not match this source");
      return { sourceItemId: `tv-alert:${alert.eventId}`, sourceRevision: "1", kind: "message", text: alert.text,
        publishedAt: alert.triggeredAt,
        provenance: { provider: "tradingview", targetId: alert.symbol, messageId: alert.eventId, contentKind: "alert" } };
    },
  });
  return { client, receive };
}
