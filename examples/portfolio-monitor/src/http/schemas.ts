import { Type } from "typebox";
import { emptySourceCatalog } from "../sources/catalog.js";
import type { SourceCatalog } from "../sources/catalog.js";

const text = (max = 200) => Type.String({ minLength: 1, maxLength: max });
const id = text(100);
const ids = Type.Array(id, { uniqueItems: true, maxItems: 100 });
const object = <T extends Parameters<typeof Type.Object>[0]>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const params = object({ id });
export const listQuery = object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), cursor: Type.Optional(id) });
export const inputListQuery = object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), cursor: Type.Optional(Type.String({ pattern: "^[0-9]+$", maxLength: 20 })), sourceId: Type.Optional(id) });
export const evaluationListQuery = object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), cursor: Type.Optional(Type.String({ pattern: "^[0-9]+$", maxLength: 20 })), monitorId: Type.Optional(id) });
const sourceWatch = object({ connectionId: id, target: text(200), mode: Type.Optional(Type.Union([Type.Literal("poll"), Type.Literal("push")])), pollIntervalMs: Type.Integer({ minimum: 10000, maximum: 86400000 }),
  startAt: Type.Optional(text(40)), maxPages: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  includeReplies: Type.Optional(Type.Boolean()), includeReposts: Type.Optional(Type.Boolean()) });
export const source = object({ name: text(), kind: Type.Union([Type.Literal("manual"), Type.Literal("adapter")]), enabled: Type.Boolean(), watch: Type.Optional(sourceWatch) });
/** Static connection schemas reject providers until explicitly composed by the application. */
export const connection = emptySourceCatalog.connectionSchema;
export const connectionPatch = emptySourceCatalog.connectionPatchSchema;
export const discoverQuery = object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })) });
export const account = object({ label: text(), address: Type.String({ pattern: "^0x[0-9a-fA-F]{40}$" }),
  network: Type.Union([Type.Literal("mainnet"), Type.Literal("testnet")]),
  perpDexs: Type.Union([Type.Literal("all"), Type.Array(Type.String({ maxLength: 100 }), { uniqueItems: true, minItems: 1, maxItems: 100 })]), enabled: Type.Boolean() });
export const portfolio = object({ name: text(), accountIds: ids, enabled: Type.Boolean() });
export const monitor = object({ name: text(), portfolioId: id, sourceIds: Type.Array(id, { uniqueItems: true }), destinationIds: ids, enabled: Type.Boolean() });
export const destination = Type.Union([
  object({ label: text(), enabled: Type.Boolean(), adapter: Type.Literal("preview") }),
  object({ label: text(), enabled: Type.Boolean(), adapter: Type.Literal("telegram"), chatId: text(), secretRef: Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,99}$" }) }),
]);
export const destinationPatch = object({ label: Type.Optional(text()), enabled: Type.Optional(Type.Boolean()),
  adapter: Type.Optional(Type.Union([Type.Literal("preview"), Type.Literal("telegram")])),
  chatId: Type.Optional(text()), secretRef: Type.Optional(Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,99}$" })) });
export function createResourceSchemas(catalog: SourceCatalog) {
  return {
    resourceSchemas: { connections: catalog.connectionSchema, sources: source, accounts: account, portfolios: portfolio, monitors: monitor, destinations: destination },
    patchSchemas: { connections: catalog.connectionPatchSchema, sources: Type.Partial(source), accounts: Type.Partial(account), portfolios: Type.Partial(portfolio), monitors: Type.Partial(monitor), destinations: destinationPatch },
  };
}
export const { resourceSchemas, patchSchemas } = createResourceSchemas(emptySourceCatalog);
export const input = object({ sourceItemId: text(500), kind: Type.Union([Type.Literal("article"), Type.Literal("message")]),
  sourceRevision: Type.Optional(text(500)), publishedAt: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  text: Type.String({ maxLength: 100_000 }), title: Type.Optional(text(1_000)), url: Type.Optional(text(4_000)), deleted: Type.Optional(Type.Boolean()),
  provenance: Type.Optional(object({ provider: text(100), targetId: text(200), messageId: text(200),
    authorId: Type.Optional(text(200)), authorName: Type.Optional(text(500)), threadId: Type.Optional(text(200)), forwardedFrom: Type.Optional(text(500)), editedAt: Type.Optional(text(40)),
    contentKind: Type.Optional(Type.Union([Type.Literal("headline"), Type.Literal("alert")])), permission: Type.Optional(text(200)),
    relatedSymbols: Type.Optional(Type.Array(text(100), { maxItems: 100, uniqueItems: true })) })),
  relatesTo: Type.Optional(Type.Array(object({ sourceItemId: text(500), relation: Type.Union([Type.Literal("reply"), Type.Literal("correction"), Type.Literal("quote"), Type.Literal("repost")]) }), { maxItems: 100 })) });
export const inputSubmission = object({ sourceId: id, input });
export const notificationContent = object({ title: text(500), body: text(12_000),
  links: Type.Optional(Type.Array(object({ label: text(500), url: text(4_000) }), { maxItems: 20 })) });
export const notification = object({ destinationId: id, content: notificationContent,
  origin: Type.Union([Type.Literal("operator_test"), Type.Literal("application")]),
  evidenceRevisionIds: Type.Optional(ids) });
export const testNotification = object({ content: notificationContent });
export const deliveryResolution = object({ outcome: Type.Union([Type.Literal("sent"), Type.Literal("not_sent")]), evidence: text(2000) });
export const evaluation = object({ monitorId: id });
export const membership = object({ accountIds: ids });
