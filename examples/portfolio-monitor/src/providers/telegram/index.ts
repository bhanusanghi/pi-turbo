import { resolve } from "node:path";
import { Type } from "typebox";
import { AppError } from "../../contracts.js";
import type { SourceExtension } from "../../sources/extension.js";
import { createTelegramSourceClient } from "./client.js";
import { telegramTarget } from "./config.js";
import { telegramCli } from "./cli.js";

export const telegramSourceExtension: SourceExtension = {
  id: "telegram-user",
  connectionSchema: Type.Object({ label: Type.String({ minLength: 1, maxLength: 200 }), enabled: Type.Boolean(), adapter: Type.Literal("telegram-user"),
    apiIdRef: Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,99}$" }), apiHashRef: Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,99}$" }),
    sessionName: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }) }, { additionalProperties: false }),
  validateWatch(_connection, watch) {
    if (watch.mode !== undefined && watch.mode !== "poll") throw new AppError("invalid_input", "Telegram sources require poll mode");
    try { telegramTarget(watch.target); } catch { throw new AppError("invalid_input", "Use a Telegram peer ID or username as the target"); }
  },
  acceptsRevision(previous, incoming) {
    // History may race live edits. Deletion is terminal; equal timestamps allow
    // same-second edits, whose publication order is supplied by the source lane.
    if (previous.deleted === true && incoming.deleted !== true) return false;
    const latestTime = previous.provenance?.editedAt ?? previous.publishedAt;
    const incomingTime = incoming.provenance?.editedAt ?? incoming.publishedAt;
    return incoming.deleted === true || !latestTime || !!incomingTime && Date.parse(incomingTime) >= Date.parse(latestTime);
  },
  createClient(context) { return createTelegramSourceClient({ resolveSecret: context.resolveSecret, sessionDirectory: resolve(context.dataDirectory, "telegram"), onWatchFailure: (_sourceId, error) => context.onError(error) }); },
  cli: telegramCli,
};
