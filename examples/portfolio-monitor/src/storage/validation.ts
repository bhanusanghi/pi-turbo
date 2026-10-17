import { AppError } from "../contracts.js";
import { emptySourceCatalog } from "../sources/catalog.js";
import type { SourceCatalog } from "../sources/catalog.js";
import type { AccountObservation, InputDraft, NotificationDraft, ResourceDrafts, ResourceKind } from "../contracts.js";

export function fail(message: string, code = "invalid_input", status = 400): never { throw new AppError(code, message, status); }
export function string(value: unknown, name: string, max = 200): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${name} must be a nonempty string of at most ${max} characters`);
}
export function uuid(value: unknown, name = "id"): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(`${name} must be a UUID`);
}
function arrayIds(value: unknown, name: string, max = 100): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length) fail(`${name} must contain unique IDs within the allowed limit`);
  for (const id of value) uuid(id, name);
}
function date(value: unknown, name: string): void {
  if (typeof value !== "string") fail(`${name} must be an RFC3339 timestamp with timezone`);
  const match=/^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) fail(`${name} must be an RFC3339 timestamp with timezone`);
  const year=Number(match[1]), month=Number(match[2]), day=Number(match[3]);
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const days=[31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  if (month<1 || month>12 || day<1 || day>days[month-1]! || Number(match[4])>23 || Number(match[5])>59 || Number(match[6])>59 || Number(match[8] ?? 0)>23 || Number(match[9] ?? 0)>59 || !Number.isFinite(Date.parse(value))) fail(`${name} contains an invalid date or time`);
}
export function resource<K extends ResourceKind>(kind: K, draft: ResourceDrafts[K], catalog: SourceCatalog = emptySourceCatalog): void {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) fail("Resource must be an object");
  if (typeof draft.enabled !== "boolean") fail("enabled must be boolean");
  if (kind === "connections") { catalog.validateConnection(draft as ResourceDrafts["connections"]); return; }
  const d = draft as unknown as Record<string, unknown>;
  const allowed: Record<ResourceKind, string[]> = {
    sources: ["name", "kind", "enabled", "watch"], connections: [], accounts: ["label", "address", "network", "perpDexs", "enabled"],
    portfolios: ["name", "accountIds", "enabled"], monitors: ["name", "portfolioId", "sourceIds", "destinationIds", "enabled"],
    destinations: ["label", "adapter", "chatId", "secretRef", "enabled"],
  };
  if (!(kind in allowed)) fail("Unknown resource kind");
  if (Object.keys(d).some(key => !allowed[kind].includes(key))) fail("Unknown resource field");
  if (kind === "sources") {
    string(d.name,"name"); if (!["manual","adapter"].includes(d.kind as string)) fail("Invalid source kind");
    if(d.watch!==undefined) {
      if(d.kind!=="adapter" || !d.watch || typeof d.watch!=="object" || Array.isArray(d.watch)) fail("watch requires an adapter source");
      const w=d.watch as Record<string,unknown>;
      if(Object.keys(w).some(k=>!["connectionId","target","mode","pollIntervalMs","startAt","maxPages","includeReplies","includeReposts"].includes(k))) fail("Unknown watch field");
      uuid(w.connectionId,"connectionId"); string(w.target,"target",200);
      if(w.mode!==undefined && w.mode!=="poll" && w.mode!=="push") fail("mode must be poll or push");
      if(!Number.isInteger(w.pollIntervalMs) || Number(w.pollIntervalMs)<10000 || Number(w.pollIntervalMs)>86_400_000) fail("pollIntervalMs must be 10000–86400000");
      if(w.startAt!==undefined) date(w.startAt,"startAt");
      if(w.maxPages!==undefined && (!Number.isInteger(w.maxPages) || Number(w.maxPages)<1 || Number(w.maxPages)>20)) fail("maxPages must be 1–20");
      for(const k of ["includeReplies","includeReposts"]) if(w[k]!==undefined && typeof w[k]!=="boolean") fail(`${k} must be boolean`);
    }
  }
  if (kind === "accounts") {
    string(d.label, "label"); if (typeof d.address !== "string" || !/^0x[0-9a-f]{40}$/i.test(d.address)) fail("Invalid Hyperliquid account address");
    if (!["mainnet", "testnet"].includes(d.network as string)) fail("Invalid network");
    if (d.perpDexs !== "all") {
      if (!Array.isArray(d.perpDexs) || d.perpDexs.length === 0 || d.perpDexs.length > 100 || new Set(d.perpDexs).size !== d.perpDexs.length) fail("perpDexs must be all or a nonempty unique list");
      for (const dex of d.perpDexs) if (typeof dex !== "string" || dex.length > 100) fail("Invalid perp DEX name");
    }
  }
  if (kind === "portfolios") { string(d.name, "name"); arrayIds(d.accountIds, "accountIds"); }
  if (kind === "monitors") { string(d.name, "name"); uuid(d.portfolioId, "portfolioId"); arrayIds(d.sourceIds, "sourceIds",Number.MAX_SAFE_INTEGER); arrayIds(d.destinationIds, "destinationIds"); }
  if (kind === "destinations") {
    string(d.label, "label"); if (!["preview", "telegram"].includes(d.adapter as string)) fail("Invalid destination adapter");
    if (d.adapter === "telegram") { string(d.chatId, "chatId", 128); string(d.secretRef, "secretRef", 128); if (!/^[A-Z][A-Z0-9_]*$/.test(d.secretRef)) fail("secretRef must be an environment variable name"); }
    else if (d.chatId !== undefined || d.secretRef !== undefined) fail("Preview destinations cannot contain Telegram configuration");
  }
}
export function input(d: InputDraft): void {
  if (!d || typeof d !== "object") fail("Input must be an object");
  if (Object.keys(d).some(k => !["sourceItemId", "kind", "sourceRevision", "publishedAt", "text", "title", "url", "relatesTo", "deleted", "provenance"].includes(k))) fail("Unknown input field");
  string(d.sourceItemId,"sourceItemId",500);
  if(d.deleted!==undefined && typeof d.deleted!=="boolean") fail("deleted must be boolean");
  if(d.deleted===true && d.text==="") {} else string(d.text,"text",1_000_000);
  if(d.provenance!==undefined) {
    const p=d.provenance;
    if(!p || typeof p!=="object" || Array.isArray(p) || Object.keys(p).some(k=>!["provider","targetId","messageId","authorId","authorName","threadId","forwardedFrom","editedAt","contentKind","permission","relatedSymbols"].includes(k))) fail("Invalid provenance");
    string(p.provider,"provenance provider",100);
    string(p.targetId,"targetId",200); string(p.messageId,"messageId",500);
    for(const k of ["authorId","authorName","threadId","forwardedFrom"] as const) if(p[k]!==undefined) string(p[k],k,500);
    if(p.contentKind!==undefined && p.contentKind!=="headline" && p.contentKind!=="alert") fail("Invalid provenance contentKind");
    if(p.permission!==undefined) string(p.permission,"permission",200);
    if(p.relatedSymbols!==undefined) {
      if(!Array.isArray(p.relatedSymbols) || p.relatedSymbols.length>100 || new Set(p.relatedSymbols).size!==p.relatedSymbols.length) fail("relatedSymbols must contain at most 100 unique symbols");
      for(const symbol of p.relatedSymbols) string(symbol,"related symbol",100);
    }
    if(p.editedAt!==undefined) date(p.editedAt,"editedAt");
  }
  if (!["article", "message"].includes(d.kind)) fail("Invalid input kind");
  if (d.sourceRevision !== undefined) string(d.sourceRevision, "sourceRevision", 200);
  if (d.publishedAt !== null) date(d.publishedAt, "publishedAt");
  if (d.title !== undefined) string(d.title, "title", 2000);
  if (d.url !== undefined) httpUrl(d.url);
  if (d.relatesTo !== undefined) {
    if (!Array.isArray(d.relatesTo) || d.relatesTo.length > 100) fail("Too many input relationships");
    for (const relation of d.relatesTo) { if(!relation || typeof relation!=="object" || Object.keys(relation).some(k=>!["sourceItemId","relation"].includes(k))) fail("Invalid relationship fields"); string(relation.sourceItemId, "related sourceItemId", 500); if (!["reply", "correction", "quote", "repost"].includes(relation.relation)) fail("Invalid relationship"); }
  }
}
export function httpUrl(value: unknown): void {
  string(value, "url", 4000); let parsed: URL;
  try { parsed = new URL(value); } catch { return fail("Invalid URL"); }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) fail("URL must use HTTP(S) without credentials");
}
export function notification(d: NotificationDraft): void {
  if (!d || typeof d !== "object") fail("Notification must be an object");
  if (Object.keys(d).some(k => !["destinationId", "content", "origin", "evidenceRevisionIds"].includes(k))) fail("Unknown notification field");
  uuid(d.destinationId, "destinationId");
  if (!["operator_test", "application"].includes(d.origin)) fail("Invalid notification origin");
  if (!d.content || typeof d.content !== "object") fail("Notification content required");
  string(d.content.title, "title", 1000); string(d.content.body, "body", 100_000);
  if (Object.keys(d.content).some(k => !["title", "body", "links"].includes(k))) fail("Unknown notification content field");
  if (d.content.links !== undefined) {
    if (!Array.isArray(d.content.links) || d.content.links.length > 100) fail("Too many notification links");
    for (const link of d.content.links) { string(link.label, "link label", 500); httpUrl(link.url); }
  }
  if (d.evidenceRevisionIds !== undefined) arrayIds(d.evidenceRevisionIds, "evidenceRevisionIds");
}
export function observation(d: AccountObservation): void {
  uuid(d.accountId, "accountId"); date(d.startedAt, "startedAt"); date(d.completedAt, "completedAt");
  if (Date.parse(d.startedAt) > Date.parse(d.completedAt)) fail("Observation timestamps are reversed");
  if (!["mainnet", "testnet"].includes(d.network) || !/^0x[0-9a-f]{40}$/i.test(d.address)) fail("Invalid observation identity");
  string(d.exposureHash, "exposureHash", 200);
  if (!Array.isArray(d.positions) || !Array.isArray(d.coverage) || !Array.isArray(d.issues)) fail("Invalid observation collections");
  const decimal = (v: unknown) => { if (typeof v !== "string" || !/^-?\d+(?:\.\d+)?$/.test(v)) fail("Position values must be decimal strings"); };
  const instruments = new Set<string>();
  for (const p of d.positions) {
    if (p.accountId !== d.accountId) fail("Observation contains another account's position");
    string(p.instrumentId, "instrumentId", 500); if (instruments.has(p.instrumentId)) fail("Duplicate position identity"); instruments.add(p.instrumentId);
    if (p.kind === "spot") { if (!Number.isInteger(p.tokenId) || p.tokenId < 0) fail("Invalid spot token ID"); string(p.venueSymbol, "venueSymbol"); decimal(p.total); decimal(p.hold); if (p.spotHold !== null) decimal(p.spotHold); }
    else if (p.kind === "perp") { decimal(p.signedSize); if (!["long", "short"].includes(p.side) || !["cross", "isolated", "unknown"].includes(p.marginMode)) fail("Invalid perp side/margin mode"); for (const v of [p.entryPrice,p.leverage,p.liquidationPrice]) if (v !== null) decimal(v); }
    else fail("Invalid position kind");
    for (const money of p.kind === "spot" ? [p.value] : [p.notional, p.unrealizedPnl]) if (money !== null) { decimal(money.amount); string(money.currency, "currency"); }
  }
  for (const part of d.coverage) { string(part.part, "coverage part"); if (!["complete", "failed", "unsupported"].includes(part.status)) fail("Invalid coverage status"); date(part.receivedAt, "coverage receivedAt"); }
}
