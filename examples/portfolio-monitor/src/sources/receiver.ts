import { randomUUID } from "node:crypto";
import { AppError, type AppStore, type InputDraft } from "../contracts.js";
import type { Connection, WatchedSource } from "./contracts.js";

/** Shared push admission: provider authenticates/normalizes; storage rechecks revisions. */
export function createPushReceiver<Body>(options: {
  store: AppStore;
  adapter: string;
  authenticate(connection: Connection, credential: string): Promise<boolean>;
  normalize(source: WatchedSource, body: Body): InputDraft;
}) {
  return async (sourceId: string, credential: string, body: Body) => {
    const denied = () => new AppError("unauthorized", "Webhook is unavailable or credential is invalid", 401);
    const source = await options.store.getResource("sources", sourceId);
    if (!source?.enabled || source.kind !== "adapter" || source.watch?.mode !== "push") throw denied();
    const connection = await options.store.getResource("connections", source.watch.connectionId);
    if (!connection?.enabled || connection.adapter !== options.adapter || !await options.authenticate(connection, credential)) throw denied();
    const input = options.normalize(source as WatchedSource, body);
    return options.store.acceptInput(source.id, input, randomUUID(), {
      sourceRevision: source.revision, connectionId: connection.id, connectionRevision: connection.revision,
    });
  };
}
