import { AppError, type AppStore, type Delivery, type DeliveryResult, type Destination, type NotificationDraft } from "../contracts.js";
import { previewAdapter } from "./preview.js";
import { renderNotification } from "./render.js";
import { createTelegramAdapter, type TelegramOptions } from "./telegram.js";

export { renderNotification } from "./render.js";
export { createTelegramAdapter, type TelegramClient } from "./telegram.js";
export { previewAdapter } from "./preview.js";

export type DeliveryModuleOptions = TelegramOptions & { store: AppStore; maxAttempts?: number };
export function createDeliveryModule(options: DeliveryModuleOptions) {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("maxAttempts must be an integer between 1 and 10");
  const telegram = createTelegramAdapter(options);
  return {
    async request(draft: NotificationDraft, key: string): Promise<Delivery> {
      if (!draft || !["application", "operator_test"].includes(draft.origin)) throw new AppError("invalid_notification", "Notification origin must be explicit");
      renderNotification(draft.content);
      // Admission/deduplication share one store transaction. Mutable destination
      // and host-secret prechecks here would prevent recovery of an accepted
      // request after configuration changes. Secrets are checked at dispatch.
      return options.store.requestNotification(draft, key);
    },
    async processDelivery(id: string, signal: AbortSignal): Promise<void> {
      async function finish(result: DeliveryResult) {
        try { await options.store.finishDelivery(id,result); }
        catch (error) {
          // A failed commit may have succeeded on the server. The store's
          // sending-only guard preserves that receipt; otherwise record uncertainty.
          // If storage is still unavailable, startup recovery handles the orphan.
          await options.store.finishDelivery(id,{status:"unknown",error:"Delivery result could not be committed; acceptance is uncertain"}).catch(() => {});
          throw error;
        }
      }
      const stored = await options.store.getDelivery(id);
      if (!stored) throw new AppError("delivery_not_found", "Delivery not found", 404);
      if (stored.status !== "queued") return;
      let rendered: string;
      try { rendered = renderNotification(stored.content); }
      catch { // Invalid stored records are terminal and cannot enter an external adapter.
        const admitted = await options.store.beginDelivery(id, "Invalid notification content");
        if (admitted) await finish({ status: "rejected", error: "Stored notification content is invalid" });
        return;
      }
      // Capture immutable routing before admission. The store checks the saved
      // destination revision inside admission; a later PATCH must never redirect
      // this already admitted delivery to another chat or adapter.
      let destination: Destination | undefined;
      let destinationError: string | undefined;
      try { destination = await requireDestination(options.store, stored.destinationId, options.resolveSecret); }
      catch (error) { destinationError = error instanceof AppError ? error.message : "Notification destination is unavailable"; }
      const admitted = await options.store.beginDelivery(id, rendered);
      if (!admitted) return; // Concurrent/duplicate jobs cannot send twice.
      if (!destination) {
        await finish({ status: "rejected", error: destinationError ?? "Notification destination is unavailable" });
        return;
      }
      if (admitted.attempts > maxAttempts) {
        await finish({ status: "rejected", error: "Notification attempt limit reached" });
        return;
      }
      let result: DeliveryResult = await (destination.adapter === "preview" ? previewAdapter : telegram).send(destination, rendered, signal);
      if (result.status === "retry" && admitted.attempts >= maxAttempts) result = { status: "rejected", error: "Telegram rate limit retry attempt limit reached" };
      await finish(result);
    },
  };
}

async function requireDestination(store: AppStore, id: string, resolveSecret: TelegramOptions["resolveSecret"]): Promise<Destination> {
  const resource = await store.getResource("destinations", id);
  if (!resource) throw new AppError("destination_not_found", "Notification destination not found", 404);
  const destination = structuredClone(resource);
  if (!destination.enabled) throw new AppError("destination_disabled", "Notification destination is disabled", 409);
  if (destination.adapter === "telegram") {
    if (!destination.chatId.trim() || !destination.secretRef.trim()) throw new AppError("invalid_destination", "Telegram chat and secret reference are required");
    let secretAvailable = false;
    try { secretAvailable = Boolean(resolveSecret(destination.secretRef)); } catch { /* Host diagnostics may contain credentials. */ }
    if (!secretAvailable) throw new AppError("destination_secret_unavailable", "Notification destination secret is unavailable", 503);
  }
  return destination;
}
