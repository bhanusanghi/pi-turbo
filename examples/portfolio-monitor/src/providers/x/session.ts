import { SourceFailure, type Connection, type SourceClient } from "../../sources/contracts.js";
import { collectXPages, record, xConnection, xFailure, xId, xTarget, type XCredentials, type XIdentity, type XPage } from "./common.js";

export type XSessionAuth = { apiKey: string; headers: Record<string, string>; userId: string };
export type SessionCall = { auth: XSessionAuth } & (
  | { method: "identity"; target?: string }
  | { method: "timeline"; target: string; cursor?: string; includeReplies: boolean }
);
export type SessionResult = { identity: XIdentity } | { page: XPage };

/** Explicit encodedApiKey avoids confusing official API bearer tokens with encoded cookies. */
export function parseXSessionAuth(secret: string): XSessionAuth {
  if (secret.length > 65_536) throw new SourceFailure("configuration", "The X credential file is too large.");
  let value: unknown = secret.trim(), cookie: unknown = value;
  let headers: Record<string, string> = {};
  if (secret.trim().startsWith("{") || secret.trim().startsWith("[")) {
    try { value = JSON.parse(secret); } catch { throw new SourceFailure("configuration", "The X session credential JSON is invalid."); }
    if (Array.isArray(value)) {
      cookie = value.map(entry => {
        const c = record(entry); if (typeof c.name !== "string" || typeof c.value !== "string") throw new SourceFailure("configuration", "The browser cookie export is invalid.");
        return `${c.name}=${c.value}`;
      }).join("; ");
    } else {
      const obj = record(value);
      const h = record(obj.headers);
      for (const [name, header] of Object.entries(h)) {
        if (typeof header !== "string" || /[\r\n]/.test(header) || !/^[A-Za-z0-9-]+$/.test(name)) throw new SourceFailure("configuration", "The X session headers are invalid.");
        // Rettiwt supplies authentication from validated cookies; custom headers must not override it.
        if (["user-agent", "accept-language", "x-twitter-client-language"].includes(name.toLowerCase())) headers[name] = header;
      }
      cookie = obj.cookie ?? obj.cookies ?? h.cookie ?? h.Cookie;
      if (typeof obj.encodedApiKey === "string") cookie = Buffer.from(obj.encodedApiKey, "base64").toString("utf8");
      if (cookie === undefined) cookie = ["auth_token", "ct0", "twid", "kdt"].filter(key => obj[key] !== undefined).map(key => {
        if (typeof obj[key] !== "string") throw new SourceFailure("configuration", "The X session cookie fields are invalid.");
        return `${key}=${obj[key]}`;
      }).join("; ");
    }
  }
  if (typeof cookie !== "string" || /[\r\n]/.test(cookie)) throw new SourceFailure("configuration", "Supply an X cookie header or a supported JSON cookie export.");
  const cookies = new Map<string, string>();
  for (const pair of cookie.split(";")) {
    if (!pair.trim()) continue;
    const equals = pair.indexOf("="), name = pair.slice(0, equals).trim(), val = pair.slice(equals + 1).trim();
    if (equals < 1 || !/^[A-Za-z0-9_\-.]+$/.test(name) || !val || cookies.has(name)) throw new SourceFailure("configuration", "The X cookie header is malformed or contains duplicate fields.");
    cookies.set(name, val);
  }
  if (!cookies.get("auth_token") || !cookies.get("ct0")) throw new SourceFailure("configuration", "An authenticated X session requires auth_token, ct0 and twid cookies. Guest credentials are unsupported.");
  const twid = cookies.get("twid")?.replace(/^"|"$/g, "");
  let userId: string | undefined;
  try { userId = twid ? /^u=(\d+)$/.exec(decodeURIComponent(twid))?.[1] : undefined; } catch { /* invalid encoded cookie */ }
  if (!userId) throw new SourceFailure("configuration", "The X session needs its twid account cookie as well as auth_token and ct0.");
  cookies.set("twid", `"u=${userId}"`);
  // A trailing semicolon also accommodates Rettiwt's encoded twid matcher.
  // Rettiwt feeds each semicolon-separated segment directly to cookiejar; whitespace would hide ct0 from its parser.
  const finalCookie = [...cookies].map(([name, val]) => `${name}=${val}`).join(";") + ";";
  return { apiKey: Buffer.from(finalCookie).toString("base64"), headers, userId: xId(userId) };
}

type SourceWorker = Pick<Worker, "postMessage" | "terminate" | "addEventListener" | "removeEventListener">;
export function createXSessionClient(options: XCredentials & {
  timeoutMs?: number;
  /** Alternate protocol transport for tests; production runs the stock SDK in a cancellable worker. */
  sessionCall?: (request: SessionCall, signal: AbortSignal) => Promise<SessionResult>;
  workerFactory?: (url: URL) => SourceWorker;
}): SourceClient {
  const active = new Set<() => void>();
  let closed = false;
  async function call(request: SessionCall, signal: AbortSignal): Promise<SessionResult> {
    if (closed) throw new SourceFailure("transport", "The X session client is closed.");
    signal.throwIfAborted();
    if (options.sessionCall) return options.sessionCall(request, signal);
    // Rettiwt's homepage/transaction bootstrap lacks AbortSignal support. A worker makes cancellation terminate the underlying I/O.
    const workerUrl = new URL(import.meta.url.endsWith(".ts") ? "./session-worker.ts" : "./session-worker.js", import.meta.url);
    const worker = options.workerFactory?.(workerUrl) ?? new Worker(workerUrl);
    return new Promise<SessionResult>((resolve, reject) => {
      let settled = false;
      const finish = (result?: SessionResult, error?: SourceFailure) => {
        if (settled) return; settled = true;
        clearTimeout(timer); signal.removeEventListener("abort", abort);
        worker.removeEventListener("message", message); worker.removeEventListener("error", failed);
        active.delete(abort); worker.terminate();
        error ? reject(error) : resolve(result!);
      };
      const abort = () => finish(undefined, new SourceFailure("transport", "X request was cancelled. No checkpoint was advanced."));
      const failed = () => finish(undefined, new SourceFailure("transport", "The X session worker failed. No checkpoint was advanced."));
      const message = (event: Event) => {
        const data = record((event as MessageEvent).data);
        if (data.ok === true && data.result) finish(data.result as SessionResult);
        else {
          const error = record(data.error);
          const codes = ["authentication", "rate_limit", "access", "contract", "transport", "configuration"];
          if (!codes.includes(String(error.code))) { failed(); return; }
          // Worker errors have already been sanitized; never pass arbitrary SDK exception strings.
          const code = error.code as SourceFailure["code"];
          const messages: Record<SourceFailure["code"], string> = {
            authentication: "X authentication expired or was rejected. Reconnect the account.", rate_limit: "X rate limit reached. Collection will retry later.",
            access: "The X account or target is unavailable.", contract: "X returned an unsupported response or rejected its pagination cursor.",
            transport: "X request failed. No checkpoint was advanced.", configuration: "The X session configuration is invalid.",
          };
          finish(undefined, new SourceFailure(code, messages[code], typeof error.retryAfterMs === "number" ? error.retryAfterMs : undefined));
        }
      };
      const timer = setTimeout(() => finish(undefined, new SourceFailure("transport", "X request timed out. The collection worker was terminated.")), options.timeoutMs ?? 30_000);
      active.add(abort); signal.addEventListener("abort", abort, { once: true });
      worker.addEventListener("message", message); worker.addEventListener("error", failed);
      if (signal.aborted) abort(); else worker.postMessage(request);
    });
  }
  async function auth(connection: Connection): Promise<XSessionAuth> {
    const configuration = xConnection(connection, "x-session");
    return parseXSessionAuth(await options.resolveSecret(configuration.secretRef));
  }
  return {
    async probe(connection, signal) {
      try {
        const credentials = await auth(connection);
        const result = await call({ auth: credentials, method: "identity" }, signal);
        if (!("identity" in result) || result.identity.id !== credentials.userId) throw new SourceFailure("authentication", "The X session identity could not be verified.");
        return { identity: result.identity.id, label: result.identity.username };
      } catch (error) { throw xFailure(error); }
    },
    async collect(connection, source, checkpoint, signal) {
      try {
        const credentials = await auth(connection);
        let user: XIdentity;
        if (checkpoint?.targetId) {
          user = { id: xId(checkpoint.targetId), username: typeof checkpoint.targetUsername === "string" ? checkpoint.targetUsername : undefined,
            pinnedIds: Array.isArray(checkpoint.pinnedIds) ? checkpoint.pinnedIds.map(xId) : [] };
        } else {
          const result = await call({ auth: credentials, method: "identity", target: xTarget(source.watch.target) }, signal);
          if (!("identity" in result)) throw new SourceFailure("contract", "X omitted the target identity.");
          user = result.identity;
        }
        const batch = await collectXPages(source, checkpoint, user, async cursor => {
          const result = await call({ auth: credentials, method: "timeline", target: user.id, cursor, includeReplies: source.watch.includeReplies !== false }, signal);
          if (!("page" in result)) throw new SourceFailure("contract", "X omitted the requested timeline.");
          return result.page;
        }, signal);
        batch.checkpoint.pinnedIds = user.pinnedIds ?? [];
        return batch;
      } catch (error) { throw xFailure(error); }
    },
    async close() { closed = true; for (const cancel of [...active]) cancel(); },
  };
}
