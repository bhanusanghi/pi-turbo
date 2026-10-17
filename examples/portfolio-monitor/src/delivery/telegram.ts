import { Api, GrammyError } from "grammy";
import type { DeliveryAdapter, DeliveryResult } from "../contracts.js";

export type TelegramReceipt = { message_id: number; chat: { id: number | string }; date?: number };
export interface TelegramClient {
  sendMessage(chatId: string, text: string, options: { link_preview_options: { is_disabled: true } }, signal: AbortSignal): Promise<TelegramReceipt>;
}
export type TelegramOptions = {
  resolveSecret(name: string): string | undefined;
  timeoutMs?: number;
  maxRetryDelayMs?: number;
  createClient?: (token: string) => TelegramClient;
};

/** Outbound API only. Does not start bot polling or install message handlers. */
export function createTelegramAdapter(options: TelegramOptions): DeliveryAdapter {
  const timeoutMs = positiveInteger(options.timeoutMs ?? 15_000, "timeoutMs", 60_000);
  const maxRetryDelayMs = positiveInteger(options.maxRetryDelayMs ?? 3_600_000, "maxRetryDelayMs", 86_400_000);
  const createClient = options.createClient ?? ((token: string): TelegramClient => {
    const api = new Api(token, { timeoutSeconds: Math.ceil(timeoutMs / 1000) });
    return {
      sendMessage(chatId, text, other, signal) {
        // grammY's Node declarations use abort-controller's older EventTarget
        // type. Its public runtime accepts native signals through aborted and
        // addEventListener/removeEventListener; no signal behavior is replaced.
        return api.sendMessage(chatId, text, other, signal as Parameters<Api["sendMessage"]>[3]);
      },
    };
  });
  return {
    async send(destination, text, signal): Promise<DeliveryResult> {
      if (destination.adapter !== "telegram") return { status: "rejected", error: "Telegram adapter received another destination type" };
      if (!destination.enabled) return { status: "rejected", error: "Notification destination is disabled" };
      if (signal.aborted) return { status: "rejected", error: "Delivery cancelled before transmission" };
      let token: string | undefined;
      try { token = options.resolveSecret(destination.secretRef); }
      catch { return { status: "rejected", error: "Notification destination secret is unavailable" }; }
      if (!token) return { status: "rejected", error: "Notification destination secret is unavailable" };
      let client: TelegramClient;
      try { client = createClient(token); } catch { return { status: "rejected", error: "Telegram client configuration is invalid" }; }
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
      try {
        const receipt = await boundedSend(client, destination.chatId, text, bounded);
        if (!Number.isSafeInteger(receipt?.message_id) || receipt.message_id <= 0 ||
            !receipt.chat || !["number", "string"].includes(typeof receipt.chat.id)) {
          return { status: "unknown", error: "Telegram returned an invalid delivery receipt; acceptance is uncertain" };
        }
        // A provider receipt is stronger evidence than a subsequently aborted host signal.
        return { status: "sent", receipt: {
          provider: "telegram", messageId: String(receipt.message_id), chatId: String(receipt.chat.id),
          ...(Number.isFinite(receipt.date) ? { providerTimestamp: receipt.date! } : {}),
        } };
      } catch (error) {
        if (error instanceof GrammyError) {
          const retrySeconds = error.parameters.retry_after;
          if (error.error_code === 429 && Number.isInteger(retrySeconds) && retrySeconds! > 0) {
            const retryAfterMs = retrySeconds! * 1000;
            if (retryAfterMs <= maxRetryDelayMs) return { status: "retry", retryAfterMs, error: "Telegram rate limit rejected this attempt" };
            return { status: "rejected", error: "Telegram retry delay exceeds the configured delivery limit" };
          }
          // A structured Bot API error is evidence that this send was rejected.
          return { status: "rejected", error: `Telegram rejected message (API ${error.error_code})` };
        }
        // Never persist error.message/cause: transport errors may contain the bot token URL.
        return { status: "unknown", error: "Telegram transport failed or was interrupted; acceptance is uncertain" };
      }
    },
  };
}

function boundedSend(client: TelegramClient, chatId: string, text: string, signal: AbortSignal): Promise<TelegramReceipt> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error("Telegram request interrupted"));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error("Telegram request interrupted before send");
      return client.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } }, signal);
    })
      .then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

function positiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return value;
}
