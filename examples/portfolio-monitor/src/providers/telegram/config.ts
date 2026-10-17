import { SourceFailure, type ConnectionDraft } from "../../sources/contracts.js";

export function telegramConnection(connection: ConnectionDraft): { apiIdRef: string; apiHashRef: string; sessionName: string } {
  if (connection.adapter !== "telegram-user") throw new SourceFailure("configuration", "This connection is not a Telegram user account.");
  const { apiIdRef, apiHashRef, sessionName } = connection;
  if (typeof apiIdRef !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(apiIdRef) || typeof apiHashRef !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(apiHashRef) || typeof sessionName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(sessionName)) {
    throw new SourceFailure("configuration", "The Telegram connection configuration is invalid.");
  }
  return { apiIdRef, apiHashRef, sessionName };
}
export function telegramTarget(target: string): string | number {
  if (/^-?\d+$/.test(target)) {
    const value = Number(target);
    if (!Number.isSafeInteger(value)) throw new SourceFailure("configuration", "Telegram target ID is invalid.");
    return value;
  }
  if (!/^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(target)) throw new SourceFailure("configuration", "Use a Telegram peer ID or username as the target.");
  return target.replace(/^@/, "");
}
