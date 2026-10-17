import { Type } from "typebox";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { AppError } from "../contracts.js";
import type { InputDraft } from "../contracts.js";
import type { ConnectionDraft, SourceWatch } from "./contracts.js";

/** Authored provider policy. The core has no provider registrations or SDK imports. */
export interface SourceDefinition {
  id: string;
  /** A closed object schema with required label, enabled and literal adapter fields. */
  connectionSchema: TSchema;
  validateWatch(connection: ConnectionDraft, watch: SourceWatch): void;
  acceptsRevision?(previous: InputDraft, incoming: InputDraft): boolean;
}
export interface SourceCatalog {
  readonly definitions: readonly SourceDefinition[];
  readonly connectionSchema: TSchema;
  /** Known provider fields only; adapter is immutable. Validate the merged connection too. */
  readonly connectionPatchSchema: TSchema;
  get(id: string): SourceDefinition | undefined;
  validateConnection(draft: ConnectionDraft): void;
  validateWatch(connection: ConnectionDraft, watch: SourceWatch): void;
  acceptsRevision(adapter: string, previous: InputDraft, incoming: InputDraft): boolean;
}
const invalid = (message: string): never => { throw new AppError("invalid_input", message); };

export function createSourceCatalog(definitions: readonly SourceDefinition[]): SourceCatalog {
  const entries = new Map<string, SourceDefinition>();
  const fields = new Map<string, TSchema[]>();
  for (const definition of definitions) {
    if (typeof definition.id !== "string" || !definition.id.trim() || definition.id.length > 100) throw new Error("Source definition ID must be a nonempty string of at most 100 characters");
    if (entries.has(definition.id)) throw new Error(`Duplicate source definition: ${definition.id}`);
    const schema = definition.connectionSchema as TSchema & {
      type?: string; additionalProperties?: boolean; required?: string[];
      properties?: Record<string, TSchema & { const?: unknown }>;
    };
    const properties = schema.properties;
    const required = schema.required;
    if (schema.type !== "object" || schema.additionalProperties !== false || !properties || !["label", "enabled", "adapter"].every(field => required?.includes(field)) || properties.adapter?.const !== definition.id) {
      throw new Error(`Source ${definition.id} requires a closed object connection schema with required label, enabled and matching literal adapter`);
    }
    entries.set(definition.id, definition);
    for (const [name, field] of Object.entries(properties)) {
      if (name === "adapter") continue;
      fields.set(name, [...(fields.get(name) ?? []), field]);
    }
  }
  const registered = Object.freeze([...entries.values()]);
  const schemas = registered.map(definition => definition.connectionSchema);
  const connectionSchema = schemas.length === 0 ? Type.Never() : Type.Union(schemas);
  const patchProperties = Object.fromEntries([...fields].map(([name, schemas]) => [name, Type.Optional(Type.Union(schemas))]));
  const connectionPatchSchema = Type.Object(patchProperties, { additionalProperties: false });
  const requireDefinition = (id: string): SourceDefinition => entries.get(id) ?? invalid(`Unknown source provider: ${id}`);
  const validateConnection = (draft: ConnectionDraft): void => {
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) invalid("Connection must be an object");
    if (typeof draft.adapter !== "string") invalid("Connection adapter must be a string");
    const definition = requireDefinition(draft.adapter);
    if (typeof draft.label !== "string" || !draft.label.trim() || draft.label.length > 200 || typeof draft.enabled !== "boolean" || !Value.Check(definition.connectionSchema, draft)) invalid(`Invalid ${definition.id} connection`);
  };
  return {
    definitions: registered, connectionSchema, connectionPatchSchema,
    get: id => entries.get(id),
    validateConnection,
    validateWatch(connection, watch) {
      // A persisted resource adds only these host-owned fields to its connection draft.
      const { id, revision, createdAt, updatedAt, ...draft } = connection;
      const configuration = draft as ConnectionDraft;
      validateConnection(configuration);
      requireDefinition(configuration.adapter).validateWatch(configuration, watch);
    },
    acceptsRevision(adapter, previous, incoming) { return requireDefinition(adapter).acceptsRevision?.(previous, incoming) ?? true; },
  };
}

export const emptySourceCatalog = createSourceCatalog([]);
export default emptySourceCatalog;
