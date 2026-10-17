import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { importSourceCredential } from "./sources/secrets.js";
import { sourceExtensions as defaults } from "./providers/index.js";
import type { SourceExtension, SourceCliValues } from "./sources/extension.js";
import { SourceFailure } from "./sources/contracts.js";

const help = `Portfolio source setup (run from examples/portfolio-monitor)

  bun run sources credential import --file /private/path/credential --name personal
    Saves a private local file; prints only its file: reference for .env.
  bun run sources connection add --adapter PROVIDER --name NAME [provider options]
  bun run sources connection list|probe|targets|enable|disable CONNECTION_ID
  bun run sources connection update CONNECTION_ID --secret-ref REPLACEMENT_REF
  bun run sources source add --connection CONNECTION_ID --target TARGET --name News --interval 60
    Optional: --since RFC3339 --max-pages 5 --mode poll|push --exclude-replies --exclude-reposts
  bun run sources source list|status|sync|inputs|enable|disable SOURCE_ID
  bun run sources source update SOURCE_ID --interval 120 --max-pages 10

Management uses APP_URL (default http://127.0.0.1:8787) and API_TOKEN.
Credentials stay local; management APIs receive references.
`;

export async function runSourceCli(args: string[], options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; print?: (value: string) => void; extensions?: readonly SourceExtension[] } = {}): Promise<void> {
  const extensions = options.extensions ?? defaults;
  const providerOptions = Object.assign({}, ...extensions.map(extension => extension.cli?.options ?? {}));
  const env = options.env ?? process.env;
  const print = options.print ?? console.log;
  const { positionals, values: parsedValues } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: "boolean" }, adapter: { type: "string" }, name: { type: "string" },
    "secret-ref": { type: "string" }, mode: { type: "string" },
    file: { type: "string" }, connection: { type: "string" }, target: { type: "string" }, interval: { type: "string" },
    since: { type: "string" }, "max-pages": { type: "string" }, limit: { type: "string" }, cursor: { type: "string" },
    "exclude-replies": { type: "boolean" }, "exclude-reposts": { type: "boolean" }, ...providerOptions,
  } });
  const values = parsedValues as SourceCliValues;
  const stringValue = (name: string, fallback = "") => typeof values[name] === "string" ? values[name] as string : fallback;
  const [group, action, id] = positionals;
  if (values.help || !group || group === "help") { print(help + extensions.map(extension => extension.cli?.help ?? "").join("\n")); return; }
  const required = (name: string) => {
    const value = values[name];
    if (typeof value !== "string" || !value.trim()) throw new SourceFailure("configuration", `--${name} is required`);
    return value;
  };
  const dataDir = resolve(env.SOURCE_DATA_DIR ?? ".source-data");
  if (group === "credential" && action === "import") {
    const path = await importSourceCredential(dataDir, required("name"), required("file"));
    print(`Saved private credential file. Set your chosen secret reference in .env to:\nfile:${path}\nRestart the application after changing .env.`);
    return;
  }
  for (const extension of extensions) {
    if (await extension.cli?.command?.(positionals, values as SourceCliValues, { env, dataDirectory: dataDir, print })) return;
  }
  const base = new URL(env.APP_URL ?? `http://127.0.0.1:${env.PORT ?? "8787"}`);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new SourceFailure("configuration", "APP_URL must be an HTTP(S) URL without credentials");
  if (base.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) throw new SourceFailure("configuration", "Remote APP_URL must use HTTPS");
  if (!env.API_TOKEN) throw new SourceFailure("configuration", "API_TOKEN is required for management commands");
  async function request(method: string, path: string, body?: object, display = true): Promise<any> {
    let response: Response;
    try { response = await (options.fetch ?? fetch)(new URL(path, base), {
      method, signal: AbortSignal.timeout(35_000), redirect: "error",
      headers: { authorization: `Bearer ${env.API_TOKEN}`, "idempotency-key": randomUUID(), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }); } catch { throw new SourceFailure("transport", "Cannot reach the application; check APP_URL and start the server"); }
    const result = await response.json().catch(() => { throw new SourceFailure("contract", "Application returned an invalid response"); });
    if (!response.ok) throw new SourceFailure("configuration", `Application rejected the command (HTTP ${response.status}): ${typeof result.message === "string" ? result.message : result.error ?? "unknown error"}`);
    if (display) print(JSON.stringify(result, null, 2));
    return result;
  }
  const resource = group === "connection" ? "connections" : group === "source" ? "sources" : null;
  if (!resource) throw new SourceFailure("configuration", "Unknown command; use --help");
  if (action === "list") { await request("GET", `/v1/${resource}?limit=${encodeURIComponent(stringValue("limit","100"))}${values.cursor ? `&cursor=${encodeURIComponent(stringValue("cursor"))}` : ""}`); return; }
  if (action === "add") {
    if (group === "connection") {
      const adapter = required("adapter");
      const extension = extensions.find(extension => extension.id === adapter);
      if (!extension) throw new SourceFailure("configuration", "Source provider is not installed");
      await request("POST", "/v1/connections", { ...(extension.cli?.connection?.(values as SourceCliValues) ?? {}),
        label: required("name"), enabled: true, adapter }); return;
    }
    await request("POST", "/v1/sources", { name: required("name"), kind: "adapter", enabled: true,
      watch: { connectionId: required("connection"), target: required("target"), pollIntervalMs: Number(values.interval ?? "60") * 1000,
        ...(values.mode ? {mode: values.mode} : {}),
        ...(values.since ? { startAt: values.since } : {}), ...(values["max-pages"] ? { maxPages: Number(values["max-pages"]) } : {}),
        includeReplies: !values["exclude-replies"], includeReposts: !values["exclude-reposts"] } }); return;
  }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new SourceFailure("configuration", "A resource UUID is required");
  if (action === "update" && group === "source") {
    const current = await request("GET", `/v1/sources/${id}`, undefined, false);
    if (!current.watch) throw new SourceFailure("configuration", "Only configured adapter sources can be updated with this command");
    await request("PATCH", `/v1/sources/${id}`, { watch: { ...current.watch,
      ...(values.interval ? { pollIntervalMs: Number(values.interval) * 1000 } : {}),
      ...(values["max-pages"] ? { maxPages: Number(values["max-pages"]) } : {}) } }); return;
  }
  if (action === "update" && group === "connection") {
    await request("PATCH", `/v1/connections/${id}`, { secretRef: required("secret-ref") }); return;
  }
  if (["enable", "disable"].includes(action ?? "")) return request("PATCH", `/v1/${resource}/${id}`, { enabled: action === "enable" });
  if (group === "connection" && action === "probe") return request("POST", `/v1/connections/${id}/probe`);
  if (group === "connection" && action === "targets") return request("GET", `/v1/connections/${id}/targets?limit=${encodeURIComponent(stringValue("limit","100"))}`);
  if (group === "source" && action === "sync") return request("POST", `/v1/sources/${id}/sync`);
  if (group === "source" && action === "status") return request("GET", `/v1/sources/${id}/status`);
  if (group === "source" && action === "inputs") return request("GET", `/v1/inputs?sourceId=${id}&limit=${encodeURIComponent(stringValue("limit","50"))}`);
  throw new SourceFailure("configuration", "Unknown command; use --help");
}

if (import.meta.main) {
  runSourceCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof SourceFailure ? error.message : "Source command failed; check configuration and use --help");
    process.exitCode = 1;
  });
}
