import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { SourceExtension } from "../../sources/extension.js";
import { createSourceSecretResolver } from "../../sources/secrets.js";
import { SourceFailure } from "../../sources/contracts.js";
import { loginTelegram, logoutTelegram } from "./client.js";

async function question(label: string, hidden = false): Promise<string> {
  if (!process.stdin.isTTY) throw new SourceFailure("configuration", "Telegram login requires an interactive terminal");
  process.stdout.write(`${label}: `);
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const reader = createInterface({ input: process.stdin, output: hidden ? silent : process.stdout, terminal: true });
  try { return (await reader.question("")).trim(); }
  finally { reader.close(); if (hidden) process.stdout.write("\n"); }
}
function option(value: string | boolean | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) throw new SourceFailure("configuration", "Telegram setup options must be nonempty strings");
  return value;
}
export const telegramCli: NonNullable<SourceExtension["cli"]> = {
  help: `  bun run sources telegram login --session personal
  bun run sources telegram logout --session personal
    Uses TELEGRAM_API_ID and TELEGRAM_API_HASH; asks for phone/code/2FA locally.
    Stop the application before login/logout. Sessions stay under SOURCE_DATA_DIR.
  bun run sources connection add --adapter telegram-user --name Personal --session personal
    Telegram targets use a discovered chat ID or @username.`,
  options: { session: { type: "string" }, "api-id-ref": { type: "string" }, "api-hash-ref": { type: "string" } },
  connection(values) {
    return { apiIdRef: option(values["api-id-ref"], "TELEGRAM_API_ID"), apiHashRef: option(values["api-hash-ref"], "TELEGRAM_API_HASH"), sessionName: option(values.session, "personal") };
  },
  async command(positionals, values, context) {
    const [group, action] = positionals;
    if (group !== "telegram" || !["login", "logout"].includes(action ?? "")) return false;
    const auth = { sessionDirectory: resolve(context.dataDirectory, "telegram"), sessionName: option(values.session, "personal"),
      apiIdRef: option(values["api-id-ref"], "TELEGRAM_API_ID"), apiHashRef: option(values["api-hash-ref"], "TELEGRAM_API_HASH"),
      resolveSecret: createSourceSecretResolver(name => context.env[name]) };
    if (action === "login") {
      await loginTelegram({ ...auth, phone: () => question("Telegram phone number"), code: () => question("Telegram login code", true), password: () => question("Telegram 2FA password", true) });
      context.print("Telegram session saved locally. Start the application, add the connection, then discover targets.");
    } else { await logoutTelegram(auth); context.print("Telegram session logged out."); }
    return true;
  },
};
