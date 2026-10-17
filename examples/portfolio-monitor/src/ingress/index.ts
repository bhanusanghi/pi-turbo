import { randomUUID } from "node:crypto";
import type { AppStore, InputDraft } from "../contracts.js";

/** The host binds identity. Source adapters can publish only for their configured source. */
export function ingressForSource(store: AppStore, sourceId: string) {
  return {
    publish(input: InputDraft, idempotencyKey = randomUUID()) {
      return store.acceptInput(sourceId, input, idempotencyKey);
    },
  };
}
